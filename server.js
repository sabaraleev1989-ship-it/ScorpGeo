const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const path = require('path');

app.use(express.static(path.join(__dirname, 'public')));

const users = {};
const rooms = {}; 
const roomMarkers = {}; // Хранилище меток для каждой комнаты

io.on('connection', (socket) => {
    socket.on('join_room', (data) => {
        const { roomID, callsign, password } = data;

        if (!rooms[roomID]) {
            rooms[roomID] = password;
            roomMarkers[roomID] = []; // Создаем пустой массив меток для новой комнаты
        } else if (rooms[roomID] !== password) {
            return socket.emit('error_msg', 'НЕВЕРНЫЙ КОД ДОСТУПА');
        }
        
        socket.join(roomID);
        users[socket.id] = { id: socket.id, roomID, callsign, lat: null, lng: null };
        
        socket.emit('login_success');
        // Отправляем новому игроку все существующие метки в этой комнате
        socket.emit('init_markers', roomMarkers[roomID]);
    });

    socket.on('update_gps', (coords) => {
        const user = users[socket.id];
        if (user) {
            user.lat = coords.lat;
            user.lng = coords.lng;
            io.to(user.roomID).emit('presence_update', getRoomUsers(user.roomID));
        }
    });

    // Обработка новой метки
    socket.on('new_map_marker', (markerData) => {
        const user = users[socket.id];
        if (user && roomMarkers[user.roomID]) {
            roomMarkers[user.roomID].push(markerData);
            io.to(user.roomID).emit('draw_marker', markerData);
        }
    });

    // Очистка всех меток
    socket.on('clear_all_markers', () => {
        const user = users[socket.id];
        if (user) {
            roomMarkers[user.roomID] = [];
            io.to(user.roomID).emit('markers_cleared');
        }
    });

    socket.on('disconnect', () => {
        const user = users[socket.id];
        if (user) {
            const room = user.roomID;
            delete users[socket.id];
            io.to(room).emit('user_disconnected', socket.id);
        }
    });
});

function getRoomUsers(roomID) {
    const roomUsers = {};
    for (const id in users) {
        if (users[id].roomID === roomID) roomUsers[id] = users[id];
    }
    return roomUsers;
}

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => console.log(`Server on ${PORT}`));
