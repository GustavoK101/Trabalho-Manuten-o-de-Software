import { logError } from './logger.js';

export function registerChatHandlers(io, socket, db) {
  const username = socket.handshake.auth.username?.trim().slice(0, 30) || 'Anônimo';

  socket.on('chat message', async (msg, clientOffset, callback) => {
    if (typeof callback !== 'function') callback = () => {};
    if (typeof msg !== 'string' || msg.trim().length === 0 || msg.length > 500) {
      return callback({ error: 'invalid message' });
    }

    let result;
    try {
      result = await db.run(
        'INSERT INTO messages (content, client_offset, username) VALUES (?, ?, ?)',
        msg,
        clientOffset,
        username
      );
    } catch (e) {
      if (e.code === 'SQLITE_CONSTRAINT') {
        callback();
      } else {
        logError('[chat] DB insert error:', e);
      }
      return;
    }

    const row = await db.get('SELECT created_at FROM messages WHERE id = ?', result.lastID);
    io.emit('chat message', username, msg, result.lastID, row.created_at);
    callback();
  });

  // Ack these so they don't stall the client's delivery-guarantee queue
  // (the client runs with `retries`, which sends emits one-at-a-time and
  // waits for an ack before sending the next — an un-acked event blocks
  // every emit behind it, including chat messages).
  socket.on('typing', (callback) => {
    socket.broadcast.emit('typing', username);
    if (typeof callback === 'function') callback();
  });

  socket.on('stop typing', (callback) => {
    socket.broadcast.emit('stop typing', username);
    if (typeof callback === 'function') callback();
  });

  if (!socket.recovered) {
    recoverMessages(socket, db);
  }
}

async function recoverMessages(socket, db) {
  try {
    await db.each(
      'SELECT id, content, username, created_at FROM messages WHERE id > ?',
      [socket.handshake.auth.serverOffset || 0],
      (_err, row) => {
        socket.emit('chat message', row.username, row.content, row.id, row.created_at);
      }
    );
  } catch (e) {
    logError('[recover] message recovery error:', e);
  }
}
