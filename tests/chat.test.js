import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import { io as ioClient } from 'socket.io-client';
import express from 'express';
import { openDb } from '../db.js';
import { registerChatHandlers } from '../chat.js';

let httpServer, ioServer, db, port;

beforeAll(async () => {
  process.env.DB_FILE = ':memory:';
  db = await openDb();

  const app = express();
  httpServer = createServer(app);
  ioServer = new Server(httpServer);

  ioServer.on('connection', (socket) => {
    registerChatHandlers(ioServer, socket, db);
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

    const longMsg = 'a'.repeat(501);
    const ack = await new Promise((resolve) =>
      client.emit('chat message', longMsg, `${client.id}-0`, resolve)
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
