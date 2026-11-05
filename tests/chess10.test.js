'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Chess10, START } = require('../public/chess10.js');

test('10x10 board with 42 pieces, four pigs and two UNO cards, correct colors and orientation', () => {
  const g = new Chess10();
  assert.equal(g.fen(), START);
  let count = 0;
  for (const f of 'abcdefghij') for (let r=1;r<=10;r++) if(g.get(f+r))count++;
  assert.equal(count, 42);
  assert.deepEqual(g.get('f1'), {type:'k',color:'w'});
  assert.deepEqual(g.get('e10'), {type:'q',color:'b'});
  assert.deepEqual(g.get('a3'), {type:'s',color:'w'});
  assert.deepEqual(g.get('j8'), {type:'s',color:'b'});
  assert.deepEqual(g.get('d3'), {type:'u',color:'w'});
  assert.deepEqual(g.get('g8'), {type:'u',color:'b'});
  assert.equal(g.turn(),'w');
});

test('pig is not controllable by ordinary moves, but random pig move is legal and ends turn', () => {
  const g = new Chess10();
  assert.throws(()=>g.move({from:'a3',to:'a4'}),/Свинья/);
  const targets=g.moves({square:'a3',verbose:true}).map(m=>m.to);
  assert.ok(targets.length>=4);
  assert.equal(g.pig('a3',()=>0).to,targets[0]);
  assert.equal(g.turn(),'b');
  assert.equal(g.get('a3'),null);
  assert.deepEqual(g.get(targets[0]),{type:'s',color:'w'});
  assert.throws(()=>g.pig('j3',()=>0),/Нельзя/);
  const black=g.pig('a8',()=>0);
  assert.equal(black.type,'s');
  assert.equal(black.color,'b');
  assert.equal(g.turn(),'w');
});

test('normal moves, illegal moves and basic notation work on ranks 1–10', () => {
  const g = new Chess10();
  assert.throws(()=>g.move({from:'e2',to:'e5'}),/Недопустимый/);
  assert.equal(g.move({from:'e2',to:'e4'}).san,'e4');
  assert.equal(g.move({from:'e9',to:'e7'}).san,'e7');
  assert.deepEqual(g.history(), ['e4','e7']);
  assert.equal(new Chess10(g.fen()).fen(),g.fen());
  assert.throws(()=>g.move({from:'e4',to:'e6'}),/Недопустимый/);
});

test('10x10 castling: king from f1 to h1; rook from i1 to g1', () => {
  const fen='1r3k2r1/10/10/10/10/10/10/10/10/1R3K2R1 w KQkq - 0 1';
  const g = new Chess10(fen);
  const kingMoves=g.moves({square:'f1',verbose:true}).map(m=>m.to);
  assert.ok(kingMoves.includes('h1'));
  assert.ok(kingMoves.includes('d1'));
  assert.equal(g.move({from:'f1',to:'h1'}).san,'O-O');
  assert.deepEqual(g.get('g1'),{type:'r',color:'w'});
  assert.deepEqual(g.get('h1'),{type:'k',color:'w'});
  assert.equal(g.get('i1'),null);
});

test('pawn promotion and en passant with 10 ranks', () => {
  const promote = new Chess10('5k4/P9/10/10/10/10/10/10/10/5K4 w - - 0 1');
  const choices=promote.moves({square:'a9',verbose:true}).map(m=>m.promotion);
  assert.deepEqual(choices,['q','r','b','n']);
  promote.move({from:'a9',to:'a10',promotion:'n'});
  assert.deepEqual(promote.get('a10'),{type:'n',color:'w'});
  const ep = new Chess10('5k4/5p4/10/4P5/10/10/10/10/10/5K4 b - - 0 1',()=>0.99);
  ep.move({from:'f9',to:'f7'});
  assert.match(ep.fen(),/ f8 /);
  const taken=ep.move({from:'e7',to:'f8'});
  assert.equal(taken.flags,'e');
  assert.equal(ep.get('f7'),null);
  assert.deepEqual(ep.get('f8'),{type:'p',color:'w'});
});

test('checkmate and stalemate recognition on custom board',()=>{
  const check = new Chess10('9k/10/10/10/10/10/10/10/10/K8R b - - 0 1');
  assert.equal(check.isCheck(),true);
  assert.equal(check.get('j10')?.type,'k');
  assert.equal(check.isGameOver(),false);
  const bare = new Chess10('9k/10/10/10/10/10/10/10/10/K9 w - - 0 1');
  assert.equal(bare.isDraw(),true);
});

