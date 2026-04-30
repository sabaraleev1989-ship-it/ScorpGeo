const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);

const rooms = {};

io.on('connection', (socket) => {
    socket.on('join_room', (data) => {
        socket.join(data.room);
        socket.room = data.room;
        socket.userName = data.name;
        if (!rooms[data.room]) rooms[data.room] = { objects: [] };
        socket.emit('login_success');
    });

    // Создание объекта
    socket.on('new_obj', (obj) => {
        if (socket.room) {
            rooms[socket.room].objects.push(obj);
            io.to(socket.room).emit('draw', obj);
        }
    });

    // ТОЧЕЧНОЕ УДАЛЕНИЕ (Для ластика)
    socket.on('delete_obj', (id) => {
        if (socket.room) {
            rooms[socket.room].objects = rooms[socket.room].objects.filter(o => o.id !== id);
            io.to(socket.room).emit('remove_obj', id);
        }
    });

    // ОЧИСТКА ВСЕГО
    socket.on('clear', () => {
        if (socket.room) {
            rooms[socket.room].objects = [];
            io.to(socket.room).emit('clear_all');
        }
    });

    // ЧАТ
    socket.on('chat_msg', (msg) => {
        if (socket.room) io.to(socket.room).emit('receive_msg', msg);
    });
});

http.listen(3000, () => console.log('Server V16.1 Started'));
