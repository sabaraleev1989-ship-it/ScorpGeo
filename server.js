const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    },
    transports: ['websocket', 'polling'],
    pingTimeout: 60000,
    pingInterval: 25000,
    connectTimeout: 30000
});

const PORT = process.env.PORT || 3000;
const ROOM_PASSWORD = '1234';
const DISCONNECT_TIMEOUT = 30000;
const DATA_FILE = path.join(__dirname, 'tactical_data.json'); // Файл для сохранения меток

// Хранилища
const rooms = {};
const playerSockets = {};

// Раздаём статику
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ==================== ЗАГРУЗКА ДАННЫХ С ДИСКА ====================
function loadData() {
    try {
        if (fs.existsSync(DATA_FILE)) {
            const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
            console.log(`💾 Данные загружены: ${Object.keys(data).length} комнат`);
            return data;
        }
    } catch (err) {
        console.error('❌ Ошибка загрузки:', err.message);
    }
    return {};
}

function saveData() {
    try {
        // Сохраняем только объекты (не игроков)
        const dataToSave = {};
        for (const [roomName, roomData] of Object.entries(rooms)) {
            dataToSave[roomName] = {
                objects: roomData.objects,
                messages: roomData.messages.slice(-100), // Последние 100 сообщений
                lastActive: Date.now()
            };
        }
        fs.writeFileSync(DATA_FILE, JSON.stringify(dataToSave, null, 2));
        console.log('💾 Данные сохранены');
    } catch (err) {
        console.error('❌ Ошибка сохранения:', err.message);
    }
}

// Загружаем данные при старте
const savedData = loadData();
for (const [roomName, data] of Object.entries(savedData)) {
    rooms[roomName] = {
        players: {},
        objects: data.objects || {},
        messages: data.messages || [],
        lastActive: data.lastActive || Date.now()
    };
    console.log(`📂 Комната ${roomName}: ${Object.keys(data.objects || {}).length} объектов`);
}

// Периодическое сохранение (каждые 5 минут)
setInterval(saveData, 300000);

// ==================== ОЧИСТКА В ПОЛНОЧЬ ====================
function getTimeUntilMidnight() {
    const now = new Date();
    const midnight = new Date(now);
    midnight.setHours(24, 0, 0, 0);
    return midnight - now;
}

function clearAllObjects() {
    console.log('🕛 ПОЛНОЧЬ! Очистка всех меток...');
    for (const roomData of Object.values(rooms)) {
        const count = Object.keys(roomData.objects).length;
        roomData.objects = {};
        
        // Системное сообщение в чат
        const clearMsg = {
            name: '⚡СИСТЕМА',
            text: `🕛 Полночь! Все метки очищены. Удалено объектов: ${count}`,
            color: '#ffaa00',
            timestamp: Date.now()
        };
        roomData.messages.push(clearMsg);
    }
    saveData();
    
    // Рассылаем уведомление всем подключенным
    io.emit('midnight_clear', {
        message: 'Все метки очищены (полночь)',
        timestamp: Date.now()
    });
    
    console.log('✅ Все метки очищены');
}

// Устанавливаем таймер на ближайшую полночь
setTimeout(() => {
    clearAllObjects();
    // Затем каждые 24 часа
    setInterval(clearAllObjects, 24 * 60 * 60 * 1000);
}, getTimeUntilMidnight());

console.log(`🕛 Очистка запланирована через ${Math.floor(getTimeUntilMidnight() / 60000)} минут`);

// ==================== ГЕНЕРАЦИЯ ЦВЕТОВ ====================
function getRandomColor() {
    const colors = [
        '#ff4444', '#44ff44', '#4444ff', '#ffff44', '#ff44ff', '#44ffff',
        '#ff8844', '#8844ff', '#44ff88', '#ff4488', '#88ff44', '#ffaa00',
        '#00aaff', '#aa00ff', '#ff00aa', '#00ffaa', '#aaff00'
    ];
    return colors[Math.floor(Math.random() * colors.length)];
}

