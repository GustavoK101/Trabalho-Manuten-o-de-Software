import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import { io as ioClient } from 'socket.io-client';
import express from 'express';
import { openDb } from '../db.js';
import { registerChatHandlers } from '../chat.js';

let httpServer, ioServer, db, port;
const onlineUsers = new Map();

beforeAll(async () => {
  process.env.DB_FILE = ':memory:';
  db = await openDb();

  const app = express();
  httpServer = createServer(app);
  ioServer = new Server(httpServer);

  ioServer.on('connection', (socket) => {
    const username = socket.handshake.auth.username?.trim().slice(0, 30) || 'Anônimo';
    onlineUsers.set(socket.id, username);

    ioServer.emit('system message', `${username} entrou no chat`);
    ioServer.emit('online users', Array.from(onlineUsers.entries()).map(([id, name]) => ({ id, name })));

    socket.on('private message', (toSocketId, msg) => {
      if (typeof msg !== 'string' || msg.trim().length === 0 || msg.length > 500) return;
      const fromName = onlineUsers.get(socket.id) || 'Anônimo';
      socket.to(toSocketId).emit('private message', socket.id, fromName, msg);
      socket.emit('private message', toSocketId, fromName, msg);
    });

    registerChatHandlers(ioServer, socket, db);

    socket.on('disconnect', () => {
      onlineUsers.delete(socket.id);
      ioServer.emit('system message', `${username} saiu do chat`);
      ioServer.emit('online users', Array.from(onlineUsers.entries()).map(([id, name]) => ({ id, name })));
    });
  });

  await new Promise((resolve) => httpServer.listen(0, resolve));
  port = httpServer.address().port;
});

afterAll(async () => {
  await new Promise((resolve) => ioServer.close(resolve));
  await db.close();
});

function connect(auth = {}) {
  return ioClient(`http://localhost:${port}`, {
    auth: { username: 'Tester', serverOffset: 0, ...auth },
    autoConnect: true,
  });
}

function waitFor(socket, event) {
  return new Promise((resolve) => socket.once(event, (...args) => resolve(args)));
}

describe('chat message', () => {
  it('broadcasts a valid message to all clients', async () => {
    const sender = connect();
    const receiver = connect();
    await Promise.all([waitFor(sender, 'connect'), waitFor(receiver, 'connect')]);

    const received = waitFor(receiver, 'chat message');
    sender.emit('chat message', 'olá mundo', `${sender.id}-0`, () => {});
    const [, msg] = await received;

    expect(msg).toBe('olá mundo');
    sender.disconnect();
    receiver.disconnect();
  });

  it('includes a timestamp in the broadcast', async () => {
    const client = connect();
    await waitFor(client, 'connect');

    const received = waitFor(client, 'chat message');
    client.emit('chat message', 'com timestamp', `${client.id}-ts`, () => {});
    const [,, , createdAt] = await received;

    expect(typeof createdAt).toBe('string');
    expect(new Date(createdAt).getTime()).toBeGreaterThan(0);
    client.disconnect();
  });

  it('calls back with error for empty message', async () => {
    const client = connect();
    await waitFor(client, 'connect');

    const ack = await new Promise((resolve) =>
      client.emit('chat message', '   ', `${client.id}-0`, resolve)
    );
    expect(ack).toMatchObject({ error: 'invalid message' });
    client.disconnect();
  });

  it('calls back with error for message exceeding 500 chars', async () => {
    const client = connect();
    await waitFor(client, 'connect');

    const ack = await new Promise((resolve) =>
      client.emit('chat message', 'a'.repeat(501), `${client.id}-0`, resolve)
    );
    expect(ack).toMatchObject({ error: 'invalid message' });
    client.disconnect();
  });

  it('calls back with error for non-string message', async () => {
    const client = connect();
    await waitFor(client, 'connect');

    const ack = await new Promise((resolve) =>
      client.emit('chat message', 12345, `${client.id}-0`, resolve)
    );
    expect(ack).toMatchObject({ error: 'invalid message' });
    client.disconnect();
  });

  it('ignores duplicate client offsets (idempotency)', async () => {
    const client = connect();
    await waitFor(client, 'connect');

    const offset = `${client.id}-idem`;
    await new Promise((resolve) =>
      client.emit('chat message', 'primeira vez', offset, resolve)
    );

    const received = [];
    client.on('chat message', (_, msg) => received.push(msg));
    await new Promise((resolve) =>
      client.emit('chat message', 'segunda vez', offset, resolve)
    );
    await new Promise((r) => setTimeout(r, 100));
    expect(received).toHaveLength(0);
    client.disconnect();
  });
});

