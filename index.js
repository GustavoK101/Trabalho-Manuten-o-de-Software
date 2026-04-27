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

  io.on('connection', (socket) => {
    registerChatHandlers(io, socket, db);
  });

  const port = process.env.PORT || 3000;

  server.listen(port, () => {
    console.log(`server running at http://localhost:${port}`);
  });
}
