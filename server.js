const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*", methods: ["GET", "POST"] },
    transports: ['websocket', 'polling'],
    pingTimeout: 120000,
    pingInterval: 30000,
    connectTimeout: 30000
});

const PORT = process.env.PORT || 3000;
const ROOM_PASSWORD = '1234';
const DISCONNECT_TIMEOUT = 900000; // 15 МИНУТ
const DATA_FILE = path.join(__dirname, 'tactical_data.json');

const rooms = {};
const playerSockets = {};

app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

function loadData() {
    try {
        if (fs.existsSync(DATA_FILE)) {
            const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
            console.log(`💾 Данные загружены: ${Object.keys(data).length} комнат`);
            return data;
        }
    } catch (err) { console.error('❌ Ошибка загрузки:', err.message); }
    return {};
}

function saveData() {
    try {
        const dataToSave = {};
        for (const [roomName, roomData] of Object.entries(rooms)) {
            dataToSave[roomName] = {
                objects: roomData.objects,
                messages: roomData.messages.slice(-100),
                lastActive: Date.now()
            };
        }
        fs.writeFileSync(DATA_FILE, JSON.stringify(dataToSave, null, 2));
    } catch (err) { console.error('❌ Ошибка сохранения:', err.message); }
}

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

setInterval(saveData, 300000);

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
        const clearMsg = {
            name: '⚡СИСТЕМА',
            text: `🕛 Полночь! Все метки очищены. Удалено: ${count}`,
            color: '#ffaa00',
            timestamp: Date.now()
        };
        roomData.messages.push(clearMsg);
    }
    saveData();
    io.emit('midnight_clear', { message: 'Все метки очищены (полночь)', timestamp: Date.now() });
    console.log('✅ Все метки очищены');
}

setTimeout(() => { clearAllObjects(); setInterval(clearAllObjects, 24 * 60 * 60 * 1000); }, getTimeUntilMidnight());
console.log(`🕛 Очистка через ${Math.floor(getTimeUntilMidnight() / 60000)} минут`);

function getRandomColor() {
    const colors = ['#ff4444','#44ff44','#4444ff','#ffff44','#ff44ff','#44ffff','#ff8844','#8844ff','#44ff88','#ff4488','#88ff44','#ffaa00','#00aaff','#aa00ff','#ff00aa','#00ffaa','#aaff00'];
    return colors[Math.floor(Math.random() * colors.length)];
}

function getOrCreateRoom(roomName) {
    if (!rooms[roomName]) {
        rooms[roomName] = { players: {}, objects: {}, messages: [] };
        console.log(`🏠 Комната создана: ${roomName}`);
    }
    return rooms[roomName];
}

