const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const path = require('path');

const PORT = process.env.PORT || 3000;

// Хранилище данных комнат (в оперативной памяти)
const rooms = {}; 

app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

io.on('connection', (socket) => {
    // Вход в комнату
    socket.on('join_room', (data) => {
        const rName = data.room;
        
        // Если комнаты нет — создаем и фиксируем пароль первого вошедшего
        if (!rooms[rName]) {
            rooms[rName] = { 
                password: data.pass, 
                objects: [] 
            };
        }
        
        // Проверка пароля
        if (rooms[rName].password !== data.pass) {
            return socket.emit('auth_error', 'НЕВЕРНЫЙ ПАРОЛЬ КОМНАТЫ');
        }

        socket.join(rName);
        socket.room = rName;
        socket.userName = data.name;
        
        // Генерируем цвет один раз при входе
        socket.userColor = `hsl(${Math.random() * 360}, 100%, 60%)`;
        
        // Отправляем новому игроку все объекты, которые уже есть в этой комнате
        rooms[rName].objects.forEach(obj => {
            socket.emit('draw', obj);
        });

        // Подтверждаем вход
        socket.emit('login_success', { color: socket.userColor });
        console.log(`[БОЕЦ] ${data.name} вошел в комнату: ${rName}`);
    });

    // Передача координат GPS
    socket.on('gps_sync', (data) => {
        if (socket.room) {
            socket.to(socket.room).emit('player_move', { 
                ...data, 
                color: socket.userColor 
            });
        }
    });

    // Добавление нового объекта (враг, точка, стрелка, линейка)
    socket.on('new_obj', (obj) => {
        if (socket.room) {
            obj.owner = socket.id; // Привязываем объект к ID создателя
            rooms[socket.room].objects.push(obj);
            io.to(socket.room).emit('draw', obj);
        }
    });

    // Удаление одного объекта (ластик)
    socket.on('delete_obj', (id) => {
        if (socket.room) {
            rooms[socket.room].objects = rooms[socket.room].objects.filter(o => o.id !== id);
            io.to(socket.room).emit('remove_obj', id);
        }
    });

    // Сброс только своих объектов
    socket.on('clear_my', () => {
        if (socket.room) {
            const roomData = rooms[socket.room];
            const myObjects = roomData.objects.filter(o => o.owner === socket.id);
            
            // Удаляем их из массива сервера
            roomData.objects = roomData.objects.filter(o => o.owner !== socket.id);
            
            // Даем команду всем клиентам удалить эти ID
            myObjects.forEach(obj => {
                io.to(socket.room).emit('remove_obj', obj.id);
            });
        }
    });

    // Радиообмен (Чат)
    socket.on('chat_msg', (msg) => {
        if (socket.room) {
            io.to(socket.room).emit('receive_msg', msg);
        }
    });

    socket.on('disconnect', () => {
        console.log(`Пользователь ${socket.userName || 'Неизвестный'} отключился`);
    });
});

http.listen(PORT, () => {
    console.log(`====================================`);
    console.log(`SCORPION TACTICAL V18.3 ONLINE`);
    console.log(`PORT: ${PORT}`);
    console.log(`====================================`);
});