function getOrCreateRoom(roomName) {
    if (!rooms[roomName]) {
        rooms[roomName] = {
            players: {},
            objects: {},
            messages: []
        };
        console.log(`🏠 Комната создана: ${roomName}`);
    }
    return rooms[roomName];
}

// ==================== SOCKET.IO ====================
io.on('connection', (socket) => {
    console.log(`🔌 Подключение: ${socket.id}`);

    socket.on('join_room', (data) => {
        const { room, name, team, pass } = data;
        
        console.log(`🔑 Вход: ${name} → ${room}`);
        
        if (pass !== ROOM_PASSWORD) {
            socket.emit('login_failed', { reason: 'Неверный пароль' });
            return;
        }
        
        if (!room || !name) {
            socket.emit('login_failed', { reason: 'Заполните все поля' });
            return;
        }
        
        const roomData = getOrCreateRoom(room);
        
        // Если игрок уже был (восстановление)
        if (roomData.players[name]) {
            if (roomData.players[name].disconnectTimer) {
                clearTimeout(roomData.players[name].disconnectTimer);
            }
            roomData.players[name].socketId = socket.id;
            roomData.players[name].pendingDisconnect = false;
        } else {
            roomData.players[name] = {
                color: getRandomColor(),
                lat: 55.7558,
                lng: 37.6176,
                socketId: socket.id,
                team: team || room,
                pendingDisconnect: false
            };
        }
        
        const playerColor = roomData.players[name].color;
        
        playerSockets[socket.id] = {
            name, team: team || room, room, color: playerColor
        };
        
        socket.join(room);
        
        // Отправляем успех
        socket.emit('login_success', {
            color: playerColor,
            name, room,
            objectsCount: Object.keys(roomData.objects).length
        });
        
        // Отправляем ВСЕ существующие объекты (они не удаляются!)
        const allObjects = Object.entries(roomData.objects).map(([id, obj]) => ({
            id, ...obj
        }));
        
        if (allObjects.length > 0) {
            console.log(`📦 Отправляем ${allObjects.length} объектов для ${name}`);
            allObjects.forEach(obj => socket.emit('draw', obj));
        }
        
        // Существующие игроки
        const existingPlayers = [];
        for (const [pName, pData] of Object.entries(roomData.players)) {
            if (pName !== name) {
                existingPlayers.push({
                    name: pName,
                    color: pData.color,
                    lat: pData.lat,
                    lng: pData.lng
                });
            }
        }
        if (existingPlayers.length > 0) {
            socket.emit('existing_players', existingPlayers);
        }
        
        // История чата
        if (roomData.messages.length > 0) {
            roomData.messages.slice(-100).forEach(msg => socket.emit('receive_msg', msg));
        }
        
        // Уведомляем других
        socket.to(room).emit('player_joined', {
            name, color: playerColor,
            lat: 55.7558, lng: 37.6176
        });
        
        const joinMsg = {
            name: '⚡СИСТЕМА',
            text: `Боец ${name} на связи`,
            color: '#44ff44',
            timestamp: Date.now()
        };
        roomData.messages.push(joinMsg);
        io.to(room).emit('receive_msg', joinMsg);
        
        console.log(`✅ ${name} в ${room} | Объектов на карте: ${Object.keys(roomData.objects).length}`);
    });

    socket.on('rejoin_room', (data) => {
        const { room, name, color } = data;
        const roomData = rooms[room];
        if (!roomData || !roomData.players[name]) return;
        
        if (roomData.players[name].disconnectTimer) {
            clearTimeout(roomData.players[name].disconnectTimer);
        }
        roomData.players[name].socketId = socket.id;
        roomData.players[name].pendingDisconnect = false;
        
        playerSockets[socket.id] = {
            name, team: room, room,
            color: color || roomData.players[name].color
        };
        
        socket.join(room);
        
        const existingPlayers = [];
        for (const [pName, pData] of Object.entries(roomData.players)) {
            if (pName !== name) {
                existingPlayers.push({
                    name: pName, color: pData.color,
                    lat: pData.lat, lng: pData.lng
                });
            }
        }
        socket.emit('existing_players', existingPlayers);
        
        socket.to(room).emit('player_reconnected', {
            name, color: color || roomData.players[name].color
        });
    });

    socket.on('keep_alive', (data) => {
        const { name, room } = data;
        const roomData = rooms[room];
        if (roomData && roomData.players[name]) {
            roomData.players[name].pendingDisconnect = false;
            if (roomData.players[name].disconnectTimer) {
                clearTimeout(roomData.players[name].disconnectTimer);
                roomData.players[name].disconnectTimer = null;
            }
        }
    });

    // GPS
    socket.on('gps_sync', (data) => {
        if (!data || !data.lat || !data.lng) return;
        const playerInfo = playerSockets[socket.id];
        if (!playerInfo) return;
        
        const { room, name } = playerInfo;
        const roomData = rooms[room];
        if (!roomData || !roomData.players[name]) return;
        
        roomData.players[name].lat = data.lat;
        roomData.players[name].lng = data.lng;
        
        socket.to(room).emit('player_move', {
            name, lat: data.lat, lng: data.lng,
            color: playerInfo.color
        });
    });

    // ===== НОВЫЙ ОБЪЕКТ (СОХРАНЯЕТСЯ НАВСЕГДА ДО ПОЛУНОЧИ) =====
    socket.on('new_obj', (objData) => {
        if (!objData || !objData.id || !objData.type) return;
        
        const playerInfo = playerSockets[socket.id];
        if (!playerInfo) return;
        
        const { room } = playerInfo;
        const roomData = rooms[room];
        if (!roomData) return;
        
        // Сохраняем объект НАВСЕГДА (до полуночи)
        roomData.objects[objData.id] = {
            type: objData.type,
            lat: objData.lat,
            lng: objData.lng,
            start: objData.start,
            end: objData.end,
            creator: objData.creator,
            created: Date.now()
        };
        
        console.log(`📌 ${objData.type} от ${objData.creator} | Всего в ${room}: ${Object.keys(roomData.objects).length}`);
        
        // Рассылаем всем
        io.to(room).emit('draw', objData);
        
        // Сохраняем на диск
        saveData();
    });

    // ===== УДАЛЕНИЕ ОБЪЕКТА (ластиком) =====
    socket.on('delete_obj', (objectId) => {
        if (!objectId) return;
        
        const playerInfo = playerSockets[socket.id];
        if (!playerInfo) return;
        
        const { room } = playerInfo;
        const roomData = rooms[room];
        if (!roomData || !roomData.objects[objectId]) return;
        
        console.log(`🗑️ Удаление: ${objectId}`);
        delete roomData.objects[objectId];
        io.to(room).emit('remove_obj', objectId);
        saveData();
    });

    // ===== ЧАТ =====
    socket.on('chat_msg', (msgData) => {
        const playerInfo = playerSockets[socket.id];
        if (!playerInfo) return;
        
        const { room, name, color } = playerInfo;
        const roomData = rooms[room];
        if (!roomData) return;
        
        const message = {
            name: msgData.name || name,
            text: msgData.text || msgData,
            color: msgData.color || color,
            timestamp: Date.now()
        };
        
        roomData.messages.push(message);
        if (roomData.messages.length > 500) {
            roomData.messages = roomData.messages.slice(-500);
        }
        
        io.to(room).emit('receive_msg', message);
    });

    // ===== ОТКЛЮЧЕНИЕ (игрок удаляется, объекты ОСТАЮТСЯ) =====
    socket.on('disconnect', (reason) => {
        const playerInfo = playerSockets[socket.id];
        if (!playerInfo) return;
        
        const { room, name } = playerInfo;
        const roomData = rooms[room];
        
        console.log(`🔌 ${name} отключен [${reason}]`);
        
        if (roomData && roomData.players[name]) {
            roomData.players[name].pendingDisconnect = true;
            roomData.players[name].disconnectTime = Date.now();
            
            roomData.players[name].disconnectTimer = setTimeout(() => {
                if (roomData.players[name] && roomData.players[name].pendingDisconnect) {
                    console.log(`🗑️ ${name} удален (таймаут)`);
                    delete roomData.players[name];
                    
                    const leaveMsg = {
                        name: '⚡СИСТЕМА',
                        text: `Боец ${name} отключился`,
                        color: '#ff4444',
                        timestamp: Date.now()
                    };
                    roomData.messages.push(leaveMsg);
                    io.to(room).emit('receive_msg', leaveMsg);
                    io.to(room).emit('player_left', { name });
                    
                    // НЕ УДАЛЯЕМ КОМНАТУ! Объекты должны сохраниться
                    // Если комната пуста 24 часа — удаляем
                    if (Object.keys(roomData.players).length === 0) {
                        setTimeout(() => {
                            if (rooms[room] && Object.keys(rooms[room].players).length === 0) {
                                const lastActive = rooms[room].lastActive || 0;
                                if (Date.now() - lastActive > 86400000) { // 24 часа
                                    delete rooms[room];
                                    console.log(`🗑️ Комната ${room} удалена (неактивна 24ч)`);
                                    saveData();
                                }
                            }
                        }, 86400000);
                    }
                }
            }, DISCONNECT_TIMEOUT);
        }
        
        delete playerSockets[socket.id];
        saveData();
    });
});

