'use strict';

const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const express = require('express');
const { Server } = require('socket.io');
const { Chess10 } = require('./public/chess10.js');

const PORT = Number(process.env.PORT || 3000);
const INITIAL_TIME = 10 * 60 * 1000;
const ROOM_TTL = 12 * 60 * 60 * 1000;
const MAX_ROOMS = 1500;
const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const secureRandom = () => crypto.randomInt(0, 2 ** 32) / (2 ** 32);
const rooms = new Map();
const app = express();
const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 20_000 });

app.disable('x-powered-by');
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));
app.get('/health', (_req, res) => res.json({ status: 'ok' }));

function code() {
  let value;
  do {
    value = Array.from(crypto.randomBytes(6), (n) => alphabet[n % alphabet.length]).join('');
  } while (rooms.has(value));
  return value;
}

const safeName = (name) => typeof name === 'string'
  ? name.replace(/[<>\u0000-\u001f\u007f]/g, '').trim().slice(0, 18) || 'Игрок'
  : 'Игрок';

function createRoom() {
  if (rooms.size >= MAX_ROOMS) throw new Error('Сейчас слишком много комнат. Попробуйте позже.');
  const room = {
    code: code(), game: new Chess10(undefined, secureRandom), players: { w: null, b: null },
    started: false, result: null, drawOffer: null, rematch: new Set(),
    clock: { w: INITIAL_TIME, b: INITIAL_TIME, activeAt: null },
    createdAt: Date.now(), updatedAt: Date.now()
  };
  rooms.set(room.code, room);
  return room;
}

function ready(room) {
  return !!(room.players.w?.socketId && room.players.b?.socketId);
}

function stopClock(room) {
  if (room.clock.activeAt === null || room.result) return;
  const now = Date.now();
  const turn = room.game.turn();
  room.clock[turn] = Math.max(0, room.clock[turn] - (now - room.clock.activeAt));
  room.clock.activeAt = null;
  if (room.clock[turn] === 0) {
    room.result = { reason: 'Время вышло', winner: turn === 'w' ? 'b' : 'w' };
  }
}

function beginClock(room) {
  if (!room.result && room.started && ready(room) && room.clock.activeAt === null) {
    room.clock.activeAt = Date.now();
  }
}

function clockSnapshot(room) {
  const clock = { w: room.clock.w, b: room.clock.b };
  if (!room.result && room.clock.activeAt !== null) {
    const turn = room.game.turn();
    clock[turn] = Math.max(0, clock[turn] - (Date.now() - room.clock.activeAt));
  }
  return clock;
}

function updateResult(room) {
  const game = room.game;
  if (game.isCheckmate()) {
    room.result = { reason: 'Мат', winner: game.turn() === 'w' ? 'b' : 'w' };
  } else if (game.isDraw()) {
    const reason = game.isStalemate() ? 'Пат'
      : game.isThreefoldRepetition() ? 'Троекратное повторение'
      : game.isInsufficientMaterial() ? 'Недостаточно материала'
      : 'Ничья по правилам';
    room.result = { reason, winner: null };
  }
  if (room.result) room.clock.activeAt = null;
}

function publicRoom(room, viewer=null) {
  const effects=room.game.effects();
  const fog=!room.result && (viewer==='w'||viewer==='b' ? effects[viewer].some(e=>e.id==='fog') :
    ['w','b'].some(c=>effects[c].some(e=>e.id==='fog')));
  return {
    code: room.code,
    fog,
    check: room.game.isCheck(),
    fen: fog?room.game.viewFen(viewer):room.game.fen(),
    turn: room.game.turn(),
    moves: room.game.history({ verbose: true }).map(move=>!fog||move.color===viewer?move:
      {san:'•••',color:move.color,type:'hidden',from:null,to:null}),
    players: Object.fromEntries(['w', 'b'].map((color) => [color, room.players[color]
      ? { name: room.players[color].name, online: !!room.players[color].socketId }
      : null])),
    started: room.started,
    ready: ready(room),
    result: room.result,
    drawOffer: room.drawOffer,
    rematch: [...room.rematch],
    highlights:room.result?room.game.highlights(5):null,
    clock: clockSnapshot(room)
  };
}

