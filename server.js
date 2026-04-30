const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);

app.use(express.static('public')); // Папка, где лежит твой index.html

// Глобальный объект для хранения данных комнат
const rooms = {};

io.on('connection', (socket) => {
    
    // 1. Вход в комнату
    socket.on('join_room', (data) => {
        const { room, name } = data;
        socket.join(room);
        socket.room = room;
        socket.userName = name;

        if (!rooms[room]) rooms[room] = { users: {}, objects: [] };
        
        // Добавляем пользователя в список
        rooms[room].users[socket.id] = { name: name, lat: 0, lng: 0 };

        socket.emit('login_success');
        
        // Оповещаем всех: "Заходит: Позывной"
        io.to(room).emit('player_joined', { name: name });
        
        // Сразу отправляем новичку текущую ситуацию в комнате
        socket.emit('presence_update', rooms[room].users);
        rooms[room].objects.forEach(obj => socket.emit('draw', obj));
    });

    // 2. Обновление GPS позиции
    socket.on('gps_sync', (data) => {
        if (socket.room && rooms[socket.room]) {
            rooms[socket.room].users[socket.id].lat = data.lat;
            rooms[socket.room].users[socket.id].lng = data.lng;
            
            // Рассылаем всем обновленные координаты бойцов
            io.to(socket.room).emit('presence_update', rooms[socket.room].users);
        }
    });

    // 3. Создание меток (враг, цель, стрелка)
    socket.on('new_obj', (obj) => {
        if (socket.room && rooms[socket.room]) {
            rooms[socket.room].objects.push(obj);
            io.to(socket.room).emit('draw', obj);
        }
    });

    // 4. РАДИООБМЕН (Сообщения чата)
    socket.on('chat_msg', (msg) => {
        if (socket.room) {
            io.to(socket.room).emit('receive_msg', msg);
        }
    });

    // 5. Очистка карты
    socket.on('clear', () => {
        if (socket.room && rooms[socket.room]) {
            rooms[socket.room].objects = [];
            io.to(socket.room).emit('clear_all');
        }
    });

    // 6. Выход игрока
    socket.on('disconnect', () => {
        if (socket.room && rooms[socket.room]) {
            delete rooms[socket.room].users[socket.id];
            io.to(socket.room).emit('presence_update', rooms[socket.room].users);
        }
    });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
    console.log(`Тактический сервер запущен на порту ${PORT}`);
});
