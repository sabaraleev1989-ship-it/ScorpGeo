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
const DATA_FILE = path.join(__dirname, 'tactical_data.json');
let ACCESS_CODE = '2026';

const rooms = {};
const playerSockets = {};

app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

function loadData() {
    try {
        if (fs.existsSync(DATA_FILE)) {
            const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
            if (data.accessCode) ACCESS_CODE = data.accessCode;
            console.log(`💾 Данные загружены. Код доступа: ${ACCESS_CODE}`);
            return data;
        }
    } catch (err) { console.error('❌ Ошибка загрузки:', err.message); }
    return {};
}

function saveData() {
    try {
        const dataToSave = { accessCode: ACCESS_CODE };
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
    if (roomName === 'accessCode') continue;
    const normalizedRoom = roomName.toUpperCase();
    rooms[normalizedRoom] = {
        players: {},
        objects: data.objects || {},
        messages: data.messages || [],
        lastActive: data.lastActive || Date.now()
    };
    console.log(`📂 Комната ${normalizedRoom} (загружена): ${Object.keys(data.objects || {}).length} объектов`);
}

setInterval(saveData, 300000);

function clearAllObjects() {
    console.log('🕛 ПОЛНОЧЬ! Очистка всех меток...');
    for (const roomData of Object.values(rooms)) {
        const count = Object.keys(roomData.objects).length;
        roomData.objects = {};
        const clearMsg = { name: '⚡СИСТЕМА', text: `🕛 Полночь! Все метки очищены. Удалено: ${count}`, color: '#ffaa00', timestamp: Date.now() };
        roomData.messages.push(clearMsg);
    }
    saveData();
    io.emit('midnight_clear', { message: 'Все метки очищены (полночь)' });
    console.log('✅ Все метки очищены');
}

function resetAllSessions() {
    console.log('🌅 06:00 — Сброс всех сессий...');
    let totalDisconnected = 0;
    
    for (const [roomName, roomData] of Object.entries(rooms)) {
        const playerNames = Object.keys(roomData.players);
        for (const playerName of playerNames) {
            const player = roomData.players[playerName];
            if (player.socketId) {
                const playerSocket = io.sockets.sockets.get(player.socketId);
                if (playerSocket) {
                    playerSocket.emit('force_disconnect', { reason: 'Утренний сброс сессий. Войдите заново.' });
                    playerSocket.disconnect(true);
                }
            }
            delete roomData.players[playerName];
            totalDisconnected++;
        }
        
        const resetMsg = {
            name: '⚡СИСТЕМА',
            text: '🌅 Новый день! Все сессии сброшены. Войдите заново.',
            color: '#ffaa00',
            timestamp: Date.now()
        };
        roomData.messages.push(resetMsg);
        io.to(roomName).emit('receive_msg', resetMsg);
        io.to(roomName).emit('session_reset', { message: 'Сессии сброшены' });
    }
    
    for (const [socketId, playerInfo] of Object.entries(playerSockets)) {
        const playerSocket = io.sockets.sockets.get(socketId);
        if (playerSocket) playerSocket.disconnect(true);
    }
    for (const key of Object.keys(playerSockets)) {
        delete playerSockets[key];
    }
    
    saveData();
    console.log(`🌅 Сброшено сессий: ${totalDisconnected}`);
}

function scheduleMorningReset() {
    const now = new Date();
    const morning = new Date(now);
    morning.setHours(6, 0, 0, 0);
    if (now >= morning) morning.setDate(morning.getDate() + 1);
    const timeUntilMorning = morning - now;
    console.log(`🌅 Утренний сброс запланирован через ${Math.floor(timeUntilMorning / 60000)} минут`);
    setTimeout(() => {
        resetAllSessions();
        setInterval(resetAllSessions, 24 * 60 * 60 * 1000);
    }, timeUntilMorning);
}

scheduleMorningReset();

function getTimeUntilMidnight() {
    const now = new Date();
    const midnight = new Date(now);
    midnight.setHours(24, 0, 0, 0);
    return midnight - now;
}
setTimeout(() => { clearAllObjects(); setInterval(clearAllObjects, 24 * 60 * 60 * 1000); }, getTimeUntilMidnight());

function getRandomColor() {
    const colors = ['#ff4444','#44ff44','#4444ff','#ffff44','#ff44ff','#44ffff','#ff8844','#8844ff','#44ff88','#ff4488','#88ff44','#ffaa00','#00aaff','#aa00ff','#ff00aa','#00ffaa','#aaff00'];
    return colors[Math.floor(Math.random() * colors.length)];
}

function getOrCreateRoom(roomName) {
    const normalized = roomName.toUpperCase();
    if (!rooms[normalized]) {
        rooms[normalized] = { players: {}, objects: {}, messages: [] };
        console.log(`🏠 Комната создана: ${normalized}`);
    }
    return rooms[normalized];
}

io.on('connection', (socket) => {
    console.log(`🔌 Подключение: ${socket.id}`);

    socket.on('get_access_code', () => {
        socket.emit('access_code', { code: ACCESS_CODE });
    });

    socket.on('change_access_code', (data) => {
        if (data.adminPass === 'Mpfp13zi') {
            ACCESS_CODE = data.newCode;
            console.log(`🔑 Код изменен: ${ACCESS_CODE}`);
            socket.emit('code_changed', { success: true, newCode: ACCESS_CODE });
            saveData();
        } else {
            socket.emit('code_changed', { success: false, error: 'Неверный админ-пароль' });
        }
    });

    socket.on('player_online', (data) => {
        const { name, room } = data;
        const normalizedRoom = room.toUpperCase();
        const roomData = rooms[normalizedRoom];
        if (!roomData || !roomData.players[name]) return;
        roomData.players[name].online = true;
        io.to(normalizedRoom).emit('player_status_change', { name, online: true });
    });

    socket.on('player_offline', (data) => {
        const { name, room } = data;
        const normalizedRoom = room.toUpperCase();
        const roomData = rooms[normalizedRoom];
        if (!roomData || !roomData.players[name]) return;
        roomData.players[name].online = false;
        io.to(normalizedRoom).emit('player_status_change', { name, online: false });
    });

    socket.on('join_room', (data) => {
        const room = data.room.trim().toUpperCase();
        const name = data.name.trim();
        const pass = data.pass;
        const accessCode = data.accessCode;
        const team = (data.team || data.room).trim().toUpperCase();
        
        if (accessCode !== ACCESS_CODE) {
            socket.emit('login_failed', { reason: 'Неверный код доступа' });
            return;
        }
        
        if (pass !== ROOM_PASSWORD) {
            socket.emit('login_failed', { reason: 'Неверный пароль' });
            return;
        }
        if (!room || !name) {
            socket.emit('login_failed', { reason: 'Заполните все поля' });
            return;
        }
        
        const roomData = getOrCreateRoom(room);
        
        if (roomData.players[name]) {
            roomData.players[name].socketId = socket.id;
            roomData.players[name].pendingDisconnect = false;
            roomData.players[name].explicitExit = false;
            roomData.players[name].online = true;
        } else {
            roomData.players[name] = {
                color: getRandomColor(),
                lat: 55.7558, lng: 37.6176,
                socketId: socket.id,
                team: team,
                pendingDisconnect: false,
                explicitExit: false,
                online: true,
                lastSeen: Date.now()
            };
        }
        
        const playerColor = roomData.players[name].color;
        playerSockets[socket.id] = { name, team: team, room, color: playerColor };
        socket.join(room);
        
        socket.emit('login_success', {
            color: playerColor,
            name,
            room,
            objectsCount: Object.keys(roomData.objects).length,
            accessCode: ACCESS_CODE
        });
        
        const allObjects = Object.entries(roomData.objects).map(([id, obj]) => ({ id, ...obj }));
        allObjects.forEach(obj => socket.emit('draw', obj));
        
        const existingPlayers = [];
        for (const [pName, pData] of Object.entries(roomData.players)) {
            if (pName !== name) {
                existingPlayers.push({ 
                    name: pName,
                    color: pData.color,
                    lat: pData.lat,
                    lng: pData.lng,
                    online: pData.online !== false,
                    team: pData.team
                });
            }
        }
        if (existingPlayers.length > 0) socket.emit('existing_players', existingPlayers);
        if (roomData.messages.length > 0) roomData.messages.slice(-100).forEach(msg => socket.emit('receive_msg', msg));
        
        socket.to(room).emit('player_joined', {
            name,
            color: playerColor,
            lat: 55.7558,
            lng: 37.6176,
            online: true,
            team: team
        });
        
        const joinMsg = {
            name: '⚡СИСТЕМА',
            text: `Боец ${name} на связи`,
            color: '#44ff44',
            timestamp: Date.now()
        };
        roomData.messages.push(joinMsg);
        io.to(room).emit('receive_msg', joinMsg);
    });

    socket.on('rejoin_room', (data) => {
        const room = data.room.trim().toUpperCase();
        const name = data.name;
        const roomData = rooms[room];
        if (!roomData || !roomData.players[name]) return;
        
        roomData.players[name].socketId = socket.id;
        roomData.players[name].pendingDisconnect = false;
        roomData.players[name].explicitExit = false;
        roomData.players[name].online = true;
        
        playerSockets[socket.id] = {
            name,
            team: roomData.players[name].team || room,
            room,
            color: roomData.players[name].color
        };
        socket.join(room);
        
        const ep = [];
        for (const [pn, pd] of Object.entries(roomData.players)) {
            if (pn !== name) {
                ep.push({
                    name: pn,
                    color: pd.color,
                    lat: pd.lat,
                    lng: pd.lng,
                    online: pd.online !== false,
                    team: pd.team
                });
            }
        }
        socket.emit('existing_players', ep);
        socket.to(room).emit('player_status_change', { name, online: true });
    });

    socket.on('keep_alive', (data) => {
        const name = data.name;
        const room = data.room.toUpperCase();
        const roomData = rooms[room];
        if (roomData && roomData.players[name]) {
            roomData.players[name].lastSeen = Date.now();
            if (roomData.players[name].online === false) {
                roomData.players[name].online = true;
                io.to(room).emit('player_status_change', { name, online: true });
            }
        }
    });

    socket.on('explicit_exit', (data) => {
        const playerInfo = playerSockets[socket.id];
        if (!playerInfo) return;
        const { room, name } = playerInfo;
        const roomData = rooms[room];
        if (roomData && roomData.players[name]) {
            roomData.players[name].explicitExit = true;
            delete roomData.players[name];
            const lm = {
                name: '⚡СИСТЕМА',
                text: `Боец ${name} вышел`,
                color: '#ff4444',
                timestamp: Date.now()
            };
            roomData.messages.push(lm);
            io.to(room).emit('receive_msg', lm);
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
        socket.to(room).emit('player_move', {
            name,
            lat: data.lat,
            lng: data.lng,
            color: playerInfo.color
        });
    });

    socket.on('new_obj', (objData) => {
        if (!objData || !objData.id || !objData.type) return;
        const playerInfo = playerSockets[socket.id];
        if (!playerInfo) return;
        const { room } = playerInfo;
        const roomData = rooms[room];
        if (!roomData) return;
        roomData.objects[objData.id] = {
            type: objData.type,
            lat: objData.lat,
            lng: objData.lng,
            start: objData.start,
            end: objData.end,
            writer: objData.creator,
            created: Date.now()
        };
        io.to(room).emit('draw', objData);
        saveData();
    });

    // ===== НОВОЕ: удаление с проверкой прав =====
    socket.on('delete_obj', (objectId) => {
        const playerInfo = playerSockets[socket.id];
        if (!playerInfo) return;
        const { room, name } = playerInfo;
        const roomData = rooms[room];
        if (!roomData || !roomData.objects[objectId]) return;

        const obj = roomData.objects[objectId];
        const isOwner = obj.writer === name;
        const hasStar = name.includes('⭐');
        if (!isOwner && !hasStar) return; // нет прав

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
        const msg = {
            name: msgData.name || name,
            text: msgData.text || msgData,
            color: msgData.color || color,
            timestamp: Date.now()
        };
        roomData.messages.push(msg);
        if (roomData.messages.length > 500) roomData.messages = roomData.messages.slice(-500);
        io.to(room).emit('receive_msg', msg);
    });

    // ===== НОВОЕ: ретрансляция статуса (убит/ранен) =====
    socket.on('player_custom_status', (data) => {
        const playerInfo = playerSockets[socket.id];
        if (!playerInfo) return;
        const { room } = playerInfo;
        socket.to(room).emit('player_custom_status', data);
    });

    socket.on('disconnect', (reason) => {
        const playerInfo = playerSockets[socket.id];
        if (!playerInfo) return;
        const { room, name } = playerInfo;
        const roomData = rooms[room];
        if (roomData && roomData.players[name]) {
            roomData.players[name].lastSeen = Date.now();
            if (roomData.players[name].online !== false) {
                roomData.players[name].online = false;
                io.to(room).emit('player_status_change', { name, online: false });
            }
        }
        delete playerSockets[socket.id];
    });
});

app.get('/api/status', (req, res) => {
    res.json({
        rooms: Object.keys(rooms).length,
        totalPlayers: Object.values(rooms).reduce((s, r) => s + Object.keys(r.players).length, 0),
        accessCode: ACCESS_CODE,
        uptime: Math.floor(process.uptime())
    });
});

server.listen(PORT, '0.0.0.0', () => {
    console.log('🦂 ScorpGEO v11.0 — Игнор регистра, Статусы, Умное удаление');
    console.log(`🔑 Код доступа: ${ACCESS_CODE}`);
    console.log(`📍 Порт: ${PORT}`);
});
