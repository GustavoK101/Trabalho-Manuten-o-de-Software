export function registerChatHandlers(io, socket, db) {
  const username = socket.handshake.auth.username?.trim().slice(0, 30) || 'Anônimo';

  socket.on('chat message', async (msg, clientOffset, callback) => {
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
        console.error('DB insert error:', e);
      }
      return;
    }

    io.emit('chat message', username, msg, result.lastID);
    callback();
  });

  if (!socket.recovered) {
    recoverMessages(socket, db);
  }
}

async function recoverMessages(socket, db) {
  try {
    await db.each(
      'SELECT id, content, username FROM messages WHERE id > ?',
      [socket.handshake.auth.serverOffset || 0],
      (_err, row) => {
        socket.emit('chat message', row.username, row.content, row.id);
      }
    );
  } catch (e) {
    console.error('Message recovery error:', e);
  }
}
