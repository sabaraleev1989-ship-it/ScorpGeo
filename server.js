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
        const rName = data.room;
        // Если комнаты нет, создаем её с тем паролем, который ввел первый игрок
        if (!rooms[rName]) {
            rooms[rName] = { password: data.pass, objects: [] };
        }
        
        if (rooms[rName].password !== data.pass) {
            return socket.emit('auth_error', 'НЕВЕРНЫЙ ПАРОЛЬ КОМНАТЫ');
        }

        socket.join(rName);
        socket.room = rName;
        socket.userName = data.name;
        socket.userColor = `hsl(${Math.random() * 360}, 100%, 60%)`;
        
        rooms[rName].objects.forEach(obj => socket.emit('draw', obj));
        socket.emit('login_success', { color: socket.userColor });
    });

    socket.on('gps_sync', (data) => {
        if (socket.room) socket.to(socket.room).emit('player_move', { ...data, color: socket.userColor });
    });

    socket.on('new_obj', (obj) => {
        if (socket.room) {
            obj.owner = socket.id; // Помечаем, чей объект
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

    socket.on('clear_my', () => {
        if (socket.room) {
            const toRemove = rooms[socket.room].objects.filter(o => o.owner === socket.id);
            rooms[socket.room].objects = rooms[socket.room].objects.filter(o => o.owner !== socket.id);
            toRemove.forEach(o => io.to(socket.room).emit('remove_obj', o.id));
        }
    });

    socket.on('chat_msg', (msg) => {
        if (socket.room) io.to(socket.room).emit('receive_msg', msg);
    });
});

http.listen(PORT, () => console.log('SCORPION V18 START'));