function sendState(room) {
  for(const id of io.sockets.adapter.rooms.get(room.code)||[]){
    const client=io.sockets.sockets.get(id);
    if(client)client.emit('room:state',publicRoom(room,client.data.color));
  }
}

function leaveRoom(socket) {
  const oldCode = socket.data.roomCode;
  if (!oldCode) return;
  socket.leave(oldCode);
  socket.data.roomCode = null;
  socket.data.color = null;
  const room = rooms.get(oldCode);
  if (!room) return;
  const color = ['w', 'b'].find((c) => room.players[c]?.socketId === socket.id);
  if (color) {
    stopClock(room);
    room.players[color].socketId = null;
    room.updatedAt = Date.now();
    room.rematch.delete(color);
    sendState(room);
  }
}

function enterRoom(socket, room, name, token) {
  leaveRoom(socket);
  let color = ['w', 'b'].find((c) => room.players[c]?.token === token && typeof token === 'string');
  if (!color) color = ['w', 'b'].find((c) => room.players[c] === null);
  let seatToken = null;
  if (color) {
    const priorSocket = room.players[color]?.socketId;
    if (priorSocket && priorSocket !== socket.id) {
      const previous = io.sockets.sockets.get(priorSocket);
      if (previous) {
        previous.data.color = null;
        previous.emit('room:replaced');
      }
    }
    seatToken = room.players[color]?.token || crypto.randomBytes(24).toString('hex');
    room.players[color] = { name: safeName(name || room.players[color]?.name), token: seatToken, socketId: socket.id };
  }
  socket.join(room.code);
  socket.data.roomCode = room.code;
  socket.data.color = color || null;
  if (room.players.w && room.players.b) room.started = true;
  beginClock(room);
  room.updatedAt = Date.now();
  sendState(room);
  return { ok: true, code: room.code, color: color || 'spectator', token: seatToken, state: publicRoom(room,color) };
}

function withPlayer(socket, fn, reply) {
  const room = rooms.get(socket.data.roomCode);
  const color = socket.data.color;
  if (!room || !color || room.players[color]?.socketId !== socket.id) {
    reply?.({ ok: false, error: 'Вы не участник этой партии.' });
    return;
  }
  fn(room, color);
}

