const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const path = require('path');

const PORT = process.env.PORT || 3000;

const rooms = {};

// Это заставит сервер отдавать index.html при заходе на главную страницу
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Раздача остальных файлов (скриптов, картинок) из текущей папки
app.use(express.static(__dirname));

io.on('connection', (socket) => {
    socket.on('join_room', (data) => {
        socket.join(data.room);
        socket.room = data.room;
        socket.userName = data.name;
        if (!rooms[data.room]) rooms[data.room] = { objects: [] };
        rooms[data.room].objects.forEach(obj => socket.emit('draw', obj));
        socket.emit('login_success');
    });

    socket.on('gps_sync', (data) => {
        if (socket.room) socket.to(socket.room).emit('player_move', data);
    });

    socket.on('new_obj', (obj) => {
        if (socket.room) {
            rooms[socket.room].objects.push(obj);
            io.to(socket.room).emit('draw', obj);
        }
    });

    socket.on('delete_obj', (id) => {
        if (socket.room) {
            rooms[socket.room].objects = rooms[socket.room].objects.filter(o => o.id !== id);
            io.to(socket.room).emit('remove_obj', id);
        }
    });

    socket.on('chat_msg', (msg) => {
        if (socket.room) io.to(socket.room).emit('receive_msg', msg);
    });

    socket.on('clear', () => {
        if (socket.room) {
            rooms[socket.room].objects = [];
            io.to(socket.room).emit('clear_all');
        }
    });
});

http.listen(PORT, () => console.log(`SERVER RUNNING ON PORT ${PORT}`));