describe('typing indicator', () => {
  it('broadcasts typing event to other clients', async () => {
    const typer = connect();
    const watcher = connect();
    await Promise.all([waitFor(typer, 'connect'), waitFor(watcher, 'connect')]);

    const typingPromise = waitFor(watcher, 'typing');
    typer.emit('typing');
    const [user] = await typingPromise;

    expect(user).toBe('Tester');
    typer.disconnect();
    watcher.disconnect();
  });

  it('broadcasts stop typing event to other clients', async () => {
    const typer = connect();
    const watcher = connect();
    await Promise.all([waitFor(typer, 'connect'), waitFor(watcher, 'connect')]);

    const stopPromise = waitFor(watcher, 'stop typing');
    typer.emit('stop typing');
    const [user] = await stopPromise;

    expect(user).toBe('Tester');
    typer.disconnect();
    watcher.disconnect();
  });
});

describe('system messages', () => {
  it('emits a join message when a user connects', async () => {
    const watcher = connect({ username: 'Watcher' });
    await waitFor(watcher, 'connect');

    const sysPromise = waitFor(watcher, 'system message');
    connect({ username: 'Novo' });
    const [text] = await sysPromise;

    expect(text).toContain('Novo');
    expect(text).toContain('entrou');
    watcher.disconnect();
  });

  it('emits a leave message when a user disconnects', async () => {
    const watcher = connect({ username: 'Watcher2' });
    const leaver = connect({ username: 'Saindo' });
    await Promise.all([waitFor(watcher, 'connect'), waitFor(leaver, 'connect')]);

    const sysPromise = waitFor(watcher, 'system message');
    leaver.disconnect();
    const [text] = await sysPromise;

    expect(text).toContain('Saindo');
    expect(text).toContain('saiu');
    watcher.disconnect();
  });
});

describe('private messages', () => {
  it('delivers a private message only to sender and target', async () => {
    const alice = connect({ username: 'Alice' });
    const bob = connect({ username: 'Bob' });
    const eve = connect({ username: 'Eve' });

    await Promise.all([
      waitFor(alice, 'connect'),
      waitFor(bob, 'connect'),
      waitFor(eve, 'connect'),
    ]);

    const bobReceived = waitFor(bob, 'private message');
    const eveMessages = [];
    eve.on('private message', (_, __, msg) => eveMessages.push(msg));

    alice.emit('private message', bob.id, 'segredo');
    const [, fromName, msg] = await bobReceived;

    expect(msg).toBe('segredo');
    expect(fromName).toBe('Alice');

    await new Promise((r) => setTimeout(r, 100));
    expect(eveMessages).toHaveLength(0);

    alice.disconnect();
    bob.disconnect();
    eve.disconnect();
  });

  it('does not deliver private message with empty content', async () => {
    const alice = connect({ username: 'Alice2' });
    const bob = connect({ username: 'Bob2' });
    await Promise.all([waitFor(alice, 'connect'), waitFor(bob, 'connect')]);

    const bobMessages = [];
    bob.on('private message', (_, __, msg) => bobMessages.push(msg));
    alice.emit('private message', bob.id, '   ');

    await new Promise((r) => setTimeout(r, 100));
    expect(bobMessages).toHaveLength(0);

    alice.disconnect();
    bob.disconnect();
  });
});
