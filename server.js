const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    },
    transports: ['websocket', 'polling']
});

// ========== СТРУКТУРЫ ДАННЫХ ==========
// Хранилище комнат: roomName -> { password, players: Map(socketId, {name, team, color}), createdAt }
const rooms = new Map();

// Хранилище цветов игроков: roomName -> Map(playerName, color)
const playerColors = new Map();

// Генерация случайного яркого цвета
function getRandomColor() {
    const hue = Math.floor(Math.random() * 360);
    // Насыщенность 70-85%, светлота 55-70% для хорошей читаемости
    const saturation = 70 + Math.floor(Math.random() * 15);
    const lightness = 55 + Math.floor(Math.random() * 15);
    return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
}

// Получить или создать цвет для игрока в комнате
function getPlayerColor(room, playerName) {
    if (!playerColors.has(room)) {
        playerColors.set(room, new Map());
    }
    const roomColors = playerColors.get(room);
    if (!roomColors.has(playerName)) {
        roomColors.set(playerName, getRandomColor());
    }
    return roomColors.get(playerName);
}

// Получить комнату по socket.id
function getRoomBySocketId(socketId) {
    for (const [roomName, roomData] of rooms.entries()) {
        if (roomData.players.has(socketId)) {
            return roomName;
        }
    }
    return null;
}

// Получить данные игрока по socket.id
function getPlayerBySocketId(socketId) {
    for (const [roomName, roomData] of rooms.entries()) {
        if (roomData.players.has(socketId)) {
            return { room: roomName, playerData: roomData.players.get(socketId) };
        }
    }
    return null;
}

// Очистка неактивных комнат (старше 24 часов)
setInterval(() => {
    const now = Date.now();
    for (const [roomName, roomData] of rooms.entries()) {
        if (roomData.createdAt && (now - roomData.createdAt) > 24 * 60 * 60 * 1000) {
            if (roomData.players.size === 0) {
                rooms.delete(roomName);
                playerColors.delete(roomName);
                console.log(`🗑️ Комната ${roomName} удалена (неактивна)`);
            }
        }
    }
}, 60 * 60 * 1000); // Проверка каждый час