// ==================== МОНИТОРИНГ ====================
app.get('/api/status', (req, res) => {
    const now = new Date();
    const midnight = new Date(now);
    midnight.setHours(24, 0, 0, 0);
    const timeUntilClear = Math.floor((midnight - now) / 60000);
    
    const totalPlayers = Object.values(rooms).reduce((sum, r) => sum + Object.keys(r.players).length, 0);
    const totalObjects = Object.values(rooms).reduce((sum, r) => sum + Object.keys(r.objects).length, 0);
    
    res.json({
        rooms: Object.keys(rooms).length,
        totalPlayers,
        totalObjects,
        timeUntilMidnightClear: `${timeUntilClear} минут`,
        uptime: Math.floor(process.uptime()),
        roomsList: Object.entries(rooms).map(([name, data]) => ({
            name,
            players: Object.keys(data.players),
            objectsCount: Object.keys(data.objects).length,
            objectsList: Object.entries(data.objects).map(([id, obj]) => ({
                id,
                type: obj.type,
                creator: obj.creator,
                created: new Date(obj.created).toLocaleTimeString()
            }))
        }))
    });
});

// Ручная очистка (для теста)
app.get('/api/clear', (req, res) => {
    clearAllObjects();
    res.json({ success: true, message: 'Все метки очищены' });
});

// ==================== ЗАПУСК ====================
server.listen(PORT, '0.0.0.0', () => {
    console.log('════════════════════════════════════════');
    console.log('⚡ SCORPION TACTICAL v4.0 ⚡');
    console.log('════════════════════════════════════════');
    console.log(`📍 Порт: ${PORT}`);
    console.log(`🔑 Пароль: ${ROOM_PASSWORD}`);
    console.log(`🕛 Очистка через: ${Math.floor(getTimeUntilMidnight() / 60000)} мин`);
    console.log(`💾 Файл данных: ${DATA_FILE}`);
    console.log('────────────────────────────────────────');
    console.log('✅ Объекты сохраняются до полуночи');
    console.log('✅ Игроки могут заходить/выходить');
    console.log('✅ Метки не пропадают при выходе');
    console.log('════════════════════════════════════════');
});

process.on('uncaughtException', (err) => {
    console.error('❌ Ошибка:', err.message);
    saveData();
});

process.on('SIGTERM', () => {
    console.log('🛑 Сохранение перед выходом...');
    saveData();
    process.exit(0);
});
