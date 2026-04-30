// ... (подключение socket.io)
let users = {};
let items = {};

io.on('connection', (socket) => {
    socket.on('join_room', (data) => {
        socket.join(data.room);
        users[socket.id] = data;
        socket.emit('login_success');
    });

    socket.on('gps_sync', (pos) => {
        if(users[socket.id]) {
            users[socket.id].lat = pos.lat;
            users[socket.id].lng = pos.lng;
            io.to(users[socket.id].room).emit('users_sync', users);
        }
    });

    socket.on('new_obj', (m) => {
        if(users[socket.id]) {
            if(!items[users[socket.id].room]) items[users[socket.id].room] = [];
            items[users[socket.id].room].push(m);
            io.to(users[socket.id].room).emit('draw', m);
        }
    });

    socket.on('msg_send', (d) => {
        if(users[socket.id]) io.to(users[socket.id].room).emit('msg_recv', d);
    });

    socket.on('undo', () => {
        if(users[socket.id]) {
            let room = users[socket.id].room;
            let last = items[room] ? items[room].pop() : null;
            if(last) io.to(room).emit('del_obj', last.id);
        }
    });

    socket.on('clear', () => {
        if(users[socket.id]) {
            items[users[socket.id].room] = [];
            io.to(users[socket.id].room).emit('reset');
        }
    });
});
