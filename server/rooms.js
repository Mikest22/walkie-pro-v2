export class RoomManager {
  constructor() {
    this.rooms = new Map(); // code -> { users: Map<socketId, user>, currentSpeaker: null, createdAt }
  }
  getOrCreate(code) {
    code = code.toUpperCase().trim().replace(/[^A-Z0-9-]/g, '-').slice(0,24) || 'GENERAL';
    if (!this.rooms.has(code)) {
      this.rooms.set(code, { code, users: new Map(), currentSpeaker: null, queue: [], createdAt: Date.now() });
    }
    return this.rooms.get(code);
  }
  addUser(roomCode, socketId, user) {
    const room = this.getOrCreate(roomCode);
    room.users.set(socketId, user);
    return room;
  }
  removeUser(roomCode, socketId) {
    const room = this.rooms.get(roomCode);
    if (!room) return null;
    const user = room.users.get(socketId);
    room.users.delete(socketId);
    if (room.currentSpeaker === socketId) room.currentSpeaker = null;
    if (room.users.size === 0) {
      // mantener 5 min por si reconecta
      setTimeout(() => { if (room.users.size===0) this.rooms.delete(roomCode); }, 5*60*1000);
    }
    return { room, user };
  }
  getRoom(code) { return this.rooms.get(code); }
  listUsers(code) {
    const room = this.rooms.get(code);
    if (!room) return [];
    return Array.from(room.users.values());
  }
  tryAcquireChannel(roomCode, socketId) {
    const room = this.rooms.get(roomCode);
    if (!room) return { granted: false, reason: 'NO_ROOM' };
    if (room.currentSpeaker && room.currentSpeaker !== socketId) {
      const speaker = room.users.get(room.currentSpeaker);
      return { granted: false, busyBy: speaker || null };
    }
    room.currentSpeaker = socketId;
    return { granted: true };
  }
  releaseChannel(roomCode, socketId) {
    const room = this.rooms.get(roomCode);
    if (!room) return false;
    if (room.currentSpeaker === socketId) {
      room.currentSpeaker = null;
      return true;
    }
    return false;
  }
}