io.on('connection', (socket) => {
    console.log(`🔌 Подключение: ${socket.id} [${new Date().toLocaleTimeString()}]`);

    socket.on('join_room', (data) => {
        const { room, name, team, pass } = data;
        console.log(`🔑 Вход: ${name} → ${room}`);
        
        if (pass !== ROOM_PASSWORD) { socket.emit('login_failed', { reason: 'Неверный пароль' }); return; }
        if (!room || !name) { socket.emit('login_failed', { reason: 'Заполните все поля' }); return; }
        
        const roomData = getOrCreateRoom(room);
        
        if (roomData.players[name]) {
            if (roomData.players[name].disconnectTimer) {
                clearTimeout(roomData.players[name].disconnectTimer);
                roomData.players[name].disconnectTimer = null;
                console.log(`🔄 Таймер удаления отменен для ${name}`);
            }
            roomData.players[name].socketId = socket.id;
            roomData.players[name].pendingDisconnect = false;
            roomData.players[name].explicitExit = false;
            roomData.players[name].lastSeen = Date.now();
        } else {
            roomData.players[name] = {
                color: getRandomColor(),
                lat: 55.7558, lng: 37.6176,
                socketId: socket.id,
                team: team || room,
                pendingDisconnect: false,
                explicitExit: false,
                lastSeen: Date.now()
            };
        }
        
        const playerColor = roomData.players[name].color;
        playerSockets[socket.id] = { name, team: team || room, room, color: playerColor };
        socket.join(room);
        
        socket.emit('login_success', { color: playerColor, name, room, objectsCount: Object.keys(roomData.objects).length });
        
        const allObjects = Object.entries(roomData.objects).map(([id, obj]) => ({ id, ...obj }));
        if (allObjects.length > 0) allObjects.forEach(obj => socket.emit('draw', obj));
        
        const existingPlayers = [];
        for (const [pName, pData] of Object.entries(roomData.players)) {
            if (pName !== name) existingPlayers.push({ name: pName, color: pData.color, lat: pData.lat, lng: pData.lng });
        }
        if (existingPlayers.length > 0) socket.emit('existing_players', existingPlayers);
        
        if (roomData.messages.length > 0) roomData.messages.slice(-100).forEach(msg => socket.emit('receive_msg', msg));
        
        socket.to(room).emit('player_joined', { name, color: playerColor, lat: 55.7558, lng: 37.6176 });
        
        const joinMsg = { name: '⚡СИСТЕМА', text: `Боец ${name} на связи`, color: '#44ff44', timestamp: Date.now() };
        roomData.messages.push(joinMsg);
        io.to(room).emit('receive_msg', joinMsg);
        
        console.log(`✅ ${name} в ${room} | Объектов: ${Object.keys(roomData.objects).length}`);
    });

    socket.on('rejoin_room', (data) => {
        const { room, name, color } = data;
        const roomData = rooms[room];
        if (!roomData || !roomData.players[name]) return;
        
        if (roomData.players[name].disconnectTimer) {
            clearTimeout(roomData.players[name].disconnectTimer);
            roomData.players[name].disconnectTimer = null;
        }
        roomData.players[name].socketId = socket.id;
        roomData.players[name].pendingDisconnect = false;
        roomData.players[name].explicitExit = false;
        roomData.players[name].lastSeen = Date.now();
        
        playerSockets[socket.id] = { name, team: room, room, color: color || roomData.players[name].color };
        socket.join(room);
        
        const existingPlayers = [];
        for (const [pName, pData] of Object.entries(roomData.players)) {
            if (pName !== name) existingPlayers.push({ name: pName, color: pData.color, lat: pData.lat, lng: pData.lng });
        }
        socket.emit('existing_players', existingPlayers);
        socket.to(room).emit('player_reconnected', { name, color: color || roomData.players[name].color });
    });

    socket.on('keep_alive', (data) => {
        const { name, room } = data;
        const roomData = rooms[room];
        if (roomData && roomData.players[name]) {
            roomData.players[name].pendingDisconnect = false;
            roomData.players[name].lastSeen = Date.now();
            if (roomData.players[name].disconnectTimer) {
                clearTimeout(roomData.players[name].disconnectTimer);
                roomData.players[name].disconnectTimer = null;
            }
        }
    });

    socket.on('explicit_exit', (data) => {
        const playerInfo = playerSockets[socket.id];
        if (!playerInfo) return;
        const { room, name } = playerInfo;
        const roomData = rooms[room];
        console.log(`🚪 Явный выход: ${name}`);
        if (roomData && roomData.players[name]) {
            roomData.players[name].explicitExit = true;
            if (roomData.players[name].disconnectTimer) clearTimeout(roomData.players[name].disconnectTimer);
            delete roomData.players[name];
            const leaveMsg = { name: '⚡СИСТЕМА', text: `Боец ${name} вышел`, color: '#ff4444', timestamp: Date.now() };
            roomData.messages.push(leaveMsg);
            io.to(room).emit('receive_msg', leaveMsg);
            io.to(room).emit('player_left', { name });
        }
        delete playerSockets[socket.id];
        saveData();
        socket.disconnect(true);
    });

    socket.on('gps_sync', (data) => {
        if (!data || !data.lat || !data.lng) return;
        const playerInfo = playerSockets[socket.id];
        if (!playerInfo) return;
        const { room, name } = playerInfo;
        const roomData = rooms[room];
        if (!roomData || !roomData.players[name]) return;
        roomData.players[name].lat = data.lat;
        roomData.players[name].lng = data.lng;
        roomData.players[name].lastSeen = Date.now();
        socket.to(room).emit('player_move', { name, lat: data.lat, lng: data.lng, color: playerInfo.color });
    });

    socket.on('new_obj', (objData) => {
        if (!objData || !objData.id || !objData.type) return;
        const playerInfo = playerSockets[socket.id];
        if (!playerInfo) return;
        const { room } = playerInfo;
        const roomData = rooms[room];
        if (!roomData) return;
        roomData.objects[objData.id] = {
            type: objData.type, lat: objData.lat, lng: objData.lng,
            start: objData.start, end: objData.end,
            creator: objData.creator, created: Date.now()
        };
        console.log(`📌 ${objData.type} от ${objData.creator} | Всего: ${Object.keys(roomData.objects).length}`);
        io.to(room).emit('draw', objData);
        saveData();
    });

    socket.on('delete_obj', (objectId) => {
        if (!objectId) return;
        const playerInfo = playerSockets[socket.id];
        if (!playerInfo) return;
        const { room } = playerInfo;
        const roomData = rooms[room];
        if (!roomData || !roomData.objects[objectId]) return;
        delete roomData.objects[objectId];
        io.to(room).emit('remove_obj', objectId);
        saveData();
    });

    socket.on('chat_msg', (msgData) => {
        const playerInfo = playerSockets[socket.id];
        if (!playerInfo) return;
        const { room, name, color } = playerInfo;
        const roomData = rooms[room];
        if (!roomData) return;
        const message = { name: msgData.name || name, text: msgData.text || msgData, color: msgData.color || color, timestamp: Date.now() };
        roomData.messages.push(message);
        if (roomData.messages.length > 500) roomData.messages = roomData.messages.slice(-500);
        io.to(room).emit('receive_msg', message);
    });

    socket.on('disconnect', (reason) => {
        const playerInfo = playerSockets[socket.id];
        if (!playerInfo) return;
        const { room, name } = playerInfo;
        const roomData = rooms[room];
        console.log(`🔌 Отключение: ${name} [${reason}]`);
        
        if (roomData && roomData.players[name]) {
            if (reason === 'io client disconnect' || roomData.players[name].explicitExit) {
                console.log(`🚪 ${name} вышел сам — удаляем сразу`);
                if (roomData.players[name].disconnectTimer) clearTimeout(roomData.players[name].disconnectTimer);
                delete roomData.players[name];
                const leaveMsg = { name: '⚡СИСТЕМА', text: `Боец ${name} вышел`, color: '#ff4444', timestamp: Date.now() };
                roomData.messages.push(leaveMsg);
                io.to(room).emit('receive_msg', leaveMsg);
                io.to(room).emit('player_left', { name });
            } else {
                console.log(`⏳ ${name} отключен — ждем 15 минут`);
                roomData.players[name].pendingDisconnect = true;
                roomData.players[name].disconnectTime = Date.now();
                roomData.players[name].disconnectTimer = setTimeout(() => {
                    const player = roomData.players[name];
                    if (player && player.pendingDisconnect) {
                        console.log(`🗑️ ${name} удален (не вернулся за 15 мин)`);
                        delete roomData.players[name];
                        const leaveMsg = { name: '⚡СИСТЕМА', text: `Боец ${name} отключился (15 мин)`, color: '#ff4444', timestamp: Date.now() };
                        roomData.messages.push(leaveMsg);
                        io.to(room).emit('receive_msg', leaveMsg);
                        io.to(room).emit('player_left', { name });
                    }
                }, DISCONNECT_TIMEOUT);
            }
        }
        delete playerSockets[socket.id];
        saveData();
    });
});

