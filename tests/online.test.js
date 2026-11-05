'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { io: connect } = require('socket.io-client');
const { server, io, rooms } = require('../server');

let address;
const clients = [];

test.before(async () => {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  address = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  for (const client of clients) client.disconnect();
  rooms.clear();
  await new Promise((resolve) => io.close(resolve));
});

async function client() {
  const socket = connect(address, { reconnection: false, transports: ['websocket'] });
  clients.push(socket);
  await new Promise((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('connect_error', reject);
  });
  return socket;
}

async function request(socket, name, payload) {
  return await new Promise((resolve, reject) => {
    socket.timeout(2000).emit(name, payload, (err, response) => err ? reject(err) : resolve(response));
  });
}

test('online match: join, legal move, validation, turn and resign', async () => {
  const white = await client();
  const black = await client();
  const stranger = await client();

  const made = await request(white, 'room:create', { name: 'Алиса' });
  assert.equal(made.ok, true);
  assert.equal(made.color, 'w');
  assert.match(made.code, /^[A-Z2-9]{6}$/);
  assert.equal(made.state.started, false);

  const joined = await request(black, 'room:join', { code: made.code, name: 'Боб' });
  assert.equal(joined.ok, true);
  assert.equal(joined.color, 'b');
  assert.equal(joined.state.ready, true);

  const spectator = await request(stranger, 'room:join', { code: made.code, name: 'Зритель' });
  assert.equal(spectator.color, 'spectator');
  assert.equal((await request(stranger, 'game:move', { from: 'e2', to: 'e4' })).ok, false);
  assert.equal((await request(black, 'game:move', { from: 'e7', to: 'e5' })).ok, false);
  assert.equal((await request(white, 'game:move', { from: 'e2', to: 'e5' })).ok, false);

  assert.equal((await request(white, 'game:move', { from: 'e2', to: 'e4' })).ok, true);
  assert.equal(rooms.get(made.code).game.turn(), 'b');
  assert.equal((await request(white, 'game:move', { from: 'd2', to: 'd4' })).ok, false);
  assert.equal((await request(black, 'game:move', { from: 'e7', to: 'e5' })).ok, true);
  assert.deepEqual(rooms.get(made.code).game.history(), ['e4', 'e5']);

  assert.equal((await request(white, 'game:resign', {})).ok, true);
  assert.equal(rooms.get(made.code).result.winner, 'b');
  assert.equal((await request(black, 'game:move', { from: 'b8', to: 'c6' })).ok, false);

  assert.equal((await request(white, 'game:rematch', {})).ok, true);
  assert.equal((await request(black, 'game:rematch', {})).ok, true);
  assert.equal(rooms.get(made.code).result, null);
  assert.equal(rooms.get(made.code).game.history().length, 0);
});

test('seat token allows reconnecting to the same color', async () => {
  const first = await client();
  const created = await request(first, 'room:create', { name: 'Первый' });
  first.disconnect();
  await new Promise((resolve) => setTimeout(resolve, 30));
  const newTab = await client();
  const recovered = await request(newTab, 'room:join', {
    code: created.code, token: created.token, name: 'Первый'
  });
  assert.equal(recovered.color, 'w');
  assert.equal(recovered.token, created.token);
});

test('online 10x10 pig: only owner may trigger it; destination chosen by server', async () => {
  const white = await client();
  const black = await client();
  const spectator = await client();
  const created = await request(white, 'room:create', {name:'Света'});
  await request(black, 'room:join', {code:created.code, name:'Толя'});
  await request(spectator, 'room:join', {code:created.code, name:'Зритель'});
  const room = rooms.get(created.code);
  const possible = room.game.moves({square:'a3',verbose:true}).map(m=>m.to);
  assert.ok(possible.length>0);
  assert.equal((await request(spectator,'game:pig',{from:'a3'})).ok, false);
  assert.equal((await request(black,'game:pig',{from:'a8'})).ok, false);
  assert.equal((await request(white,'game:move',{from:'a3',to:possible[0]})).ok, false);
  assert.equal((await request(white,'game:pig',{from:'a8'})).ok, false);
  assert.equal((await request(white,'game:pig',{from:'a3'})).ok, true);
  const result=room.game.history({verbose:true}).at(-1);
  assert.equal(result.type,'s');
  assert.ok(possible.includes(result.to));
  assert.equal(room.game.turn(),'b');
  assert.equal((await request(white,'game:pig',{from:'j3'})).ok,false);
  assert.equal((await request(black,'game:pig',{from:'j8'})).ok,true);
  assert.equal(room.game.history().length,2);
  assert.equal(room.game.turn(),'w');
  assert.equal((await request(white,'game:move',{from:'a2',to:'a11'})).ok,false);
});

