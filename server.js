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
        if(data.pass !== '1234') return socket.emit('auth_error', 'ОШИБКА ДОСТУПА');
        
        socket.join(data.room);
        socket.room = data.room;
        socket.userName = data.name;
        // Назначаем уникальный цвет игроку
        socket.userColor = `hsl(${Math.random() * 360}, 100%, 60%)`;
        
        if (!rooms[data.room]) rooms[data.room] = { objects: [] };
        rooms[data.room].objects.forEach(obj => socket.emit('draw', obj));
        socket.emit('login_success', { color: socket.userColor });
    });

    socket.on('gps_sync', (data) => {
        if (socket.room) {
            socket.to(socket.room).emit('player_move', { ...data, color: socket.userColor });
        }
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

http.listen(PORT, () => console.log(`SCORPION TACTICAL V17.2 ONLINE`));
