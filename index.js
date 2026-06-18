import express from 'express';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Server } from 'socket.io';
import { openDb } from './db.js';
import { registerChatHandlers } from './chat.js';
import { log } from './logger.js';

const db = await openDb();
log('[server] database ready');

const app = express();
const server = createServer(app);
const io = new Server(server, {
  connectionStateRecovery: {}
});

const __dirname = dirname(fileURLToPath(import.meta.url));

app.get('/', (req, res) => {
  res.sendFile(join(__dirname, 'index.html'));
});

// Single source of truth for presence (one process => one shared map).
const onlineUsers = new Map(); // socketId -> username

function broadcastPresence() {
  const users = Array.from(onlineUsers.entries()).map(([id, name]) => ({ id, name }));
  io.emit('user count', users.length);
  io.emit('online users', users);
}

io.on('connection', (socket) => {
  const username = socket.handshake.auth.username?.trim().slice(0, 30) || 'Anônimo';
  onlineUsers.set(socket.id, username);
  log(`[conn] ${username} connected (${socket.id}), recovered=${socket.recovered}`);
  broadcastPresence();
  io.emit('system message', `${username} entrou no chat`);

  socket.on('private message', (toSocketId, msg, callback) => {
    // Ack so the client (running with `retries`) doesn't resend and deliver
    // the same private message multiple times.
    if (typeof callback !== 'function') callback = () => {};
    if (typeof msg !== 'string' || msg.trim().length === 0 || msg.length > 500) {
      return callback({ error: 'invalid message' });
    }
    const fromName = onlineUsers.get(socket.id) || 'Anônimo';
    // Last arg flags whether the recipient is the sender (echo) so the client
    // doesn't have to guess direction from the (non-unique) display name.
    socket.to(toSocketId).emit('private message', socket.id, fromName, msg, false);
    socket.emit('private message', toSocketId, fromName, msg, true);
    callback();
  });

  registerChatHandlers(io, socket, db);

  socket.on('disconnect', (reason) => {
    onlineUsers.delete(socket.id);
    log(`[conn] ${username} disconnected (${socket.id}), reason=${reason}`);
    broadcastPresence();
    io.emit('system message', `${username} saiu do chat`);
  });
});

const port = process.env.PORT || 3000;

server.listen(port, () => {
  log(`[server] running at http://localhost:${port}`);
});
