'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {RussianDraughts}=require('../public/draughts');
function position(board,turn='w') {
  return new RussianDraughts('RD1:'+JSON.stringify({board:Object.fromEntries(Object.entries(board).map(([s,p])=>[s,{color:p[0],type:p[1]}])),turn,chain:null,taken:[],ply:0,quiet:0,repetitions:{}}));
}
const destinations=(g,s)=>g.moves({square:s,verbose:true}).map(m=>m.to).sort();
test('initial board: 12 men per side on 32 dark squares, white to move',()=>{
  const g=new RussianDraughts(),board=JSON.parse(g.fen().slice(4)).board;
  assert.equal(Object.values(board).filter(p=>p.color==='w').length,12);
  assert.equal(Object.values(board).filter(p=>p.color==='b').length,12);
  assert.ok(Object.keys(board).every(s=>('abcdefgh'.indexOf(s[0])+Number(s[1]))%2===1));
  assert.equal(g.moves({verbose:true}).length,7);
  assert.equal(g.turn(),'w');
});
test('men move forward exactly one diagonal, for both colors',()=>{
  assert.deepEqual(destinations(position({c3:'wd',h8:'bd'}),'c3'),['b4','d4']);
  assert.deepEqual(destinations(position({f6:'bd',a1:'wd'},'b'),'f6'),['e5','g5']);
});
test('white and black men capture backwards',()=>{
  let g=position({c3:'wd',d2:'bd',h8:'bd'});
  assert.deepEqual(destinations(g,'c3'),['e1']);
  g.move({from:'c3',to:'e1'});assert.equal(g.get('d2'),null);
  g=position({f6:'bd',e7:'wd',a1:'wd'},'b');
  g.move({from:'f6',to:'d8'});assert.equal(g.get('e7'),null);
});
test('mandatory capture is global: another piece cannot make a quiet move',()=>{
  const g=position({a1:'wd',c3:'wd',d4:'bd',h8:'bd'});
  assert.deepEqual(destinations(g,'a1'),[]);
  const before=g.fen();assert.throws(()=>g.move({from:'a1',to:'b2'}));assert.equal(g.fen(),before);
  assert.deepEqual(destinations(g,'c3'),['e5']);
});
test('flying king can move any free distance in all four diagonals',()=>{
  const g=position({d4:'wv',h8:'bd'});
  assert.deepEqual(destinations(g,'d4'),['a1','a7','b2','b6','c3','c5','e3','e5','f2','f6','g1','g7']);
});
test('flying king captures at distance and may land anywhere beyond one victim',()=>{
  const g=position({a1:'wv',d4:'bd',h8:'bd'});
  assert.deepEqual(destinations(g,'a1'),['e5','f6','g7']);
  assert.ok(g.moves({verbose:true}).every(m=>m.capturedSquare==='d4'));
});
test('a king cannot pass a friendly piece or jump two consecutive enemies',()=>{
  assert.deepEqual(destinations(position({a1:'wv',c3:'wd',h8:'bd'}),'a1'),['b2']);
  assert.deepEqual(destinations(position({a1:'wv',c3:'bd',d4:'bd',h8:'bd'}),'a1'),['b2']);
});
test('one capture passes the turn even when the same man could capture again',()=>{
  const g=position({a1:'wd',a3:'wd',b4:'bd',d6:'bd',h8:'bd'});
  const m=g.move({from:'a3',to:'c5'});
  assert.equal(m.continued,false);assert.equal(g.turn(),'b');assert.equal(g.continuation(),null);assert.equal(g.ply(),1);
  assert.deepEqual(destinations(g,'a1'),[]);assert.deepEqual(destinations(g,'c5'),[]);
  const before=g.fen();assert.throws(()=>g.move({from:'a1',to:'b2'}));assert.equal(g.fen(),before);
  assert.throws(()=>g.move({from:'c5',to:'e7'}));
  assert.equal(g.turn(),'b');assert.equal(g.continuation(),null);assert.equal(g.ply(),1);
  assert.equal(g.get('b4'),null);assert.equal(g.get('d6').color,'b');
});
test('capture promotion crowns the man and passes the turn without a second king capture',()=>{
  const g=position({b6:'wd',c7:'bd',f6:'bd',h8:'bd'});
  const m=g.move({from:'b6',to:'d8'});
  assert.equal(m.crowned,true);assert.equal(g.get('d8').type,'v');assert.equal(g.turn(),'b');
  assert.deepEqual(destinations(g,'d8'),[]);
  assert.throws(()=>g.move({from:'d8',to:'h4'}));assert.equal(g.get('f6').color,'b');
});
test('black capture promotion also ends the turn',()=>{
  const g=position({g3:'bd',f2:'wd',c3:'wd',a1:'wd'},'b');
  g.move({from:'g3',to:'e1'});assert.equal(g.get('e1').type,'v');
  assert.equal(g.turn(),'w');assert.deepEqual(destinations(g,'e1'),[]);
  assert.throws(()=>g.move({from:'e1',to:'b4'}));assert.equal(g.get('c3').color,'w');
});
test('quiet promotion is automatic and ends the turn',()=>{
  const g=position({b7:'wd',h8:'bd'});
  const m=g.move({from:'b7',to:'a8'});
  assert.equal(m.crowned,true);assert.equal(g.get('a8').type,'v');assert.equal(g.turn(),'b');
});
test('captured pieces remain blockers and cannot be captured twice (Turkish strike)',()=>{
  const g=position({c3:'wv',d4:'bd',b2:'bd',h8:'bd'});
  g.move({from:'c3',to:'e5'});
  assert.equal(g.turn(),'b');assert.equal(g.get('d4'),null);assert.equal(g.get('b2').color,'b');
});
test('reloading after capture cannot restore the capturing player turn',()=>{
  const g=position({a3:'wd',b4:'bd',d6:'bd',h8:'bd'});
  g.move({from:'a3',to:'c5'});
  const clone=new RussianDraughts(g.fen());
  assert.equal(clone.continuation(),null);assert.deepEqual(clone.pendingCaptures(),[]);
  assert.equal(clone.get('b4'),null);assert.equal(clone.turn(),'b');
  const before=clone.fen();assert.throws(()=>clone.move({from:'c5',to:'e7'}));assert.equal(clone.fen(),before);
});
test('there is no longest-capture requirement: both initial branches are legal',()=>{
  const g=position({c3:'wd',b4:'bd',d4:'bd',f6:'bd',h8:'bd'});
  assert.deepEqual(destinations(g,'c3'),['a5','e5']);
  g.move({from:'c3',to:'a5'});assert.equal(g.turn(),'b');
});
test('no pieces or no legal moves is a loss, not a drawn stalemate',()=>{
  const g=position({a1:'wd'} ,'b');
  assert.equal(g.isGameOver(),true);assert.equal(g.isCheckmate(),true);assert.equal(g.isDraw(),false);
  const blocked=position({a1:'bd',h8:'wd'},'b');
  assert.equal(blocked.isCheckmate(),true);assert.equal(blocked.isDraw(),false);
});
test('invalid squares, promotion choice, enemy piece and a quiet backwards move are rejected',()=>{
  const g=position({c3:'wd',h8:'bd'}),before=g.fen();
  for(const move of [{from:'c3',to:'d2'},{from:'h8',to:'g7'},{from:'c3',to:'i9'},{from:'c3',to:'d4',promotion:'q'}])assert.throws(()=>g.move(move));
  assert.equal(g.fen(),before);
});
test('king draw counter is maintained across serialization and reset by a man move',()=>{
  const g=position({a1:'wv',h6:'bv'});g._s.quiet=29;
  g.move({from:'a1',to:'b2'});assert.equal(g.isDraw(),true);
  assert.equal(new RussianDraughts(g.fen()).isDraw(),true);
  const man=position({a1:'wd',h6:'bv'});man._s.quiet=29;man.move({from:'a1',to:'b2'});assert.equal(man.isDraw(),false);
});
test('threefold repetition draws only between complete turns',()=>{
  const g=position({a1:'wv',h6:'bv'});g._remember();
  for(let i=0;i<2;i++)for(const [from,to] of [['a1','b2'],['h6','g5'],['b2','a1'],['g5','h6']])g.move({from,to});
  assert.equal(g.isThreefoldRepetition(),true);assert.equal(g.isGameOver(),true);
});
test('highlights use real before/after positions and preserve capture records',()=>{
  const g=position({c3:'wd',d4:'bd',h8:'bd'});g.move({from:'c3',to:'e5'});
  const [h]=g.highlights();assert.equal(new RussianDraughts(h.before).get('c3').type,'d');
  assert.equal(new RussianDraughts(h.after).get('d4'),null);assert.equal(h.record.capturedSquare,'d4');
});
test('every committed action switches sides and preserves piece count',()=>{
  const g=new RussianDraughts();
  for(let i=0;i<300&&!g.isGameOver();i++){
    const list=g.moves({verbose:true});assert.ok(list.length);
    const m=list[(i*7)%list.length],p=g.turn();g.move(m);
    assert.notEqual(g.turn(),p);assert.equal(g.continuation(),null);
    const b=JSON.parse(g.fen().slice(4)).board;assert.ok(Object.keys(b).length<=24);
  }
});