test('random playout retains both kings and a valid FEN',()=>{
  for(let game=0;game<5;game++) {
    const chess=new Chess10();
    for(let i=0;i<80 && !chess.isGameOver();i++) {
      const moves=chess.moves({verbose:true});
      assert.ok(moves.length);
      const choice=moves[(i*13+game*7)%moves.length];
      if(choice.type==='s')chess.pig(choice.from,()=>0);
      else chess.move(choice);
      assert.ok(new Chess10(chess.fen()).get('f1') || chess.history().length);
      let kings={w:0,b:0};
      for(const f of 'abcdefghij')for(let rank=1;rank<=10;rank++){
        const piece=chess.get(f+rank);
        if(piece?.type==='k')kings[piece.color]++;
      }
      assert.deepEqual(kings,{w:1,b:1});
      assert.equal(new Chess10(chess.fen()).fen(),chess.fen());
    }
  }
});

test('one UNO card per team: custom positions with duplicates are rejected', () => {
  assert.throws(() => new Chess10('5k4/10/10/10/10/4UU4/10/10/10/5K4 w - - 0 1'), /одной UNO/);
  const initial=new Chess10();
  assert.equal(initial.moves({square:'d3',verbose:true}).some(m=>m.type==='u'),true);
  assert.equal(initial.get('g8').type,'u');
});

test('UNO has exactly 3 possible forward destinations and never goes backwards', () => {
  const g=new Chess10('5k4/10/10/10/10/4U5/10/10/10/5K4 w - - 0 1');
  assert.deepEqual(g.moves({square:'e5',verbose:true}).map(m=>m.to).sort(),['d6','e6','f6']);
  for(const forbidden of ['e7','d7','f7','e4','d4','f4'])
    assert.throws(()=>g.move({from:'e5',to:forbidden}),/Недопустимый/);
  const black=new Chess10('5k4/10/10/10/4u5/10/10/10/10/5K4 b - - 0 1');
  assert.deepEqual(black.moves({square:'e6',verbose:true}).map(m=>m.to).sort(),['d5','e5','f5']);
});

test('UNO capture switches victim to card owner in place for five owner turns, then restores color', () => {
  const g=new Chess10('5k4/10/10/10/5n4/4U5/10/10/10/5K4 w - - 0 1');
  const hit=g.move({from:'e5',to:'f6'});
  assert.equal(hit.type,'u');
  assert.equal(hit.captured,'n');
  assert.equal(g.get('e5'),null);
  assert.deepEqual(g.get('f6'),{type:'n',color:'w'});
  assert.deepEqual(g.rentals(),{w:{type:'n',remaining:5,square:'f6',original:'b'},b:null});
  assert.deepEqual(new Chess10(g.fen()).rentals(),g.rentals());
  assert.deepEqual(new Chess10(g.fen()).get('f6'),g.get('f6'));
  assert.equal(g.turn(),'b');

  g.move({from:'f10',to:'e10'});
  assert.equal(g.rentals().w.remaining,5);
  g.move({from:'f6',to:'g4'});
  assert.deepEqual(g.get('g4'),{type:'n',color:'w'});
  assert.equal(g.rentals().w.remaining,4);
  assert.equal(g.rentals().w.square,'g4');
  // Four more complete moves of white, with black moves interleaved.
  for(const [black,white] of [
    [['e10','f10'],['f1','e1']],
    [['f10','e10'],['e1','f1']],
    [['e10','f10'],['f1','e1']],
    [['f10','e10'],['e1','f1']]
  ]) {
    g.move({from:black[0],to:black[1]});
    g.move({from:white[0],to:white[1]});
  }
  assert.equal(g.rentals().w,null);
  assert.deepEqual(g.get('g4'),{type:'n',color:'b'});
  assert.equal(g.get('f6'),null);
  assert.equal(new Chess10(g.fen()).fen(),g.fen());
});

test('capturing a temporary converted piece cancels its timer and captures normally', () => {
  const g=new Chess10('5k4/10/10/10/5n4/4U5/10/10/10/5K4 w - - 0 1');
  g.move({from:'e5',to:'f6'});
  assert.equal(g.get('f6').color,'w');
  // A black rook on f7 can capture the converted white knight directly.
  const attacker=new Chess10('5k4/10/10/5r4/5N4/10/10/10/10/5K4 b - - 0 1 w:n:5:f6:b');
  const taken=attacker.move({from:'f7',to:'f6'});
  assert.equal(taken.captured,'n');
  assert.deepEqual(attacker.get('f6'),{type:'r',color:'b'});
  assert.deepEqual(attacker.rentals(),{w:null,b:null});
});