test('online UNO conversion: server validates move and stores changed color for both players', async () => {
  const white=await client();
  const black=await client();
  const outsider=await client();
  const made=await request(white,'room:create',{name:'UNO белые'});
  await request(black,'room:join',{code:made.code,name:'UNO чёрные'});
  await request(outsider,'room:join',{code:made.code,name:'Зритель'});
  const room=rooms.get(made.code);
  room.game=new (require('../public/chess10.js').Chess10)(
    '5k4/10/10/10/5n4/4U5/10/10/10/5K4 w - - 0 1'
  );
  assert.equal((await request(outsider,'game:move',{from:'e5',to:'f6'})).ok,false);
  assert.equal((await request(black,'game:move',{from:'e5',to:'f6'})).ok,false);
  assert.equal((await request(white,'game:move',{from:'e5',to:'g7'})).ok,false);
  assert.equal((await request(white,'game:move',{from:'e5',to:'f6'})).ok,true);
  assert.deepEqual(room.game.get('f6'),{type:'n',color:'w'});
  assert.equal(room.game.rentals().w.remaining,5);
  assert.equal(room.game.turn(),'b');
  assert.equal((await request(white,'game:move',{from:'f6',to:'g4'})).ok,false);
  assert.equal((await request(black,'game:move',{from:'f10',to:'e10'})).ok,true);
  assert.equal((await request(white,'game:move',{from:'f6',to:'g4'})).ok,true);
  assert.equal(room.game.rentals().w.remaining,4);
  assert.equal(room.game.rentals().w.square,'g4');
  assert.equal((await request(black,'game:drop',{to:'g7'})).ok,false);
});

test('online 5% pawn mutation is authoritative and synchronized to both clients', async () => {
  const white=await client();
  const black=await client();
  const created=await request(white,'room:create',{name:'Магия'});
  await request(black,'room:join',{code:created.code,name:'Соперник'});
  const room=rooms.get(created.code);
  const values=[0.01,0.57];
  room.game=new (require('../public/chess10.js').Chess10)(
    '5k4/10/10/10/10/10/10/10/4P5/5K4 w - - 0 1',
    ()=>values.shift()??0.9
  );
  const synced=new Promise(resolve => {
    black.on('room:state', state => {
      if(state.code===created.code && state.moves.length===1)resolve(state);
    });
  });
  // Random outcomes or desired target types sent by a browser are ignored.
  assert.equal((await request(white,'game:move',{
    from:'e2',to:'e4',random:0.99,morph:{type:'k'}
  })).ok,true);
  const broadcast=await synced;
  assert.equal(broadcast.moves[0].morph.type,'q');
  assert.deepEqual(new (require('../public/chess10.js').Chess10)(broadcast.fen).get('e4'),{type:'q',color:'w'});
  assert.equal((await request(white,'game:move',{from:'e4',to:'e6'})).ok,false);
  assert.equal((await request(black,'game:move',{from:'f10',to:'g10'})).ok,true);
  assert.equal((await request(white,'game:move',{from:'e4',to:'e6'})).ok,true);
  assert.equal(room.game.get('e6').type,'p');
  assert.equal(room.game.morphs().w,null);
  assert.equal(room.game.history({verbose:true})[2].morphExpired.type,'q');
});

