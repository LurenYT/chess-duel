/* Russian draughts, shared by browser and authoritative online server. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else Object.assign(root, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const FILES = 'abcdefgh', DIAG = [[1,1],[1,-1],[-1,1],[-1,-1]];
  const valid = s => typeof s === 'string' && /^[a-h][1-8]$/.test(s);
  const square = (x,y) => x >= 0 && x < 8 && y >= 1 && y <= 8 ? FILES[x]+y : null;
  const copy = x => JSON.parse(JSON.stringify(x));
  class RussianDraughts {
    constructor(fen) {
      this._moves = [];
      if (fen !== undefined) {
        if (typeof fen !== 'string' || !fen.startsWith('RD1:')) throw Error('Неверная позиция шашек');
        this._s = JSON.parse(fen.slice(4));
      } else {
        this._s = {board:{}, turn:'w', chain:null, taken:[], ply:0, quiet:0, repetitions:{}};
        for (let y=1; y<=8; y++) for (let x=0; x<8; x++) {
          if ((x+y)%2===1 && (y<=3 || y>=6)) this._s.board[square(x,y)]={color:y<=3?'w':'b',type:'d'};
        }
        this._remember();
      }
    }
    fen() { return 'RD1:'+JSON.stringify(this._s); }
    viewFen() { return this.fen(); }
    turn() { return this._s.turn; }
    ply() { return this._s.ply; }
    get(s) { const p=this._s.board[s]; return p ? {...p} : null; }
    continuation() { return this._s.chain; }
    pendingCaptures() { return [...this._s.taken]; }
    _key() { return this.turn()+':'+Object.keys(this._s.board).sort().map(s=>s+this._s.board[s].color+this._s.board[s].type).join(','); }
    _remember() { const k=this._key(); this._s.repetitions[k]=(this._s.repetitions[k]||0)+1; }
    _captures(from) {
      const p=this.get(from), result=[];
      if (!p || this._s.taken.includes(from)) return result;
      const x=FILES.indexOf(from[0]),y=Number(from[1]);
      for (const [dx,dy] of DIAG) {
        let victim=null;
        for (let n=1; n<8; n++) {
          const to=square(x+dx*n,y+dy*n);
          if (!to) break;
          const target=this.get(to);
          if (target) {
            // Captured pieces remain blockers until the entire turn ends.
            if (victim || target.color===p.color || this._s.taken.includes(to)) break;
            victim=to;
          } else if (victim) {
            result.push({from,to,color:p.color,type:p.type,flags:'c',captured:this.get(victim).type,capturedSquare:victim});
            if (p.type==='d') break;
          } else if (p.type==='d') break;
          if (p.type==='d' && n>=2) break;
        }
      }
      return result;
    }
    moves({square:from,verbose=false}={}) {
      if (this.isDraw()) return [];
      const owned=Object.keys(this._s.board).filter(s=>this.get(s).color===this.turn() && !this._s.taken.includes(s));
      const origins=this._s.chain?[this._s.chain]:owned;
      let result=origins.flatMap(s=>this._captures(s));
      if (!result.length && !this._s.chain) {
        for (const s of owned) {
          const p=this.get(s),x=FILES.indexOf(s[0]),y=Number(s[1]);
          for (const [dx,dy] of DIAG) {
            if (p.type==='d' && dy!==(p.color==='w'?1:-1)) continue;
            for (let n=1;n<8;n++) {
              const to=square(x+dx*n,y+dy*n);
              if (!to || this.get(to)) break;
              result.push({from:s,to,color:p.color,type:p.type,flags:'n'});
              if(p.type==='d') break;
            }
          }
        }
      }
      if (from!==undefined) result=result.filter(m=>m.from===from);
      return verbose?result:result.map(m=>m.from+(m.captured?'×':'–')+m.to);
    }
    move(payload={}) {
      const {from,to}=payload;
      if (!valid(from) || !valid(to) || payload.promotion!==undefined || this.isDraw()) throw Error('Недопустимый ход шашки');
      const legal=this.moves({square:from,verbose:true}).find(m=>m.to===to);
      if (!legal) throw Error(this._s.chain?'Продолжите взятие той же шашкой':'Недопустимый ход: при наличии взятия нужно бить');
      const before=this.fen(), p=this.get(from), wasKing=p.type==='v';
      delete this._s.board[from];
      if (legal.capturedSquare) this._s.taken.push(legal.capturedSquare);
      if (p.type==='d' && Number(to[1])===(p.color==='w'?8:1)) p.type='v';
      this._s.board[to]=p;
      const crowned=!wasKing && p.type==='v';
      // House rule: one capture ends the turn, even if another is available.
      const captured=this._s.taken.length>0;
      for (const s of this._s.taken) delete this._s.board[s];
      this._s.taken=[];
      this._s.chain=null;
      this._s.quiet=wasKing && !captured?this._s.quiet+1:0;
      this._s.turn=p.color==='w'?'b':'w';
      this._s.ply++;
      this._remember();
      const record={...legal,crowned,continued:false,turnNumber:this._s.ply,
        san:from+(legal.captured?'×':'–')+to+(crowned?' Д':''),before,after:this.fen()};
      this._moves.push(record);
      return copy(record);
    }
    history({verbose=false}={}) { return verbose?copy(this._moves):this._moves.map(m=>m.san); }
    isCheck() { return false; }
    isStalemate() { return false; }
    isInsufficientMaterial() { return false; }
    isThreefoldRepetition() { return !this._s.chain && (this._s.repetitions[this._key()]||0)>=3; }
    isDraw() { return !this._s.chain && (this.isThreefoldRepetition() || this._s.quiet>=30); }
    isCheckmate() { return !this.isDraw() && this.moves({verbose:true}).length===0; }
    isGameOver() { return this.isDraw() || this.isCheckmate(); }
    effects() { return {w:[],b:[]}; }
    rentals() { return {w:null,b:null}; }
    morphs() { return {w:null,b:null}; }
    mines() { return []; }
    crate() { return null; }
    shop() { return {closed:true,open:false,side:'right',entrances:[]}; }
    setShopSide() {}
    pig() { throw Error('В шашках нет свиней'); }
    trade() { throw Error('В шашках нет торговли'); }
    highlights(limit=5) {
      return this._moves.map((m,index)=>({record:copy(m),before:m.before,after:m.after,index,
        score:(m.captured?10:0)+(m.crowned?15:0)+(m.continued?5:0),
        title:m.crowned?'Превращение в дамку':m.captured?'Взятие шашки':'Ход шашки',label:m.san}))
        .sort((a,b)=>b.score-a.score || a.index-b.index).slice(0,limit).sort((a,b)=>a.index-b.index);
    }
  }
  return {RussianDraughts};
});