test('capture of UNO itself has no conversion effect', () => {
  const g=new Chess10('5k4/10/10/10/4u5/4R5/10/10/10/5K4 w - - 0 1');
  const record=g.move({from:'e5',to:'e6'});
  assert.equal(record.captured,'u');
  assert.deepEqual(g.get('e6'),{type:'r',color:'w'});
  assert.deepEqual(g.rentals(),{w:null,b:null});
});

test('UNO cannot capture a king or convert one', () => {
  const g=new Chess10('10/10/10/10/4k5/4U5/10/10/10/5K4 w - - 0 1');
  assert.ok(!g.moves({square:'e5',verbose:true}).some(m=>m.to==='e6'));
  assert.throws(()=>g.move({from:'e5',to:'e6'}),/Недопустимый/);
});

test('malformed conversion data cannot be loaded and color is serialized',()=>{
  assert.throws(()=>new Chess10('5k4/10/10/10/5n4/10/10/10/10/5K4 w - - 0 1 w:n:5:f6:b'),/Перекрашенная/);
  const g=new Chess10('5k4/10/10/10/5N4/10/10/10/10/5K4 b - - 0 1 w:n:5:f6:b');
  assert.equal(g.rentals().w.remaining,5);
  assert.equal(g.fen().split(' ')[6],'w:n:5:f6:b');
});

test('5% chance: no random rolls when querying legal moves, exact boundary at 0.05', () => {
  const simple='5k4/10/10/10/10/10/10/10/4P5/5K4 w - - 0 1';
  let called=0;
  const none=new Chess10(simple,()=>{ called++; return 0.05; });
  none.moves({verbose:true});none.moves({square:'e2',verbose:true});none.isCheck();none.isGameOver();
  assert.equal(called,0,'legal move lookup must never roll dice');
  const record=none.move({from:'e2',to:'e4'});
  assert.equal(called,1);
  assert.equal(record.morph,undefined);
  assert.deepEqual(none.get('e4'),{type:'p',color:'w'});

  const values=[0.049999999,0.57];
  const yes=new Chess10(simple,()=>values.shift());
  const special=yes.move({from:'e2',to:'e4'});
  assert.deepEqual(special.morph,{type:'q',color:'w',square:'e4'});
  assert.deepEqual(yes.get('e4'),{type:'q',color:'w'});
  assert.deepEqual(yes.morphs(),{w:{type:'q',square:'e4'},b:null});
  assert.equal(yes.fen().split(' ')[6],'-');
  assert.equal(yes.fen().split(' ')[7],'w:q:e4');
  assert.deepEqual(new Chess10(yes.fen()).morphs(),yes.morphs());
});

test('each mutation outcome can be selected, but no kings, no duplicates of a team UNO', () => {
  const noUno='5k4/10/10/10/10/10/10/10/4P5/5K4 w - - 0 1';
  const allowed=['n','b','r','q','s','u'];
  for(let i=0;i<allowed.length;i++) {
    const values=[0.0001,(i+0.1)/allowed.length];
    const game=new Chess10(noUno,()=>values.shift());
    game.move({from:'e2',to:'e4'});
    assert.deepEqual(game.get('e4'),{type:allowed[i],color:'w'});
    assert.equal(new Chess10(game.fen()).get('e4').type,allowed[i]);
  }
  const withUno='5k4/10/10/10/10/10/10/3U6/4P5/5K4 w - - 0 1';
  const values=[0.01,0.999];
  const game=new Chess10(withUno,()=>values.shift());
  game.move({from:'e2',to:'e4'});
  assert.equal(game.get('e4').type,'s','when a team UNO already exists, a pawn cannot duplicate it');
  assert.equal(game.get('d3').type,'u');
  assert.equal(new Chess10(game.fen()).fen(),game.fen());
});