io.on('connection', (socket) => {
  socket.on('room:create', (payload = {}, reply = () => {}) => {
    try {
      const room = createRoom();
      reply(enterRoom(socket, room, payload.name, null));
    } catch (error) {
      reply({ ok: false, error: error.message });
    }
  });

  socket.on('room:join', (payload = {}, reply = () => {}) => {
    const requested = typeof payload.code === 'string' ? payload.code.trim().toUpperCase() : '';
    const room = rooms.get(requested);
    if (!room) return reply({ ok: false, error: 'Комната не найдена. Проверьте код или создайте новую.' });
    reply(enterRoom(socket, room, payload.name, payload.token));
  });

  // All random pig destinations are chosen and validated on the server.
  function commitPlayerMove(socket, reply, moveFunction) {
    withPlayer(socket, (room, playerColor) => {
      if (room.result || !room.started || !ready(room)) {
        return reply({ ok: false, error: 'Партия не активна: нужен второй игрок или матч завершён.' });
      }
      if (room.game.turn() !== playerColor) return reply({ ok: false, error: 'Сейчас ход соперника.' });
      stopClock(room);
      if (room.result) { sendState(room); return reply({ ok: false, error: 'Время вышло.' }); }
      try {
        moveFunction(room.game);
      } catch (error) {
        beginClock(room);
        return reply({ ok: false, error: error.message || 'Недопустимый ход.' });
      }
      room.drawOffer = null;
      room.rematch.clear();
      room.updatedAt = Date.now();
      updateResult(room);
      beginClock(room);
      sendState(room);
      reply({ ok: true });
    }, reply);
  }

  socket.on('game:move', (payload = {}, reply = () => {}) => {
    if (!payload || typeof payload.from !== 'string' || typeof payload.to !== 'string'
      || !/^[a-j](10|[1-9])$/.test(payload.from) || !/^[a-j](10|[1-9])$/.test(payload.to)
      || (payload.promotion !== undefined && !/^[qrbn]$/.test(payload.promotion))) {
      return reply({ ok: false, error: 'Неверный формат хода.' });
    }
    commitPlayerMove(socket, reply, game => game.move(payload));
  });

  socket.on('game:trade', (payload = {}, reply = () => {}) => {
    if(!payload || typeof payload.visitor!=='string' ||
       !Array.isArray(payload.sacrifice) || payload.sacrifice.length!==3 ||
       payload.sacrifice.some(x=>typeof x!=='string' || !/^[a-j](10|[1-9])$/.test(x)) ||
       !/^[pnbrqsut]$/.test(payload.receive||''))
      return reply({ok:false,error:'Неверный формат сделки'});
    commitPlayerMove(socket, reply, game=>game.trade(payload));
  });

  socket.on('game:pig', (payload = {}, reply = () => {}) => {
    if (!payload || typeof payload.from !== 'string' || !/^[a-j](10|[1-9])$/.test(payload.from)) {
      return reply({ ok: false, error: 'Укажите клетку своей свиньи.' });
    }
    commitPlayerMove(socket, reply, game => game.pig(payload.from, secureRandom));
  });

  socket.on('game:resign', (_payload = {}, reply = () => {}) => {
    withPlayer(socket, (room, color) => {
      if (room.result || !room.started) return reply({ ok: false, error: 'Нельзя сдаться в этой партии.' });
      stopClock(room);
      if (!room.result) room.result = { reason: 'Сдача', winner: color === 'w' ? 'b' : 'w' };
      room.clock.activeAt = null;
      room.updatedAt = Date.now();
      sendState(room);
      reply({ ok: true });
    }, reply);
  });

  socket.on('game:draw', (_payload = {}, reply = () => {}) => {
    withPlayer(socket, (room, color) => {
      if (room.result || !room.started || !ready(room)) return reply({ ok: false, error: 'Партия не активна.' });
      if (room.drawOffer && room.drawOffer !== color) {
        stopClock(room);
        if (!room.result) room.result = { reason: 'Ничья по соглашению', winner: null };
        room.drawOffer = null;
        room.clock.activeAt = null;
      } else {
        room.drawOffer = color;
      }
      room.updatedAt = Date.now();
      sendState(room);
      reply({ ok: true });
    }, reply);
  });

  socket.on('game:rematch', (_payload = {}, reply = () => {}) => {
    withPlayer(socket, (room, color) => {
      if (!room.result || !ready(room)) return reply({ ok: false, error: 'Реванш доступен только после окончания матча.' });
      room.rematch.add(color);
      if (room.rematch.size === 2) {
        room.game = new Chess10(undefined, secureRandom);
        room.result = null;
        room.drawOffer = null;
        room.rematch.clear();
        room.clock = { w: INITIAL_TIME, b: INITIAL_TIME, activeAt: null };
        beginClock(room);
      }
      room.updatedAt = Date.now();
      sendState(room);
      reply({ ok: true });
    }, reply);
  });

  socket.on('disconnect', () => leaveRoom(socket));
});

// Keep ephemeral rooms for reconnects, and free server memory after inactivity.
setInterval(() => {
  const now = Date.now();
  for (const [id, room] of rooms) {
    if (room.clock.activeAt !== null) {
      const before = !!room.result;
      stopClock(room);
      if (!before && room.result) sendState(room);
      else beginClock(room);
    }
    if (now - room.updatedAt > ROOM_TTL && !ready(room)) rooms.delete(id);
  }
}, 1000).unref();

if (require.main === module) {
  server.listen(PORT, '0.0.0.0', () => console.log(`CHESS DUEL → http://localhost:${PORT}`));
}

module.exports = { app, server, io, rooms };
