import { RoomManager } from './rooms.js';

export function setupSignaling(io) {
  const rooms = new RoomManager();

  io.on('connection', (socket) => {
    console.log(`[conn] ${socket.id}`);
    let currentRoom = null;
    let currentUser = null;

    socket.on('join-room', ({ roomCode, userName, deviceId }) => {
      try {
        if (!roomCode || !userName) return socket.emit('error-msg', { message: 'Faltan datos de sala/nombre' });
        roomCode = roomCode.toUpperCase().trim();
        currentRoom = roomCode;
        currentUser = {
          id: socket.id,
          name: userName.slice(0,24),
          deviceId: deviceId || socket.id,
          joinedAt: Date.now(),
        };
        socket.join(roomCode);
        const room = rooms.addUser(roomCode, socket.id, currentUser);

        // Notificar al que entra lista actual + él mismo
        socket.emit('joined-room', { roomCode, users: rooms.listUsers(roomCode), you: currentUser });
        // Notificar a otros que entró alguien
        socket.to(roomCode).emit('user-joined', { user: currentUser });

        // Enviar estado de canal
        io.to(roomCode).emit('channel-state', { 
          speakerId: room.currentSpeaker,
          speaker: room.currentSpeaker ? room.users.get(room.currentSpeaker) || null : null
        });
        console.log(`[join] ${userName} -> ${roomCode} (${room.users.size})`);
      } catch(e){ console.error(e); }
    });

    // Señalización WebRTC
    socket.on('offer', ({ targetId, sdp, roomCode }) => {
      if (!targetId) return;
      io.to(targetId).emit('offer', { fromId: socket.id, sdp, roomCode });
    });
    socket.on('answer', ({ targetId, sdp, roomCode }) => {
      if (!targetId) return;
      io.to(targetId).emit('answer', { fromId: socket.id, sdp, roomCode });
    });
    socket.on('ice-candidate', ({ targetId, candidate, roomCode }) => {
      if (!targetId || !candidate) return;
      io.to(targetId).emit('ice-candidate', { fromId: socket.id, candidate, roomCode });
    });

    // Control de canal PTT - SERVIDOR ES AUTORIDAD
    socket.on('request-talk', ({ roomCode }) => {
      const result = rooms.tryAcquireChannel(roomCode, socket.id);
      if (result.granted) {
        io.to(roomCode).emit('talk-granted', { speakerId: socket.id, speaker: rooms.getRoom(roomCode)?.users.get(socket.id) });
      } else {
        socket.emit('channel-busy', { busyBy: result.busyBy || null });
        // opcional: emitir a todos estado
        const room = rooms.getRoom(roomCode);
        if (room) io.to(roomCode).emit('channel-state', { speakerId: room.currentSpeaker, speaker: room.currentSpeaker ? room.users.get(room.currentSpeaker) : null });
      }
    });

    socket.on('release-talk', ({ roomCode }) => {
      const released = rooms.releaseChannel(roomCode, socket.id);
      if (released) {
        io.to(roomCode).emit('talk-released', { speakerId: socket.id });
        io.to(roomCode).emit('channel-state', { speakerId: null, speaker: null });
      }
    });

    socket.on('leave-room', ({ roomCode }) => {
      if (!roomCode) return;
      const res = rooms.removeUser(roomCode, socket.id);
      if (res) {
        socket.leave(roomCode);
        socket.to(roomCode).emit('user-left', { userId: socket.id, user: res.user });
        io.to(roomCode).emit('users-update', { users: rooms.listUsers(roomCode) });
        if (res.room.currentSpeaker === null) {
          io.to(roomCode).emit('channel-state', { speakerId: null, speaker: null });
        }
      }
      currentRoom = null;
    });

    socket.on('disconnect', (reason) => {
      console.log(`[disc] ${socket.id} ${reason} room=${currentRoom}`);
      if (currentRoom) {
        const res = rooms.removeUser(currentRoom, socket.id);
        if (res) {
          socket.to(currentRoom).emit('user-left', { userId: socket.id, user: res.user });
          io.to(currentRoom).emit('users-update', { users: rooms.listUsers(currentRoom) });
          if (res.room.currentSpeaker === socket.id) {
            io.to(currentRoom).emit('talk-released', { speakerId: socket.id });
            io.to(currentRoom).emit('channel-state', { speakerId: null, speaker: null });
          }
        }
      }
    });

    // Ping para detectar desconexiones en móvil
    socket.on('ping-check', (cb) => { if (typeof cb === 'function') cb('pong'); });
  });

  return rooms;
}