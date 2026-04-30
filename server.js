const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const path = require('path');

const PORT = process.env.PORT || 3000;

// Хранилище данных комнат
const rooms = {};

app.use(express.static(__dirname));

io.on('connection', (socket) => {
    // Вход в комнату
    socket.on('join_room', (data) => {
        socket.join(data.room);
        socket.room = data.room;
        socket.userName = data.name;
        
        if (!rooms[data.room]) {
            rooms[data.room] = { objects: [] };
        }
        
        // Отправляем старые объекты новому игроку
        rooms[data.room].objects.forEach(obj => {
            socket.emit('draw', obj);
        });
        
        socket.emit('login_success');
    });

    // Синхронизация GPS
    socket.on('gps_sync', (data) => {
        if (socket.room) {
            socket.to(socket.room).emit('player_move', data);
        }
    });

    // Создание нового объекта (точка, стрела, линейка)
    socket.on('new_obj', (obj) => {
        if (socket.room) {
            rooms[socket.room].objects.push(obj);
            io.to(socket.room).emit('draw', obj);
        }
    });

    // ТОЧЕЧНОЕ УДАЛЕНИЕ (Для Ластика)
    socket.on('delete_obj', (id) => {
        if (socket.room) {
            rooms[socket.room].objects = rooms[socket.room].objects.filter(o => o.id !== id);
            io.to(socket.room).emit('remove_obj', id);
        }
    });

    // РАДИООБМЕН (Чат)
    socket.on('chat_msg', (msg) => {
        if (socket.room) {
            io.to(socket.room).emit('receive_msg', msg);
        }
    });

    // ПОЛНАЯ ОЧИСТКА
    socket.on('clear', () => {
        if (socket.room) {
            rooms[socket.room].objects = [];
            io.to(socket.room).emit('clear_all');
        }
    });

    socket.on('disconnect', () => {
        console.log('User disconnected');
    });
});

http.listen(PORT, () => {
    console.log(`SCORPION SERVER V16.1 RUNNING ON PORT ${PORT}`);
});
