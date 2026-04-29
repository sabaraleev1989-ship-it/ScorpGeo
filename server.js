const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const path = require('path');

app.use(express.static(path.join(__dirname, 'public')));

// Хранилище активных пользователей и их данных
const users = {};

io.on('connection', (socket) => {
    console.log('Новое подключение:', socket.id);

    socket.on('join_room', (data) => {
        const { roomID, callsign } = data;
        
        // Привязываем сокет к комнате
        socket.join(roomID);
        
        // Сохраняем данные пользователя
        users[socket.id] = {
            id: socket.id,
            roomID: roomID,
            callsign: callsign,
            lat: null,
            lng: null
        };

        console.log(`${callsign} вступил в канал: ${roomID}`);
    });

    // Обновление координат от бойца
    socket.on('update_gps', (coords) => {
        const user = users[socket.id];
        if (user) {
            user.lat = coords.lat;
            user.lng = coords.lng;

            // Рассылаем обновленные данные всем участникам ТОЛЬКО этой комнаты
            io.to(user.roomID).emit('presence_update', getRoomUsers(user.roomID));
        }
    });

    socket.on('disconnect', () => {
        const user = users[socket.id];
        if (user) {
            const room = user.roomID;
            delete users[socket.id];
            // Уведомляем остальных, что боец вышел из сети
            io.to(room).emit('user_disconnected', socket.id);
        }
        console.log('Пользователь отключился:', socket.id);
    });
});

// Функция для получения списка всех пользователей в конкретной комнате
function getRoomUsers(roomID) {
    const roomUsers = {};
    for (const id in users) {
        if (users[id].roomID === roomID) {
            roomUsers[id] = users[id];
        }
    }
    return roomUsers;
}

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
    console.log(`Сервер запущен на порту ${PORT}`);
});
