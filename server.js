const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    },
    transports: ['websocket', 'polling'],
    pingTimeout: 60000,
    pingInterval: 25000
});

// Настройки
const PORT = process.env.PORT || 3000;
const ROOM_PASSWORD = '1234';

// Хранилища данных
const rooms = {};
const playerSockets = {};

// Раздаём статические файлы
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ==================== ГЕНЕРАЦИЯ ЦВЕТОВ ====================
function getRandomColor() {
    const colors = [
        '#ff4444', '#44ff44', '#4444ff', '#ffff44', '#ff44ff', '#44ffff',
        '#ff8844', '#8844ff', '#44ff88', '#ff4488', '#88ff44', '#ffaa00',
        '#00aaff', '#aa00ff', '#ff00aa', '#00ffaa', '#aaff00'
    ];
    return colors[Math.floor(Math.random() * colors.length)];
}

// ==================== РАБОТА С КОМНАТАМИ ====================
function getOrCreateRoom(roomName) {
    if (!rooms[roomName]) {
        rooms[roomName] = {
            players: {},    // { playerName: { color, lat, lng, socketId, team } }
            objects: {},    // { objectId: { type, lat, lng, start, end, creator } }
            messages: []    // История чата
        };
        console.log(`🏠 Комната создана: ${roomName}`);
    }
    return rooms[roomName];
}

