const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const path = require('path');

app.use(express.static(path.join(__dirname, 'public')));

let users = {};
let items = {}; // Храним объекты по комнатам

io.on('connection', (socket) => {
    // Вход в сеть
    socket.on('join_room', (data) => {
        socket.join(data.room);
        users[socket.id] = { ...data, id: socket.id };
        socket.emit('login_success');
        
        // Отправляем новому игроку уже существующие метки
        if (items[data.room]) {
            items[data.room].forEach(obj => socket.emit('draw', obj));
        }
    });

    // Синхронизация GPS
    socket.on('gps_sync', (pos) => {
        if (users[socket.id]) {
            users[socket.id].lat = pos.lat;
            users[socket.id].lng = pos.lng;
            io.to(users[socket.id].room).emit('users_sync', users);
        }
    });

    // Новая метка или стрелка
    socket.on('new_obj', (m) => {
        if (users[socket.id]) {
            const room = users[socket.id].room;
            if (!items[room]) items[room] = [];
            items[room].push(m);
            io.to(room).emit('draw', m);
        }
    });

    // Радиоканал
    socket.on('msg_send', (d) => {
        if (users[socket.id]) {
            io.to(users[socket.id].room).emit('msg_recv', d);
        }
    });

    // Отмена последнего действия
    socket.on('undo', () => {
        if (users[socket.id]) {
            const room = users[socket.id].room;
            const last = items[room] ? items[room].pop() : null;
            if (last) io.to(room).emit('del_obj', last.id);
        }
    });

    // Полная очистка
    socket.on('clear', () => {
        if (users[socket.id]) {
            const room = users[socket.id].room;
            items[room] = [];
            io.to(room).emit('reset');
        }
    });

    socket.on('disconnect', () => {
        delete users[socket.id];
    });
});

const PORT = process.env.PORT || 10000;
http.listen(PORT, () => {
    console.log('Сервер запущен на порту ' + PORT);
});
