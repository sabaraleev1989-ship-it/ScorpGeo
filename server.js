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
    transports: ['websocket', 'polling']
});

// Настройки
const PORT = process.env.PORT || 3000;
const ROOM_PASSWORD = '1234'; // Пароль для входа в комнату

// Хранилища данных
const rooms = {};          // { roomName: { players: {}, objects: {} } }
const playerSockets = {};  // { socketId: { name, team, room, color } }

// Раздаём статические файлы (HTML, CSS, JS)
app.use(express.static(path.join(__dirname, 'public')));

// Главная страница
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
            players: {},    // { playerName: { color, lat, lng, socketId } }
            objects: {},    // { objectId: { type, lat, lng, start, end, creator } }
            messages: []    // История сообщений (последние 50)
        };
        console.log(`🏠 Комната создана: ${roomName}`);
    }
    return rooms[roomName];
}

// ==================== ОБРАБОТЧИКИ SOCKET.IO ====================
io.on('connection', (socket) => {
    console.log(`🔌 Новое подключение: ${socket.id}`);

    // ===== АВТОРИЗАЦИЯ =====
    socket.on('join_room', (data) => {
        const { room, name, team, pass } = data;
        
        console.log(`🔑 Попытка входа: ${name} в комнату ${room}`);
        
        // Проверка пароля
        if (pass !== ROOM_PASSWORD) {
            socket.emit('login_failed', { reason: 'Неверный пароль' });
            console.log(`❌ Неверный пароль от ${name}`);
            return;
        }
        
        // Проверка на пустые поля
        if (!room || !name || !team) {
            socket.emit('login_failed', { reason: 'Заполните все поля' });
            return;
        }
        
        const roomData = getOrCreateRoom(room);
        
        // Проверка на дубликат позывного
        if (roomData.players[name]) {
            // Если игрок с таким позывным уже есть, удаляем старого
            const oldSocketId = roomData.players[name].socketId;
            const oldSocket = io.sockets.sockets.get(oldSocketId);
            if (oldSocket) {
                oldSocket.emit('force_disconnect', { reason: 'Кто-то вошел с вашим позывным' });
                oldSocket.disconnect();
                console.log(`⚠️ Игрок ${name} был отключен (дубликат позывного)`);
            }
        }
        
        // Генерируем цвет для игрока
        const playerColor = getRandomColor();
        
        // Сохраняем игрока в комнате
        roomData.players[name] = {
            color: playerColor,
            lat: 55.7558,  // По умолчанию Москва
            lng: 37.6176,
            socketId: socket.id,
            team: team
        };
        
        // Сохраняем привязку сокета к игроку
        playerSockets[socket.id] = { name, team, room, color: playerColor };
        
        // Подключаем сокет к комнате
        socket.join(room);
        
        // Отправляем успешный ответ с цветом
        socket.emit('login_success', {
            color: playerColor,
            name: name,
            room: room
        });
        
        // Отправляем новому игроку список существующих игроков
        const existingPlayers = Object.entries(roomData.players)
            .filter(([playerName]) => playerName !== name)
            .map(([playerName, data]) => ({
                name: playerName,
                color: data.color,
                lat: data.lat,
                lng: data.lng
            }));
        
        if (existingPlayers.length > 0) {
            socket.emit('existing_players', existingPlayers);
        }
        
        // Отправляем новому игроку все существующие объекты
        const allObjects = Object.entries(roomData.objects).map(([id, obj]) => ({
            id,
            ...obj
        }));
        
        if (allObjects.length > 0) {
            allObjects.forEach(obj => {
                socket.emit('draw', obj);
            });
        }
        
        // Отправляем историю чата (последние 50 сообщений)
        if (roomData.messages.length > 0) {
            roomData.messages.slice(-50).forEach(msg => {
                socket.emit('receive_msg', msg);
            });
        }
        
        // Уведомляем всех в комнате о новом игроке
        socket.to(room).emit('player_joined', {
            name: name,
            color: playerColor,
            lat: 55.7558,
            lng: 37.6176
        });
        
        // Системное сообщение в чат
        const systemMsg = {
            name: '⚡СИСТЕМА',
            text: `Боец ${name} присоединился к команде ${team}`,
            color: '#ffaa00',
            timestamp: Date.now()
        };
        
        roomData.messages.push(systemMsg);
        io.to(room).emit('receive_msg', systemMsg);
        
        console.log(`✅ ${name} вошел в комнату ${room} (цвет: ${playerColor})`);
    });

    // ===== GPS СИНХРОНИЗАЦИЯ =====
    socket.on('gps_sync', (data) => {
        const playerInfo = playerSockets[socket.id];
        if (!playerInfo) return;
        
        const { room, name } = playerInfo;
        const roomData = rooms[room];
        if (!roomData) return;
        
        // Обновляем координаты игрока
        if (roomData.players[name]) {
            roomData.players[name].lat = data.lat;
            roomData.players[name].lng = data.lng;
            
            // Рассылаем обновление всем в комнате кроме отправителя
            socket.to(room).emit('player_move', {
                name: name,
                lat: data.lat,
                lng: data.lng,
                color: playerInfo.color
            });
        }
    });

    // ===== НОВЫЙ ТАКТИЧЕСКИЙ ОБЪЕКТ =====
    socket.on('new_obj', (objData) => {
        const playerInfo = playerSockets[socket.id];
        if (!playerInfo) return;
        
        const { room } = playerInfo;
        const roomData = rooms[room];
        if (!roomData) return;
        
        // Сохраняем объект в комнате
        roomData.objects[objData.id] = {
            type: objData.type,
            lat: objData.lat,
            lng: objData.lng,
            start: objData.start,
            end: objData.end,
            creator: objData.creator,
            timestamp: Date.now()
        };
        
        console.log(`📌 Новый объект в ${room}: ${objData.type} от ${objData.creator}`);
        
        // Рассылаем ВСЕМ в комнате (включая отправителя для подтверждения)
        io.to(room).emit('draw', objData);
    });

    // ===== УДАЛЕНИЕ ОБЪЕКТА =====
    socket.on('delete_obj', (objectId) => {
        const playerInfo = playerSockets[socket.id];
        if (!playerInfo) return;
        
        const { room } = playerInfo;
        const roomData = rooms[room];
        if (!roomData) return;
        
        // Проверяем, что объект существует
        if (roomData.objects[objectId]) {
            delete roomData.objects[objectId];
            console.log(`🗑️ Объект удален в ${room}: ${objectId}`);
            
            // Рассылаем всем в комнате
            io.to(room).emit('remove_obj', objectId);
        }
    });

    // ===== ЧАТ СООБЩЕНИЕ =====
    socket.on('chat_msg', (msgData) => {
        const playerInfo = playerSockets[socket.id];
        if (!playerInfo) return;
        
        const { room } = playerInfo;
        const roomData = rooms[room];
        if (!roomData) return;
        
        // Формируем сообщение
        const message = {
            name: msgData.name || playerInfo.name,
            text: msgData.text || msgData,
            color: msgData.color || playerInfo.color,
            timestamp: Date.now()
        };
        
        console.log(`💬 Чат в ${room}: ${message.name}: ${message.text}`);
        
        // Сохраняем в историю (максимум 200 сообщений)
        roomData.messages.push(message);
        if (roomData.messages.length > 200) {
            roomData.messages = roomData.messages.slice(-200);
        }
        
        // Рассылаем всем в комнате
        io.to(room).emit('receive_msg', message);
    });

    // ===== ОТКЛЮЧЕНИЕ =====
    socket.on('disconnect', () => {
        const playerInfo = playerSockets[socket.id];
        if (!playerInfo) return;
        
        const { room, name, team } = playerInfo;
        const roomData = rooms[room];
        
        console.log(`🔌 Отключение: ${name} из комнаты ${room}`);
        
        // Удаляем игрока из комнаты
        if (roomData && roomData.players[name]) {
            delete roomData.players[name];
            
            // Системное сообщение о выходе
            const leaveMsg = {
                name: '⚡СИСТЕМА',
                text: `Боец ${name} покинул команду`,
                color: '#ff4444',
                timestamp: Date.now()
            };
            
            roomData.messages.push(leaveMsg);
            io.to(room).emit('receive_msg', leaveMsg);
            
            // Уведомляем о выходе игрока
            io.to(room).emit('player_left', { name });
            
            // Если комната пуста, удаляем её через 5 минут
            if (Object.keys(roomData.players).length === 0) {
                console.log(`🏚️ Комната ${room} пуста, будет удалена через 5 минут`);
                setTimeout(() => {
                    if (rooms[room] && Object.keys(rooms[room].players).length === 0) {
                        delete rooms[room];
                        console.log(`🗑️ Комната ${room} удалена`);
                    }
                }, 300000); // 5 минут
            }
        }
        
        // Удаляем привязку сокета
        delete playerSockets[socket.id];
    });

    // ===== ПЕРЕПОДКЛЮЧЕНИЕ =====
    socket.on('reconnect_attempt', () => {
        console.log(`🔄 Попытка переподключения: ${socket.id}`);
    });
});