test('evolved pawn acts like its temporary piece on next owner move then becomes a pawn again', () => {
  const chess=new Chess10('5k4/10/10/10/10/10/10/10/4P5/5K4 w - - 0 1',(()=>{
    const values=[0.01,0.42];return ()=>values.shift()??0.9;
  })()); // [n,b,r,q,s,u] -> rook
  chess.move({from:'e2',to:'e4'});
  assert.equal(chess.get('e4').type,'r');
  chess.move({from:'f10',to:'g10'});
  assert.equal(chess.get('e4').type,'r');
  assert.ok(chess.moves({square:'e4',verbose:true}).some(m=>m.to==='e6'));
  const record=chess.move({from:'e4',to:'e6'});
  assert.deepEqual(record.morphExpired,{type:'r',square:'e4',color:'w'});
  assert.deepEqual(chess.get('e6'),{type:'p',color:'w'});
  assert.equal(chess.get('e4'),null);
  assert.deepEqual(chess.morphs(),{w:null,b:null});
  assert.deepEqual(new Chess10(chess.fen()).get('e6'),chess.get('e6'));
});

test('pawn mutation expires even when owner chooses another piece', () => {
  const chess=new Chess10('5k4/10/10/10/10/10/10/10/4P5/5K4 w - - 0 1',(()=>{
    const values=[0.01,0.57];return ()=>values.shift()??0.9;
  })());
  chess.move({from:'e2',to:'e4'});
  assert.equal(chess.get('e4').type,'q');
  chess.move({from:'f10',to:'g10'});
  const move=chess.move({from:'f1',to:'g1'});
  assert.deepEqual(chess.get('e4'),{type:'p',color:'w'});
  assert.equal(move.morphExpired.type,'q');
  assert.equal(chess.morphs().w,null);
});

test('capturing a temporarily mutated pawn deletes the temporary effect', () => {
  const game=new Chess10('5k4/10/10/10/4r5/10/10/10/4P5/5K4 w - - 0 1',()=>0.001);
  game.move({from:'e2',to:'e4'});
  assert.equal(game.get('e4').type,'n');
  game.move({from:'e6',to:'e4'});
  assert.equal(game.get('e4').type,'r');
  assert.equal(game.morphs().w,null);
  assert.equal(new Chess10(game.fen()).fen(),game.fen());
});

test('magic only affects real pawn moves: cannot alter standard promotion', () => {
  let calls=0;
  const game=new Chess10('5k4/P9/10/10/10/10/10/10/10/5K4 w - - 0 1',()=>{calls++;return 0;});
  game.move({from:'a9',to:'a10',promotion:'n'});
  assert.equal(game.get('a10').type,'n');
  assert.equal(game.morphs().w,null);
  assert.equal(calls,0);
});

test('game notation checks the evolved result, including a newly delivered check',()=>{
  const game=new Chess10('10/4k5/10/10/10/10/10/10/4P5/5K4 w - - 0 1',()=>0.65);
  // with seed .65 would not mutate, so force mutation to a rook
  const values=[0.01,0.42];
  const withMagic=new Chess10(game.fen(),()=>values.shift());
  const record=withMagic.move({from:'e2',to:'e4'});
  assert.equal(withMagic.get('e4').type,'r');
  assert.equal(record.san,'e4+');
  assert.equal(withMagic.isCheck(),true);
});

test('5 percent independent chance is applied to each committed pawn move', () => {
  const fen='5k4/10/10/10/10/10/10/10/4P5/5K4 w - - 0 1';
  let wins=0;
  for(let i=0;i<1000;i++) {
    const sequence=[(i+.5)/1000,0];
    const game=new Chess10(fen,()=>sequence.shift());
    game.move({from:'e2',to:'e4'});
    if(game.morphs().w)wins++;
  }
  assert.equal(wins,50);
});

test('UNO hitting a magical pawn converts its original pawn identity, not a permanent queen', () => {
  const fen='5k4/10/10/10/10/3u6/10/10/4P5/5K4 w - - 0 1';
  const values=[0.01,0.57];
  const game=new Chess10(fen,()=>values.shift()??0.99);
  game.move({from:'e2',to:'e4'});
  assert.equal(game.get('e4').type,'q');
  // A black UNO on d5 attacks e4, and switches temporary queen back to its original pawn identity.
  game.move({from:'d5',to:'e4'});
  assert.deepEqual(game.get('e4'),{type:'p',color:'b'});
  assert.equal(game.morphs().w,null);
  assert.deepEqual(game.rentals().b,{type:'p',remaining:5,square:'e4',original:'w'});
  assert.equal(new Chess10(game.fen()).fen(),game.fen());
});

