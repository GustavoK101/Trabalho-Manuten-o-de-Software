import express from 'express';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Server } from 'socket.io';
import { availableParallelism } from 'node:os';
import cluster from 'node:cluster';
import { createAdapter, setupPrimary } from '@socket.io/cluster-adapter';
import { openDb } from './db.js';
import { registerChatHandlers } from './chat.js';

if (cluster.isPrimary) {
  const numCPUs = availableParallelism();
  for (let i = 0; i < numCPUs; i++) {
    cluster.fork({ PORT: 3000 + i });
  }
  setupPrimary();
} else {
  const db = await openDb();

  const app = express();
  const server = createServer(app);
  const io = new Server(server, {
    connectionStateRecovery: {},
    adapter: createAdapter()
  });

  const __dirname = dirname(fileURLToPath(import.meta.url));

  app.get('/', (req, res) => {
    res.sendFile(join(__dirname, 'index.html'));
  });

  const onlineUsers = new Map(); // socketId -> username

  function broadcastUserCount() {
    io.emit('user count', io.engine.clientsCount);
  }

  function broadcastOnlineUsers() {
    io.emit('online users', Array.from(onlineUsers.entries()).map(([id, name]) => ({ id, name })));
  }

  io.on('connection', (socket) => {
    const username = socket.handshake.auth.username?.trim().slice(0, 30) || 'Anônimo';
    onlineUsers.set(socket.id, username);
    broadcastUserCount();
    broadcastOnlineUsers();
    io.emit('system message', `${username} entrou no chat`);

    socket.on('private message', (toSocketId, msg) => {
      if (typeof msg !== 'string' || msg.trim().length === 0 || msg.length > 500) return;
      const fromName = onlineUsers.get(socket.id) || 'Anônimo';
      socket.to(toSocketId).emit('private message', socket.id, fromName, msg);
      socket.emit('private message', toSocketId, fromName, msg);
    });

    registerChatHandlers(io, socket, db);

    socket.on('disconnect', () => {
      onlineUsers.delete(socket.id);
      broadcastUserCount();
      broadcastOnlineUsers();
      io.emit('system message', `${username} saiu do chat`);
    });
  });

  const port = process.env.PORT || 3000;

  server.listen(port, () => {
    console.log(`server running at http://localhost:${port}`);
  });
}