// ==================== API ДЛЯ МОНИТОРИНГА ====================
app.get('/api/status', (req, res) => {
    const status = {
        rooms: Object.keys(rooms).length,
        totalPlayers: Object.values(rooms).reduce((sum, room) => sum + Object.keys(room.players).length, 0),
        totalObjects: Object.values(rooms).reduce((sum, room) => sum + Object.keys(room.objects).length, 0),
        uptime: process.uptime()
    };
    res.json(status);
});

app.get('/api/rooms', (req, res) => {
    const roomsInfo = Object.entries(rooms).map(([name, data]) => ({
        name,
        players: Object.keys(data.players),
        objectsCount: Object.keys(data.objects).length,
        messagesCount: data.messages.length
    }));
    res.json(roomsInfo);
});

// ==================== ЗАПУСК СЕРВЕРА ====================
server.listen(PORT, () => {
    console.log('════════════════════════════════════════');
    console.log('⚡ SCORPION TACTICAL SERVER ЗАПУЩЕН ⚡');
    console.log('════════════════════════════════════════');
    console.log(`📍 Порт: ${PORT}`);
    console.log(`🔑 Пароль комнаты: ${ROOM_PASSWORD}`);
    console.log(`🌐 http://localhost:${PORT}`);
    console.log('────────────────────────────────────────');
    console.log('📡 Ожидание подключений...');
    console.log('════════════════════════════════════════');
});

// Обработка ошибок
process.on('uncaughtException', (err) => {
    console.error('❌ Критическая ошибка:', err);
});

process.on('SIGTERM', () => {
    console.log('🛑 Сервер останавливается...');
    server.close(() => {
        console.log('👋 Сервер остановлен');
        process.exit(0);
    });
});
