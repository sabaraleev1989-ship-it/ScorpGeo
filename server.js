const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const path = require('path');

app.use(express.static('public'));

const rooms = {};

io.on('connection', (socket) => {
    socket.on('join_room', (data) => {
        const { roomID, password, callsign, team } = data;
        if (!rooms[roomID]) {
            rooms[roomID] = { password, users: {}, objects: [] };
        }
        if (rooms[roomID].password !== password) {
            return socket.emit('error_msg', 'Неверный код доступа!');
        }
        socket.join(roomID);
        socket.roomID = roomID;
        rooms[roomID].users[socket.id] = { callsign, team, coords: null };
        socket.emit('init_data', {
            users: rooms[roomID].users,
            objects: rooms[roomID].objects
        });
        socket.to(roomID).emit('user_joined', { id: socket.id, callsign, team });
    });

    socket.on('update_gps', (coords) => {
        if (socket.roomID && rooms[socket.roomID]) {
            rooms[socket.roomID].users[socket.id].coords = coords;
            io.to(socket.roomID).emit('presence_update', { id: socket.id, coords });
        }
    });

    socket.on('new_object', (obj) => {
        if (socket.roomID && rooms[socket.roomID]) {
            rooms[socket.roomID].objects.push(obj);
            socket.to(socket.roomID).emit('object_added', obj);
        }
    });

    socket.on('disconnect', () => {
        if (socket.roomID && rooms[socket.roomID]) {
            io.to(socket.roomID).emit('user_left', socket.id);
            delete rooms[socket.roomID].users[socket.id];
        }
    });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => console.log('Server running on port ' + PORT));