test('online merchant trade: server validates rights and prices and closes after first deal', async () => {
  const white=await client(),black=await client();
  const created=await request(white,'room:create',{name:'Торговец'});
  await request(black,'room:join',{code:created.code,name:'Покупатель'});
  const room=rooms.get(created.code);
  const { Chess10 }=require('../public/chess10.js');
  room.game=new Chess10('5k4/10/10/10/9P/10/10/4B5/4N5/5K4 w - - 0 1');
  room.game._s.meta.ply=50;
  const payload={visitor:'j6',sacrifice:['j6','e2','e3'],receive:'s'};
  assert.equal((await request(black,'game:trade',payload)).ok,false);
  assert.equal((await request(white,'game:trade',{...payload,receive:'q'})).ok,false);
  assert.equal((await request(white,'game:trade',payload)).ok,true);
  assert.deepEqual(room.game.get('j6'),{type:'s',color:'w'});
  assert.equal(room.game.shop().closed,true);
  assert.equal(room.game.history({verbose:true}).at(-1)?.trade?.value,7);
  assert.equal((await request(black,'game:trade',payload)).ok,false);
});

test('fog debuff is enforced by server and room snapshots hide pieces from victim and spectators', async () => {
  const white=await client(),black=await client(),spectator=await client();
  const created=await request(white,'room:create',{name:'Ящик'});
  await request(black,'room:join',{code:created.code,name:'Туман'});
  const room=rooms.get(created.code);
  const { Chess10 }=require('../public/chess10.js');
  const rng=[0.51,0.51];
  room.game=new Chess10('5k4/10/10/10/10/10/10/10/4P5/5K4 w - - 0 1',()=>rng.shift()??0.5);
  room.game._s.meta.crate=64; // e4
  const blackSnapshot=new Promise(resolve=>black.once('room:state',resolve));
  const whiteSnapshot=new Promise(resolve=>white.once('room:state',resolve));
  assert.equal((await request(white,'game:move',{from:'e2',to:'e4'})).ok,true);
  const [hidden,visible]=await Promise.all([blackSnapshot,whiteSnapshot]);
  assert.equal(room.game.effects().b[0].id,'fog');
  assert.deepEqual(room.game.get('e4'),{type:'p',color:'w'});
  assert.equal(hidden.fog,true);
  assert.equal(new Chess10(hidden.fen).get('e4'),null);
  assert.deepEqual(new Chess10(visible.fen).get('e4'),{type:'p',color:'w'});
  assert.equal(hidden.moves.at(-1).san,'•••');
  const peek=await request(spectator,'room:join',{code:created.code,name:'Наблюдатель'});
  assert.equal(peek.color,'spectator');
  assert.equal(peek.state.fog,true);
  assert.equal(new Chess10(peek.state.fen).get('e4'),null);
  assert.equal((await request(black,'game:move',{from:'f10',to:'e10'})).ok,true);
  assert.equal(room.game.effects().b[0].remaining,4);
});


test('online diamond move and post-game five-clip replay are server-authored and reveal no ongoing fog',async()=>{
  const white=await client(),black=await client();
  const created=await request(white,'room:create',{name:'Бриллиант'});
  await request(black,'room:join',{code:created.code,name:'Повтор'});
  const room=rooms.get(created.code),{Chess10}=require('../public/chess10.js');
  room.game=new Chess10('5k4/10/10/10/10/10/10/10/4q5/K3R5 w - - 0 1');
  assert.equal((await request(white,'game:move',{from:'e1',to:'e2'})).ok,true);
  assert.equal(room.game.history({verbose:true})[0].brilliant,true);
  const snapshot=await request(white,'room:join',{code:created.code,token:created.token});
  assert.equal(snapshot.state.highlights,null,'the full replay archive must stay hidden until the match ends');
  assert.equal((await request(black,'game:resign',{})).ok,true);
  const finished=await request(white,'room:join',{code:created.code,token:created.token});
  assert.ok(finished.state.highlights?.length);
  assert.equal(finished.state.highlights[0].record.brilliant,true);
  assert.equal(finished.state.highlights[0].durationMs,3000);
  assert.ok(finished.state.highlights[0].before&&finished.state.highlights[0].after);
});
