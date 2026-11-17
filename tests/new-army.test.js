'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {Chess10}=require('../public/chess10');
const TYPES=['h','c','l','g','a'];
function fen(pieces={},turn='w',half=0,full=1){
 const board={a1:'K',j10:'k',...pieces},rows=[];
 for(let rank=10;rank>=1;rank--){let row='',empty=0;for(const f of 'abcdefghij'){
  const p=board[f+rank];if(p){if(empty)row+=empty;empty=0;row+=p;}else empty++;
 }if(empty)row+=empty;rows.push(row);}
 return `${rows.join('/')} ${turn} - - ${half} ${full}`;
}
const game=(pieces,turn)=>new Chess10(fen(pieces,turn),()=>.99);
const targets=(g,s)=>g.moves({square:s,verbose:true}).map(m=>m.to);
test('each new type starts exactly once per side, and every new FEN round-trips',()=>{
 const g=new Chess10();let counts={};
 for(const f of 'abcdefghij')for(let r=1;r<=10;r++){const p=g.get(f+r);if(p)counts[p.color+p.type]=(counts[p.color+p.type]||0)+1;}
 for(const t of TYPES)for(const c of ['w','b'])assert.equal(counts[c+t],1);
 assert.equal(new Chess10(g.fen()).fen(),g.fen());assert.equal(g.isCheck(),false);
 assert.deepEqual(g.shop().prices,{p:1,n:3,b:3,r:5,q:9,s:6,u:6,m:5,t:12,h:8,c:10,l:4,g:4,a:5});
});
test('archbishop combines blocked bishop rays and independent knight jumps',()=>{
 const g=game({e5:'H',f6:'P',f7:'r'}),to=targets(g,'e5');
 for(const s of ['b8','d4','f7','g6'])assert.ok(to.includes(s),s);
 for(const s of ['f6','g7','e6','e8'])assert.ok(!to.includes(s),s);
 assert.equal(g.move({from:'e5',to:'f7'}).captured,'r');assert.equal(g.get('f7').type,'h');
});
test('chancellor combines rook rays and knight jumps without jumping on rook moves',()=>{
 const g=game({e5:'C',e6:'P',f7:'n'}),to=targets(g,'e5');
 for(const s of ['a5','i5','e2','f7','g6'])assert.ok(to.includes(s),s);
 for(const s of ['e6','e7','g7'])assert.ok(!to.includes(s),s);
 assert.equal(g.move({from:'e5',to:'f7'}).captured,'n');
});
test('camel has eight 3x1 jumps and can leap through occupied intermediate squares',()=>{
 const g=game({e5:'L',e6:'P',f6:'P',f8:'r'});
 assert.deepEqual(targets(g,'e5').sort(),['b4','b6','d2','d8','f2','f8','h4','h6']);
 assert.equal(g.move({from:'e5',to:'f8'}).captured,'r');
 const edge=targets(game({a3:'L'}),'a3');assert.ok(edge.every(s=>/^[a-j](10|[1-9])$/.test(s)));
});
test('guard steps like a king or leaps two orthogonal squares, not two diagonally',()=>{
 const g=game({e5:'G',e6:'P',e7:'r'}),to=targets(g,'e5');
 for(const s of ['d4','f6','e7','e3','c5','g5'])assert.ok(to.includes(s),s);
 for(const s of ['e6','g7','h5','f7'])assert.ok(!to.includes(s),s);
 assert.equal(g.move({from:'e5',to:'e7'}).captured,'r');
});
test('cannon quiet movement is rook-like and cannot capture without a screen',()=>{
 const g=game({e5:'A',e8:'r'}),to=targets(g,'e5');
 for(const s of ['e6','e7','c5','e2'])assert.ok(to.includes(s),s);
 for(const s of ['e8','e9','f6'])assert.ok(!to.includes(s),s);
 assert.throws(()=>g.move({from:'e5',to:'e8'}));
});
test('cannon captures past exactly one friendly or enemy screen and cannot land in the gap',()=>{
 for(const screen of ['P','p']){
  const g=game({e5:'A',e6:screen,e9:'r'}),to=targets(g,'e5');
  assert.ok(to.includes('e9'));assert.ok(!to.includes('e6'));assert.ok(!to.includes('e7'));
  assert.equal(g.move({from:'e5',to:'e9'}).captured,'r');assert.equal(g.get('e6').type,'p');
 }
 const g=game({e5:'A',e6:'P',e8:'P',e9:'r'});assert.ok(!targets(g,'e5').includes('e9'));
});
test('all new leapers and hybrids give check using their movement rules',()=>{
 for(const [type,source] of [['h','h9'],['c','h9'],['l','g9'],['g','j8']]){
  const g=game({[source]:type.toUpperCase()},'b');assert.equal(g.isCheck(),true,type);
  assert.ok(!g.moves({verbose:true}).some(m=>m.from==='j10'&&m.to==='j9'&&type==='g'));
 }
});
test('cannon check needs one screen, and adding a second screen removes it',()=>{
 assert.equal(game({j3:'A'},'b').isCheck(),false);
 assert.equal(game({j3:'A',j6:'P'},'b').isCheck(),true);
 assert.equal(game({j3:'A',j6:'P',j8:'p'},'b').isCheck(),false);
 const checked=game({a6:'a',a3:'P',b2:'R'});
 assert.equal(checked.isCheck(),true);assert.ok(!targets(checked,'b2').includes('c2'));
});
test('new pieces cannot capture a king or friendly pieces and respect pinned king safety',()=>{
 for(const t of TYPES){
  const g=game({e5:t.toUpperCase(),e6:'P'});
  assert.ok(!targets(g,'e5').includes('e6'));assert.ok(!targets(g,'e5').includes('j10'));
 }
 const g=game({a3:'L',a8:'r'});assert.ok(!targets(g,'a3').includes('b6'));
});
test('all five can be purchased with valid offerings and priced insufficient trades are rejected',()=>{
 for(const type of TYPES){
  const g=new Chess10(fen({j6:'R',e3:'Q',e2:'P'},'w',0,26),()=>.99);
  g.trade({visitor:'j6',sacrifice:['j6','e3','e2'],receive:type});
  assert.equal(g.get('j6').type,type);assert.equal(g.shop().closed,true);assert.equal(g.turn(),'b');
  assert.equal(new Chess10(g.fen()).get('j6').type,type);
 }
 const cheap=new Chess10(fen({j6:'P',e3:'P',e2:'P'},'w',0,26));
 assert.throws(()=>cheap.trade({visitor:'j6',sacrifice:['j6','e3','e2'],receive:'c'}),/ценности/);
});
test('UNO can convert each new piece and retain rental metadata through serialization',()=>{
 for(const type of TYPES){
  const g=game({e5:'U',f6:type});g.move({from:'e5',to:'f6'});
  assert.equal(g.get('f6').color,'w');assert.equal(g.rentals().w.type,type);
  const cloned=new Chess10(g.fen());assert.equal(cloned.rentals().w.type,type);assert.equal(cloned.get('f6').type,type);
 }
});
test('new pieces retain normal mine, capture-history and replay integration',()=>{
 const g=game({e5:'L',f8:'r'});const record=g.move({from:'e5',to:'f8'});
 assert.ok(Number.isFinite(record.impact));assert.ok(Number.isFinite(record.analysis.score));
 assert.equal(g.highlights()[0].record.type,'l');assert.equal(new Chess10(g.highlights()[0].after).get('f8').type,'l');
 const s=game({e5:'G'});s._s.meta.mines=[{owner:'b',square:34,remaining:7}]; // e7 = row 3, column 4.
 const move=s.move({from:'e5',to:'e7'});assert.equal(s.get('e7'),null);assert.equal(move.mineDetonated.victim,'g');
});