test('crate spawns every 30 player actions on a random empty square, never during queries', () => {
  const g=new Chess10('5k4/10/10/10/10/10/10/10/10/5K3R w - - 0 1',()=>0.01);
  g._s.meta.ply=29;
  let called=0;
  g._random=()=>{called++;return 0.5;};
  g.moves({verbose:true});g.isCheck();g.fen();
  assert.equal(called,0);
  const record=g.move({from:'j1',to:'j2'});
  assert.equal(g.ply(),30);
  assert.equal(called,1);
  assert.ok(record.crateSpawn);
  assert.equal(g.get(record.crateSpawn),null);
  assert.equal(g.crate(),record.crateSpawn);
  assert.equal(new Chess10(g.fen()).crate(),g.crate());
});

test('crate is collected by landing on it and causes exactly one of ten effects for 5 target moves', () => {
  const starting='5k4/10/10/10/10/10/10/10/4P5/5K4 w - - 0 1';
  const g=new Chess10(starting,()=>0.5);
  g._s.meta.crate=64; // e4
  // Ensure a full state is reconstructible and shared by the online server.
  assert.equal(new Chess10(g.fen()).crate(),'e4');
  const result=g.move({from:'e2',to:'e4'});
  assert.equal(result.crateCollected?.id,'fog');
  assert.equal(result.crateCollected?.recipient,'b');
  assert.equal(g.crate(),null);
  assert.deepEqual(g.effects().b,[{id:'fog',remaining:5}]);
  g.move({from:'f10',to:'e10'});
  assert.equal(g.effects().b[0].remaining,4);
  assert.deepEqual(new Chess10(g.fen()).effects(),g.effects());
});

test('all ten crate outcomes can be rolled and effects are only applied when stepping on a box', () => {
  const fen='5k4/10/10/10/10/10/10/10/4P5/5K4 w - - 0 1';
  const found=new Set();
  for(let i=0;i<10;i++){
    const dice=[0.99,(i+.25)/10];
    const game=new Chess10(fen,()=>dice.shift());
    game._s.meta.crate=64;
    const result=game.move({from:'e2',to:'e4'});
    found.add(result.crateCollected.id);
    assert.equal(result.crateCollected.kind,i<5?'buff':'debuff');
    assert.equal(game.effects()[i<5?'w':'b'][0].remaining,5);
  }
  assert.equal(found.size,10);
});

test('crate debuffs change real legal moves: queen is limited, knights are frozen, pigs cannot activate', () => {
  const queen=new Chess10('5k4/10/10/10/10/4Q5/10/10/10/5K4 w - - 0 1');
  assert.ok(queen.moves({square:'e5',verbose:true}).some(m=>m.to==='e8'));
  queen._s.meta.effects.w.push({id:'queen',remaining:5});
  assert.ok(!queen.moves({square:'e5',verbose:true}).some(m=>m.to==='e8'));
  assert.ok(queen.moves({square:'e5',verbose:true}).some(m=>m.to==='e6'));
  const knight=new Chess10('5k4/10/10/10/10/4N5/10/10/10/5K4 w - - 0 1');
  knight._s.meta.effects.w.push({id:'sleepy',remaining:5});
  assert.equal(knight.moves({square:'e5',verbose:true}).length,0);
  const pig=new Chess10();
  pig._s.meta.effects.w.push({id:'pig',remaining:5});
  assert.equal(pig.moves({square:'a3',verbose:true}).length,0);
  assert.throws(()=>pig.pig('a3'),/нет допустимых ходов/);
});

test('five buffs: sprint, enhanced knight, diagonal rook and 25% pawn magic work', () => {
  const sprint=new Chess10('5k4/10/10/10/10/10/10/4P5/10/5K4 w - - 0 1');
  assert.ok(!sprint.moves({square:'e3',verbose:true}).some(m=>m.to==='e5'));
  sprint._s.meta.effects.w.push({id:'sprint',remaining:5});
  assert.ok(sprint.moves({square:'e3',verbose:true}).some(m=>m.to==='e5'));
  const knight=new Chess10('5k4/10/10/10/10/4N5/10/10/10/5K4 w - - 0 1');
  knight._s.meta.effects.w.push({id:'knight',remaining:5});
  assert.ok(knight.moves({square:'e5',verbose:true}).some(m=>m.to==='e6'));
  const rook=new Chess10('5k4/10/10/10/10/4R5/10/10/10/5K4 w - - 0 1');
  rook._s.meta.effects.w.push({id:'rook',remaining:5});
  assert.ok(rook.moves({square:'e5',verbose:true}).some(m=>m.to==='f6'));
  let rolls=0;
  const magic=new Chess10('5k4/10/10/10/10/10/10/10/4P5/5K4 w - - 0 1',()=>[0.24,0][rolls++]);
  magic._s.meta.effects.w.push({id:'luck',remaining:5});
  const result=magic.move({from:'e2',to:'e4'});
  assert.equal(result.morph?.type,'n');
  assert.equal(magic.effects().w[0].remaining,4);
});