app.get('/api/status', (req, res) => {
    const now = new Date();
    const midnight = new Date(now); midnight.setHours(24, 0, 0, 0);
    res.json({
        rooms: Object.keys(rooms).length,
        totalPlayers: Object.values(rooms).reduce((s, r) => s + Object.keys(r.players).length, 0),
        totalObjects: Object.values(rooms).reduce((s, r) => s + Object.keys(r.objects).length, 0),
        disconnectTimeout: `${DISCONNECT_TIMEOUT / 60000} минут`,
        timeUntilMidnightClear: `${Math.floor((midnight - now) / 60000)} минут`,
        uptime: Math.floor(process.uptime())
    });
});

app.get('/api/clear', (req, res) => { clearAllObjects(); res.json({ success: true }); });

server.listen(PORT, '0.0.0.0', () => {
    console.log('════════════════════════════════════════');
    console.log('🦂 ScorpGEO TACTICAL v5.6 🦂');
    console.log('════════════════════════════════════════');
    console.log(`📍 Порт: ${PORT}`);
    console.log(`⏱️ Таймаут: ${DISCONNECT_TIMEOUT / 60000} МИНУТ`);
    console.log(`🚪 Явный выход: МГНОВЕННО`);
    console.log(`🕛 Очистка через: ${Math.floor(getTimeUntilMidnight() / 60000)} мин`);
    console.log('════════════════════════════════════════');
});

process.on('uncaughtException', (err) => { console.error('❌', err.message); saveData(); });
process.on('SIGTERM', () => { saveData(); process.exit(0); });
