const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const path = require('path');

const PORT = process.env.PORT || 3000;
const rooms = {};

app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

io.on('connection', (socket) => {
    socket.on('join_room', (data) => {
        // Простая проверка пароля (можешь сменить '1234' на свой)
        if(data.pass !== '1234') return socket.emit('auth_error', 'НЕВЕРНЫЙ ПАРОЛЬ');
        
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

    socket.on('clear', () => {
        if (socket.room) {
            rooms[socket.room].objects = [];
            io.to(socket.room).emit('clear_all');
        }
    });

    socket.on('chat_msg', (msg) => {
        if (socket.room) io.to(socket.room).emit('receive_msg', msg);
    });
});

http.listen(PORT, () => console.log(`SCORPION V17 ACTIVE`));