test('shop opens on ply 50, accepts visitor j6, sacrifices 3, enforces prices, and closes after one deal', () => {
  const g=new Chess10('5k4/10/10/10/9P/10/10/4B5/4N5/5K4 w - - 0 1');
  g._s.meta.ply=49;
  assert.equal(g.shop().open,false);
  assert.throws(()=>g.trade({visitor:'j6',sacrifice:['j6','e2','e3'],receive:'s'}),/закрыта/);
  g._s.meta.ply=50;
  assert.equal(new Chess10(g.fen()).shop().open,true);
  assert.throws(()=>g.trade({visitor:'j6',sacrifice:['j6','e2','e3'],receive:'q'}),/Недостаточно/);
  assert.throws(()=>g.trade({visitor:'j6',sacrifice:['j6','e2','e2'],receive:'n'}),/ровно 3/);
  assert.throws(()=>g.trade({visitor:'j6',sacrifice:['j6','f1','e2'],receive:'n'}),/Нельзя сдавать короля/);
  const result=g.trade({visitor:'j6',sacrifice:['j6','e2','e3'],receive:'s'});
  assert.equal(result.trade.value,7);
  assert.deepEqual(g.get('j6'),{type:'s',color:'w'});
  assert.equal(g.get('e2'),null);
  assert.equal(g.get('e3'),null);
  assert.equal(g.shop().closed,true);
  assert.equal(g.shop().open,false);
  assert.equal(g.ply(),51);
  assert.equal(new Chess10(g.fen()).shop().closed,true);
  assert.throws(()=>g.trade({visitor:'j6',sacrifice:['j6','e2','e3'],receive:'p'}),/закрыта/);
});

test('three cheap pawns cannot turn into queen or pig via merchant', () => {
  const game=new Chess10('5k4/10/10/10/9P/10/10/10/4PP4/5K4 w - - 0 1');
  game._s.meta.ply=50;
  assert.throws(()=>game.trade({visitor:'j6',sacrifice:['j6','e2','f2'],receive:'q'}),/Недостаточно/);
  assert.throws(()=>game.trade({visitor:'j6',sacrifice:['j6','e2','f2'],receive:'s'}),/Недостаточно/);
  const record=game.trade({visitor:'j6',sacrifice:['j6','e2','f2'],receive:'n'});
  assert.equal(record.trade.value,3);
  assert.equal(game.get('j6')?.type,'n');
});

test('fog-of-war FEN omits all actual enemy pieces and preserves own pieces and crate', () => {
  const g=new Chess10('5k4/4p5/10/10/10/10/10/10/4P5/6K3 b - - 0 1');
  g._s.meta.effects.b.push({id:'fog',remaining:5});
  g._s.meta.crate=50; // a5 empty at start
  const fog=new Chess10(g.viewFen('b'));
  assert.deepEqual(fog.get('e9'),{type:'p',color:'b'});
  assert.equal(fog.get('e2'),null);
  assert.equal(fog.get('g1'),null);
  assert.equal(g.get('g1')?.type,'k');
  assert.equal(fog.crate(),'a5');
  assert.deepEqual(fog.effects().b,g.effects().b);
  let hiddenPieces=0;
  for(const file of 'abcdefghij')for(let rank=1;rank<=10;rank++) {
    if(fog.get(file+rank)?.color==='w')hiddenPieces++;
  }
  assert.equal(hiddenPieces,1,'only a single dummy king must remain for FEN validation');
  const spectator=new Chess10(g.viewFen(null));
  const spectatorsVisible=Array.from({length:10},(_,i)=>i).flatMap(i=>'abcdefghij'.split('').map(f=>spectator.get(f+(i+1)))).filter(Boolean);
  assert.equal(spectatorsVisible.length,2,'spectators must not bypass the fog via a second browser');
});

