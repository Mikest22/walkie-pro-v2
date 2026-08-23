import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { setupSignaling } from './signaling.js';
import { iceServersHandler, getIceServers } from './turn.js';

dotenv.config();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors({ origin: process.env.CLIENT_URL || '*' }));
app.use(express.json());

// API diagnóstico
app.get('/api/health', (req,res)=> res.json({ status:'ok', time: Date.now(), rooms: 'in-memory' }));
app.get('/api/ice-servers', iceServersHandler);
app.get('/api/config', (req,res)=> {
  const servers = getIceServers();
  const hasTurn = servers.some(s=> (s.urls||'').toString().includes('turn'));
  res.json({ hasTurn, iceCount: servers.length, stun: true });
});

const clientPath = path.join(__dirname, '..', 'client');
app.use(express.static(clientPath));

// SPA fallback para /radio/:code
app.get('/radio/:code', (req,res)=> {
  res.sendFile(path.join(clientPath, 'index.html'));
});

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: process.env.CLIENT_URL || '*', methods: ['GET','POST'] },
  pingInterval: 15000,
  pingTimeout: 20000,
  transports: ['websocket','polling']
});

setupSignaling(io);

const PORT = process.env.PORT || 3000;
server.listen(PORT, ()=> {
  console.log(`
📻 Walkie Pro V2 running on :${PORT}`);
  console.log(`   Client: http://localhost:${PORT}`);
  console.log(`   Health: http://localhost:${PORT}/api/health`);
  console.log(`   ICE: ${JSON.stringify(getIceServers().map(s=>s.urls)).slice(0,200)}
`);
});