// ==================== SOCKET.IO ОБРАБОТЧИКИ ====================
io.on('connection', (socket) => {
    console.log(`🔌 Подключение: ${socket.id} [${new Date().toLocaleTimeString()}]`);

    // ===== АВТОРИЗАЦИЯ =====
    socket.on('join_room', (data) => {
        const { room, name, team, pass } = data;
        
        console.log(`🔑 Вход: ${name} → комната ${room}`);
        
        // Проверка пароля
        if (pass !== ROOM_PASSWORD) {
            socket.emit('login_failed', { reason: 'Неверный пароль' });
            console.log(`❌ Неверный пароль: ${name}`);
            return;
        }
        
        if (!room || !name || !team) {
            socket.emit('login_failed', { reason: 'Все поля обязательны' });
            return;
        }
        
        const roomData = getOrCreateRoom(room);
        
        // Удаляем старого игрока с таким же именем (если есть)
        if (roomData.players[name]) {
            const oldSocketId = roomData.players[name].socketId;
            const oldSocket = io.sockets.sockets.get(oldSocketId);
            if (oldSocket) {
                oldSocket.emit('force_disconnect', { reason: 'Кто-то вошел с вашим позывным' });
                oldSocket.disconnect(true);
            }
            delete roomData.players[name];
        }
        
        // Генерируем цвет
        const playerColor = getRandomColor();
        
        // Сохраняем игрока
        roomData.players[name] = {
            color: playerColor,
            lat: 55.7558,
            lng: 37.6176,
            socketId: socket.id,
            team: team
        };
        
        // Привязка сокета
        playerSockets[socket.id] = {
            name: name,
            team: team,
            room: room,
            color: playerColor
        };
        
        // Подключаем к комнате
        socket.join(room);
        
        // === ВАЖНО: Отправляем успех и список существующих игроков ===
        socket.emit('login_success', {
            color: playerColor,
            name: name,
            room: room
        });
        
        // Отправляем список ВСЕХ существующих игроков (кроме себя)
        const existingPlayers = [];
        for (const [playerName, playerData] of Object.entries(roomData.players)) {
            if (playerName !== name) {
                existingPlayers.push({
                    name: playerName,
                    color: playerData.color,
                    lat: playerData.lat,  // РЕАЛЬНЫЕ координаты
                    lng: playerData.lng   // РЕАЛЬНЫЕ координаты
                });
            }
        }
        
        if (existingPlayers.length > 0) {
            console.log(`👥 Отправляем ${existingPlayers.length} игроков для ${name}:`, 
                existingPlayers.map(p => p.name).join(', '));
            socket.emit('existing_players', existingPlayers);
        }
        
        // Отправляем все существующие объекты новому игроку
        const allObjects = Object.entries(roomData.objects).map(([id, obj]) => ({
            id,
            ...obj
        }));
        
        if (allObjects.length > 0) {
            console.log(`📦 Отправляем ${allObjects.length} объектов для ${name}`);
            allObjects.forEach(obj => socket.emit('draw', obj));
        }
        
        // История чата
        if (roomData.messages.length > 0) {
            const recentMessages = roomData.messages.slice(-50);
            recentMessages.forEach(msg => socket.emit('receive_msg', msg));
        }
        
        // Уведомляем ВСЕХ в комнате о новом игроке
        socket.to(room).emit('player_joined', {
            name: name,
            color: playerColor,
            lat: 55.7558,  // Начальные координаты
            lng: 37.6176
        });
        
        // Системное сообщение
        const systemMsg = {
            name: '⚡СИСТЕМА',
            text: `Боец ${name} присоединился к команде ${team}`,
            color: '#ffaa00',
            timestamp: Date.now()
        };
        
        roomData.messages.push(systemMsg);
        io.to(room).emit('receive_msg', systemMsg);
        
        console.log(`✅ ${name} в комнате ${room} (цвет: ${playerColor})`);
        console.log(`📊 Игроков в комнате: ${Object.keys(roomData.players).length}`);
    });

    // ===== GPS СИНХРОНИЗАЦИЯ =====
    socket.on('gps_sync', (data) => {
        if (!data || !data.lat || !data.lng) return;
        
        const playerInfo = playerSockets[socket.id];
        if (!playerInfo) return;
        
        const { room, name } = playerInfo;
        const roomData = rooms[room];
        if (!roomData || !roomData.players[name]) return;
        
        // Обновляем координаты
        roomData.players[name].lat = data.lat;
        roomData.players[name].lng = data.lng;
        
        // Рассылаем ВСЕМ КРОМЕ отправителя
        socket.to(room).emit('player_move', {
            name: name,
            lat: data.lat,
            lng: data.lng,
            color: playerInfo.color
        });
    });

    // ===== НОВЫЙ ТАКТИЧЕСКИЙ ОБЪЕКТ =====
    socket.on('new_obj', (objData) => {
        if (!objData || !objData.id || !objData.type) return;
        
        const playerInfo = playerSockets[socket.id];
        if (!playerInfo) return;
        
        const { room } = playerInfo;
        const roomData = rooms[room];
        if (!roomData) return;
        
        // Сохраняем объект
        roomData.objects[objData.id] = {
            type: objData.type,
            lat: objData.lat,
            lng: objData.lng,
            start: objData.start,
            end: objData.end,
            creator: objData.creator,
            timestamp: Date.now()
        };
        
        console.log(`📌 Объект: ${objData.type} (${objData.id}) в ${room} от ${objData.creator}`);
        
        // Рассылаем ВСЕМ в комнате (включая отправителя)
        io.to(room).emit('draw', objData);
    });

    // ===== УДАЛЕНИЕ ОБЪЕКТА =====
    socket.on('delete_obj', (objectId) => {
        if (!objectId) return;
        
        const playerInfo = playerSockets[socket.id];
        if (!playerInfo) return;
        
        const { room } = playerInfo;
        const roomData = rooms[room];
        if (!roomData || !roomData.objects[objectId]) return;
        
        console.log(`🗑️ Удаление: ${objectId} в ${room}`);
        
        delete roomData.objects[objectId];
        
        // Рассылаем ВСЕМ
        io.to(room).emit('remove_obj', objectId);
    });

    // ===== ЧАТ =====
    socket.on('chat_msg', (msgData) => {
        const playerInfo = playerSockets[socket.id];
        if (!playerInfo) return;
        
        const { room, name, color } = playerInfo;
        const roomData = rooms[room];
        if (!roomData) return;
        
        // Формируем сообщение
        const message = {
            name: msgData.name || name,
            text: msgData.text || msgData,
            color: msgData.color || color,
            timestamp: Date.now()
        };
        
        console.log(`💬 Чат [${room}] ${message.name}: ${message.text}`);
        
        // Сохраняем в историю
        roomData.messages.push(message);
        if (roomData.messages.length > 200) {
            roomData.messages = roomData.messages.slice(-200);
        }
        
        // Рассылаем ВСЕМ в комнате
        io.to(room).emit('receive_msg', message);
    });

    // ===== ОТКЛЮЧЕНИЕ =====
    socket.on('disconnect', (reason) => {
        const playerInfo = playerSockets[socket.id];
        if (!playerInfo) return;
        
        const { room, name } = playerInfo;
        const roomData = rooms[room];
        
        console.log(`🔌 Отключение: ${name} из ${room} [${reason}]`);
        
        if (roomData && roomData.players[name]) {
            // Удаляем игрока
            delete roomData.players[name];
            
            // Системное сообщение
            const leaveMsg = {
                name: '⚡СИСТЕМА',
                text: `Боец ${name} покинул команду`,
                color: '#ff4444',
                timestamp: Date.now()
            };
            
            roomData.messages.push(leaveMsg);
            io.to(room).emit('receive_msg', leaveMsg);
            
            // Уведомляем о выходе
            io.to(room).emit('player_left', { name });
            
            console.log(`📊 Игроков в комнате ${room}: ${Object.keys(roomData.players).length}`);
            
            // Если комната пуста - удаляем через 5 минут
            if (Object.keys(roomData.players).length === 0) {
                setTimeout(() => {
                    if (rooms[room] && Object.keys(rooms[room].players).length === 0) {
                        delete rooms[room];
                        console.log(`🗑️ Комната ${room} удалена (пустая)`);
                    }
                }, 300000);
            }
        }
        
        delete playerSockets[socket.id];
    });
});