test('the crate can respawn at move 60 and metadata survives position serialization', () => {
  const g=new Chess10('5k4/10/10/10/10/10/10/10/10/5K3R w - - 0 1',()=>0.11);
  g._s.meta.ply=59;
  g._s.meta.crate=51;
  const result=g.move({from:'j1',to:'j2'});
  assert.equal(g.ply(),60);
  assert.equal(result.crateSpawn,g.crate());
  assert.equal(new Chess10(g.fen()).fen(),g.fen());
});


test('merchant tile k6 accepts ANY non-king piece next to j5 j6 j7, including a rook',()=>{
  const game=new Chess10('5k4/10/10/10/10/9R/10/4N5/4B5/5K4 w - - 0 1');
  game._s.meta.ply=50;
  assert.equal(game.shop().tile,'k6');
  assert.deepEqual(game.shop().entrances,['j7','j6','j5']);
  assert.throws(()=>game.trade({visitor:'j4',sacrifice:['j4','e2','e3'],receive:'q'}),/k6/);
  const result=game.trade({visitor:'j5',sacrifice:['j5','e2','e3'],receive:'q'});
  assert.equal(result.trade.value,11);
  assert.deepEqual(game.get('j5'),{type:'q',color:'w'});
  assert.equal(game.shop().closed,true);
  const king=new Chess10('5k4/10/10/10/9K/10/10/4N5/4B5/10 w - - 0 1');
  king._s.meta.ply=50;
  assert.throws(()=>king.trade({visitor:'j6',sacrifice:['j6','e2','e3'],receive:'n'}),/k6/);
});

test('merchant values a magical pawn as pawn and clears converted timers when sacrificed',()=>{
  const game=new Chess10('5k4/10/10/10/9Q/10/10/4P5/4P5/5K4 w - - 0 1');
  game._s.meta.ply=50;
  game._s.morph.w={type:'q',square:49}; // j6, despite its queen-like appearance
  assert.throws(()=>game.trade({visitor:'j6',sacrifice:['j6','e2','e3'],receive:'q'}),/Недостаточно/);
  const tx=game.trade({visitor:'j6',sacrifice:['j6','e2','e3'],receive:'n'});
  assert.equal(tx.trade.value,3);
  assert.equal(game.morphs().w,null);
});

test('diamond move detection: forced queen capture is a uniquely excellent tactical reply',()=>{
  const game=new Chess10('5k4/10/10/10/10/10/10/10/4q5/K3R5 w - - 0 1');
  const result=game.move({from:'e1',to:'e2'});
  assert.equal(result.analysis?.depth,3);
  assert.equal(result.analysis?.best,true);
  assert.equal(result.brilliant,true);
  assert.ok(result.impact>=1000);
});

test('replay picks <= 5 distinct real moments with exactly 3000 ms and matching start/end positions',()=>{
  const game=new Chess10(undefined,()=>0.99);
  const seq=[['e2','e4'],['e9','e7'],['f2','f4'],['f9','f7'],['b2','b4'],['b9','b7']];
  for(const [from,to] of seq)game.move({from,to});
  const scenes=game.highlights();
  assert.equal(scenes.length,5);
  assert.deepEqual([...new Set(scenes.map(m=>m.index))].length,5);
  for(const m of scenes){
    assert.equal(m.durationMs,3000);
    assert.ok(m.before && m.after);
    assert.notEqual(new Chess10(m.before).fen(),new Chess10(m.after).fen());
    assert.equal(m.label,m.record.san);
  }
});

test('Rocket is NOT initially on the 10x10 board and has its own piece type',()=>{
  const g=new Chess10();
  assert.equal(g.get('f1')?.type,'k');
  assert.equal(g.history().length,0);
  assert.equal(g.moves({verbose:true}).some(m=>m.type==='t'),false);
  assert.ok(!g.fen().split(' ')[0].includes('T'));
});

test('Rocket moves to any adjacent free or opponent square, and launches exactly three squares forward',()=>{
  const g=new Chess10('k9/10/10/10/10/4T5/10/10/10/9K w - - 0 1');
  const targets=g.moves({square:'e5',verbose:true});
  assert.equal(targets.filter(m=>!m.flags.includes('L')).length,8);
  assert.deepEqual(targets.filter(m=>m.flags.includes('L')).map(m=>m.to),['e8']);
  assert.equal(targets.some(m=>m.to==='e9'),false);
  const record=g.move({from:'e5',to:'e8'});
  assert.ok(record.launch);
  assert.deepEqual(g.get('e8'),{type:'t',color:'w'});
  assert.equal(g.get('e5'),null);
  assert.equal(new Chess10(g.fen()).get('e8')?.type,'t');
});