// ========== SOCKET.IO ОБРАБОТЧИКИ ==========
io.on('connection', (socket) => {
    console.log(`🔌 Новое подключение: ${socket.id}`);
    let currentRoom = null;
    let currentPlayerName = null;

    // ===== ВХОД В КОМНАТУ =====
    socket.on('join_room', (data) => {
        const { room, name, pass, team } = data;
        
        // Валидация
        if (!room || !name || !pass) {
            socket.emit('login_failed', { reason: 'Заполните все поля' });
            return;
        }
        
        const roomName = room.toUpperCase().trim();
        const playerName = name.toUpperCase().trim();
        const playerTeam = team ? team.toUpperCase().trim() : playerName;
        
        // Проверка существования комнаты
        if (!rooms.has(roomName)) {
            // Создаем новую комнату
            rooms.set(roomName, {
                password: pass,
                players: new Map(),
                createdAt: Date.now()
            });
            console.log(`📁 Создана комната: ${roomName}`);
        }
        
        const roomData = rooms.get(roomName);
        
        // Проверка пароля
        if (roomData.password !== pass) {
            socket.emit('login_failed', { reason: 'Неверный пароль' });
            console.log(`❌ Отказ в доступе: ${playerName} -> ${roomName} (неверный пароль)`);
            return;
        }
        
        // Проверка уникальности имени в комнате
        let nameExists = false;
        let existingPlayerName = '';
        for (const [_, player] of roomData.players.entries()) {
            if (player.name === playerName) {
                nameExists = true;
                existingPlayerName = player.name;
                break;
            }
        }
        
        if (nameExists) {
            socket.emit('login_failed', { reason: `Позывной "${existingPlayerName}" уже используется в этой комнате` });
            return;
        }
        
        // Сохраняем данные
        currentRoom = roomName;
        currentPlayerName = playerName;
        
        const playerColor = getPlayerColor(roomName, playerName);
        
        roomData.players.set(socket.id, {
            name: playerName,
            team: playerTeam,
            color: playerColor,
            joinedAt: Date.now()
        });
        
        socket.join(roomName);
        
        // Успешный вход
        socket.emit('login_success', { 
            color: playerColor,
            team: playerTeam,
            room: roomName
        });
        
        console.log(`✅ ${playerName} (${playerTeam}) вошел в комнату ${roomName}`);
        
        // Оповестить остальных игроков о новом участнике
        const otherPlayers = [];
        for (const [sid, player] of roomData.players.entries()) {
            if (sid !== socket.id) {
                otherPlayers.push({
                    name: player.name,
                    team: player.team,
                    color: player.color
                });
            }
        }
        
        // Отправить новому игроку список существующих игроков
        socket.emit('existing_players', otherPlayers);
        
        // Оповестить остальных о новом игроке
        socket.to(roomName).emit('player_joined', {
            name: playerName,
            team: playerTeam,
            color: playerColor
        });
    });
    
    // ===== ОБНОВЛЕНИЕ GPS =====
    socket.on('gps_sync', (data) => {
        if (!currentRoom || !currentPlayerName) return;
        
        const { lat, lng, name } = data;
        const roomData = rooms.get(currentRoom);
        if (!roomData) return;
        
        const color = getPlayerColor(currentRoom, currentPlayerName);
        
        // Отправляем всем КРОМЕ отправителя
        socket.to(currentRoom).emit('player_move', {
            name: currentPlayerName,
            lat: lat,
            lng: lng,
            color: color
        });
    });
    
    // ===== СОЗДАНИЕ ТАКТИЧЕСКОГО ОБЪЕКТА =====
    socket.on('new_obj', (obj) => {
        if (!currentRoom) return;
        
        // Добавляем метаданные для отслеживания создателя (опционально)
        const enhancedObj = {
            ...obj,
            createdBy: currentPlayerName,
            timestamp: Date.now()
        };
        
        socket.to(currentRoom).emit('draw', enhancedObj);
        console.log(`📌 ${currentPlayerName} создал объект: ${obj.type} в комнате ${currentRoom}`);
    });
    
    // ===== УДАЛЕНИЕ ОБЪЕКТА =====
    socket.on('delete_obj', (id) => {
        if (!currentRoom) return;
        socket.to(currentRoom).emit('remove_obj', id);
        console.log(`🗑️ ${currentPlayerName} удалил объект: ${id}`);
    });
    
    // ===== ЧАТ =====
    socket.on('chat_msg', (msg) => {
        if (!currentRoom || !currentPlayerName) return;
        
        const roomData = rooms.get(currentRoom);
        if (!roomData) return;
        
        const playerData = roomData.players.get(socket.id);
        const teamTag = playerData?.team ? `[${playerData.team}]` : '';
        
        const formattedMsg = `${teamTag} ${currentPlayerName}: ${msg}`;
        io.to(currentRoom).emit('receive_msg', formattedMsg);
        console.log(`💬 ${formattedMsg}`);
    });
    
    // ===== ЗАПРОС ЦВЕТА (синхронизация) =====
    socket.on('request_player_color', (data) => {
        const { playerName } = data;
        if (!currentRoom) return;
        
        const color = getPlayerColor(currentRoom, playerName);
        socket.emit('player_color_response', { playerName, color });
    });
    
    // ===== ОТКЛЮЧЕНИЕ =====
    socket.on('disconnect', () => {
        if (currentRoom && currentPlayerName) {
            const roomData = rooms.get(currentRoom);
            if (roomData) {
                const playerRemoved = roomData.players.get(socket.id);
                if (playerRemoved) {
                    roomData.players.delete(socket.id);
                    console.log(`👋 ${currentPlayerName} покинул комнату ${currentRoom}`);
                    
                    // Оповестить остальных
                    socket.to(currentRoom).emit('player_left', {
                        name: currentPlayerName,
                        timestamp: Date.now()
                    });
                    
                    // Если комната пуста, удаляем её (опционально, через 5 минут)
                    if (roomData.players.size === 0) {
                        setTimeout(() => {
                            const checkRoom = rooms.get(currentRoom);
                            if (checkRoom && checkRoom.players.size === 0) {
                                rooms.delete(currentRoom);
                                playerColors.delete(currentRoom);
                                console.log(`🧹 Комната ${currentRoom} удалена (пуста)`);
                            }
                        }, 5 * 60 * 1000); // 5 минут
                    }
                }
            }
        }
        console.log(`🔌 Отключение: ${socket.id}`);
    });
    
    // ===== ПИНГ ДЛЯ ПОДДЕРЖАНИЯ СОЕДИНЕНИЯ =====
    socket.on('ping', () => {
        socket.emit('pong');
    });
});

// ========== СТАТИЧЕСКИЕ ФАЙЛЫ ==========
// Раздаем HTML файл (опционально)
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// ========== ЗАПУСК СЕРВЕРА ==========
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`
    ╔════════════════════════════════════════╗
    ║   SCORPION TACTICAL SERVER V20.0      ║
    ╠════════════════════════════════════════╣
    ║   🚀 Запущен на порту: ${PORT}            ║
    ║   📡 WebSocket: активен               ║
    ║   🎯 Готов к подключениям             ║
    ╚════════════════════════════════════════╝
    `);
});

// Обработка ошибок
process.on('uncaughtException', (err) => {
    console.error('❌ Непойманная ошибка:', err);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Необработанное отклонение Promise:', reason);
});