// ==================== МОНИТОРИНГ ====================
app.get('/api/status', (req, res) => {
    const totalPlayers = Object.values(rooms).reduce((sum, room) => 
        sum + Object.keys(room.players).length, 0);
    const totalObjects = Object.values(rooms).reduce((sum, room) => 
        sum + Object.keys(room.objects).length, 0);
    
    res.json({
        rooms: Object.keys(rooms).length,
        totalPlayers,
        totalObjects,
        uptime: Math.floor(process.uptime()),
        roomsList: Object.entries(rooms).map(([name, data]) => ({
            name,
            players: Object.keys(data.players),
            objectsCount: Object.keys(data.objects).length,
            messagesCount: data.messages.length
        }))
    });
});

// ==================== ЗАПУСК ====================
server.listen(PORT, '0.0.0.0', () => {
    console.log('════════════════════════════════════════');
    console.log('⚡ SCORPION TACTICAL SERVER v2.0 ⚡');
    console.log('════════════════════════════════════════');
    console.log(`📍 Порт: ${PORT}`);
    console.log(`🔑 Пароль: ${ROOM_PASSWORD}`);
    console.log(`🌐 http://localhost:${PORT}`);
    console.log(`🔍 Статус: http://localhost:${PORT}/api/status`);
    console.log('────────────────────────────────────────');
    console.log('✅ Исправления:');
    console.log('  - existing_players с реальными координатами');
    console.log('  - player_joined с начальными координатами');
    console.log('  - GPS синхронизация работает');
    console.log('  - Чат синхронизирован');
    console.log('  - Объекты синхронизированы');
    console.log('════════════════════════════════════════');
});

// Обработка ошибок
process.on('uncaughtException', (err) => {
    console.error('❌ Ошибка:', err.message);
});

process.on('unhandledRejection', (reason) => {
    console.error('❌ Promise rejected:', reason);
});