test('Rocket launch blasts all 8 neighboring pieces of both colors, but preserves rocket itself',()=>{
  const g=new Chess10('k9/3q6/3r1P4/3n6/10/4T5/10/10/10/9K w - - 0 1');
  const move=g.move({from:'e5',to:'e8'});
  assert.equal(move.launch.victims.length,4);
  assert.deepEqual(move.launch.victims.map(x=>x.square).sort(),['d7','d8','d9','f8']);
  for(const cell of ['d7','d8','d9','f8'])assert.equal(g.get(cell),null);
  assert.deepEqual(g.get('e8'),{type:'t',color:'w'});
  assert.equal(g.get('a10')?.type,'k');
  assert.equal(g.get('j1')?.type,'k');
});

test('Rocket cannot launch when either king would be within blast radius',()=>{
  const enemyKing=new Chess10('10/3k6/10/10/10/4T5/10/10/10/9K w - - 0 1');
  assert.ok(!enemyKing.moves({square:'e5',verbose:true}).some(m=>m.to==='e8'));
  assert.throws(()=>enemyKing.move({from:'e5',to:'e8'}),/Недопустимый/);
  const ownKing=new Chess10('k9/3K6/10/10/10/4T5/10/10/10/10 w - - 0 1');
  assert.ok(!ownKing.moves({square:'e5',verbose:true}).some(m=>m.to==='e8'));
});

test('Black rocket launches in opposite direction, with 3-square backward flight prohibited',()=>{
  const g=new Chess10('9k/10/10/10/4t5/10/10/10/10/K9 b - - 0 1');
  const options=g.moves({square:'e6',verbose:true});
  assert.ok(options.some(m=>m.to==='e3'&&m.flags==='L'));
  assert.ok(!options.some(m=>m.to==='e9'));
  const out=g.move({from:'e6',to:'e3'});
  assert.ok(out.launch);
  assert.equal(g.get('e3')?.type,'t');
});

test('Rare 2% crate drop spawns a rocket on first available baseline square',()=>{
  const values=[.99,.995]; // no pawn morph, then rare crate reward
  const g=new Chess10('5k4/10/10/10/10/10/10/10/4P5/5K4 w - - 0 1',()=>values.shift());
  g._s.meta.crate=64;
  const event=g.move({from:'e2',to:'e4'});
  assert.equal(event.crateCollected?.kind,'rocket');
  assert.equal(event.crateCollected?.spawn,'e1');
  assert.equal(g.get('e1')?.type,'t');
  assert.equal(g.crate(),null);
  assert.equal(new Chess10(g.fen()).get('e1')?.type,'t');
});

test('Shop rocket costs 12 and spawns back at home while consuming 3 offerings',()=>{
  const bad=new Chess10('5k4/10/10/10/9P/10/10/10/4PP4/5K4 w - - 0 1');
  bad._s.meta.ply=50;
  assert.throws(()=>bad.trade({visitor:'j6',sacrifice:['j6','e2','f2'],receive:'t'}),/Недостаточно/);
  const g=new Chess10('5k4/10/10/10/9Q/10/10/10/4BN4/5K4 w - - 0 1');
  g._s.meta.ply=50;
  const result=g.trade({visitor:'j6',sacrifice:['j6','e2','f2'],receive:'t'});
  assert.equal(result.trade.value,15);
  assert.equal(result.trade.spawn,'e1');
  assert.deepEqual(g.get('e1'),{type:'t',color:'w'});
  assert.equal(g.get('j6'),null);
  assert.ok(g.shop().closed);
});

test('Rocket at launch zone is also preserved by UNO temporary color conversion serialization',()=>{
  const g=new Chess10('5k4/10/10/10/10/4T5/10/3u6/10/5K4 b - - 0 1');
  const moves=g.moves({square:'d3',verbose:true});
  assert.ok(!moves.some(m=>m.to==='e5')); // UNO can only move forward one row
  assert.equal(new Chess10(g.fen()).get('e5')?.type,'t');
});

test('Quiet ordinary moves are not automatically labeled as brilliant',()=>{
  const g=new Chess10();
  const result=g.move({from:'e2',to:'e4'});
  assert.equal(result.brilliant,false);
  assert.equal(result.analysis?.depth,3);
});
