const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const path = require('path');

app.use(express.static(path.join(__dirname, 'public')));

const users = {};
const rooms = {}; // Для хранения паролей комнат

io.on('connection', (socket) => {
    socket.on('join_room', (data) => {
        const { roomID, callsign, password } = data;

        // Простая защита: если комнаты нет, создаем её с этим паролем.
        // Если есть — проверяем пароль.
        if (!rooms[roomID]) {
            rooms[roomID] = password;
        } else if (rooms[roomID] !== password) {
            return socket.emit('error_msg', 'НЕВЕРНЫЙ КОД ДОСТУПА');
        }
        
        socket.join(roomID);
        users[socket.id] = { id: socket.id, roomID, callsign, lat: null, lng: null };
        
        // Отправляем подтверждение успешного входа
        socket.emit('login_success');
        console.log(`${callsign} вошел в ${roomID}`);
    });

    socket.on('update_gps', (coords) => {
        const user = users[socket.id];
        if (user) {
            user.lat = coords.lat;
            user.lng = coords.lng;
            io.to(user.roomID).emit('presence_update', getRoomUsers(user.roomID));
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
