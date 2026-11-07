/* CHESS DUEL 10x10 — shared game engine for browser and server.
   Variant rules: two autonomous pigs, one UNO card per player, and a 5% pawn mutation for one owner turn. UNO converts a victim for five controller moves.
   Pigs move as queens but
   may only be moved by the random pig action. Castling uses f-file king,
   b/i-file rooks. 10-file pawns promote to regular chess pieces. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Chess10 = api.Chess10;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const SIZE = 10;
  const MUTATION_CHANCE = 0.05;
  const MUTATION_TYPES = ['n','b','r','q','s','u','m']; // No king; UNO still obeys one-card-per-color rule.
  const BUFFS = [
    {id:'luck',label:'Золотая удача',description:'Шанс магии пешки 25% вместо 5% на 5 ходов.'},
    {id:'sprint',label:'Спринт пешек',description:'Пешки могут идти на 2 клетки с любой горизонтали (путь свободен).'},
    {id:'knight',label:'Стальные кони',description:'Кони умеют дополнительно ходить на 1 клетку в любую сторону.'},
    {id:'rook',label:'Рывок ладей',description:'Ладьи дополнительно ходят на одну клетку по диагонали.'},
    {id:'radar',label:'Радар',description:'На доске подсвечиваются клетки, атакуемые противником.'}
  ];
  const DEBUFFS = [
    {id:'fog',label:'Туман войны',description:'Враг 5 своих ходов не видит расположение ваших фигур.'},
    {id:'tired',label:'Тяжёлые сапоги',description:'Пешки противника не могут ходить на 2 клетки.'},
    {id:'sleepy',label:'Сонные кони',description:'Противник не может ходить конями; кони продолжают угрожать клеткам.'},
    {id:'queen',label:'Скованная королева',description:'Ферзь противника ограничен одним шагом в любом направлении.'},
    {id:'pig',label:'Тишина в хлеву',description:'Противник не может активировать свиней.'}
  ];
  const PRICES={p:1,n:3,b:3,r:5,q:9,s:6,u:6,m:5,t:12};
  const EFFECTS=[...BUFFS,...DEBUFFS];
  const defaultMeta=(ply=0)=>({ply,crate:-1,shopClosed:false,shopSide:'right',mines:[],effects:{w:[],b:[]}});
  const cloneMeta=m=>({ply:m.ply,crate:m.crate,shopClosed:m.shopClosed,shopSide:m.shopSide||'right',mines:(m.mines||[]).map(x=>({...x})),
    effects:{w:m.effects.w.map(e=>({...e})),b:m.effects.b.map(e=>({...e}))}});
  const hasEffect=(s,who,id)=>!!s.meta?.effects?.[who]?.some(e=>e.id===id && e.remaining>0);
  const shopEntrances=(side)=>side==='left'?['a7','a6','a5']:['j7','j6','j5'];
  const isShopVisitor=(i,side)=>shopEntrances(side).some(square=>i===xy(square));

  const FILES = 'abcdefghij';
  const START = '1rnbqkbnr1/pppppppppp/s5um1s/10/10/10/10/S2U3M1S/PPPPPPPPPP/1RNBQKBNR1 w KQkq - 0 1';
  const KNIGHT = [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]];
  const KING = [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]];
  const DIAG = [[-1,-1],[-1,1],[1,-1],[1,1]];
  const ORTH = [[-1,0],[1,0],[0,-1],[0,1]];
  const VECTORS = { b: DIAG, r: ORTH, q: [...DIAG,...ORTH], s: [...DIAG,...ORTH] };
  const inside = (r,c) => r>=0 && r<SIZE && c>=0 && c<SIZE;
  const idx = (r,c) => r*SIZE+c;
  const color = (p) => p === '.' || !p ? null : p === p.toUpperCase() ? 'w' : 'b';
  const xy = (square) => {
    if (typeof square !== 'string' || !/^[a-j](10|[1-9])$/.test(square)) return -1;
    return idx(10-Number(square.slice(1)),FILES.indexOf(square[0]));
  };
  const name = (i) => FILES[i%SIZE] + (SIZE-Math.floor(i/SIZE));
  const enemy = (c) => c === 'w' ? 'b' : 'w';
  const at = (board,r,c) => inside(r,c) ? board[idx(r,c)] : null;
  function fromFen(fen) {
    const parts = String(fen).trim().split(/\s+/);
    if ((parts.length < 6 || parts.length > 9) || !/^[wb]$/.test(parts[1]) || !/^(?:-|K?Q?k?q?)$/.test(parts[2]) || !/^(?:-|[a-j](10|[1-9]))$/.test(parts[3])) throw Error('Неверная позиция FEN 10×10');
    const rows = parts[0].split('/');
    if (rows.length !== SIZE) throw Error('Нужны 10 рядов');
    const board = [];
    for (const row of rows) {
      const tokens = row.match(/10|[1-9]|[prnbqksutmPRNBQKSUTM]/g);
      if (!tokens || tokens.join('') !== row) throw Error('Недопустимый символ фигуры');
      const cells = [];
      for (const t of tokens) if (/^\d+$/.test(t)) cells.push(...Array(Number(t)).fill('.')); else cells.push(t);
      if (cells.length !== SIZE) throw Error('В каждом ряду ровно 10 клеток');
      board.push(...cells);
    }
    if (board.filter((p)=>p==='K').length!==1 || board.filter((p)=>p==='k').length!==1) throw Error('По одному королю');
    // At most one UNO card per side, including imported positions.
    if (board.filter(p=>p==='M').length>1 || board.filter(p=>p==='m').length>1)throw Error('На поле может быть не более одного минера каждой команды');
    if (board.filter(p=>p==='U').length>1 || board.filter(p=>p==='u').length>1)
      throw Error('На доске может быть не более одной UNO-карты на команду');
    const rental = {w:null,b:null}; // Temporary color conversions, one per team.
    // Optional 7th field is variant metadata. Regular 6-field positions remain valid.
    if(parts[6] && parts[6] !== '-') {
      for(const token of parts[6].split(';')) {
        const match=/^([wb]):([prnbqstm]):([1-5]):([a-j](?:10|[1-9])):([wb])$/.exec(token);
        if(!match || rental[match?.[1]])throw Error('Неверные данные временного перекрашивания');
        const owner=match[1], type=match[2], remaining=Number(match[3]), square=xy(match[4]), original=match[5];
        if(original===owner || board[square] !== (owner==='w'?type.toUpperCase():type))
          throw Error('Перекрашенная фигура не соответствует позиции');
        rental[owner]={type,remaining,square,original};
      }
    }
    if(rental.w && rental.b && rental.w.square===rental.b.square)
      throw Error('Одна фигура не может быть перекрашена дважды');
    // Eighth field stores a pawn's temporary evolution. The seventh field
    // remains backwards-compatible UNO rental metadata (or '-' if absent).
    const morph = {w:null,b:null};
    if(parts[7] && parts[7] !== '-') {
      for(const token of parts[7].split(';')) {
        const match=/^([wb]):([nbrqsum]):([a-j](?:10|[1-9]))$/.exec(token);
        if(!match || morph[match?.[1]])throw Error('Неверные данные временного превращения');
        const owner=match[1], type=match[2], square=xy(match[3]);
        if(board[square] !== (owner==='w'?type.toUpperCase():type) || rental[owner]?.square===square)
          throw Error('Временная фигура не соответствует позиции');
        morph[owner]={type,square};
      }
    }
    const half = Number(parts[4]), full = Number(parts[5]);
    if (!Number.isSafeInteger(half) || half < 0 || !Number.isSafeInteger(full) || full < 1) throw Error('Неверные счётчики хода');
    const inferredPly=2*(full-1)+(parts[1]==='b'?1:0);
    const meta=defaultMeta(inferredPly);
    if(parts[8] && parts[8]!=='-') {
      let data;
      try {data=JSON.parse(decodeURIComponent(parts[8]));}catch {throw Error('Неверные данные ящика/лавки');}
      if(!Number.isSafeInteger(data?.ply)||data.ply<0 ||
        !Number.isInteger(data.crate)||data.crate < -1||data.crate>=100 ||
        typeof data.shopClosed!=='boolean' || (data.shopSide!==undefined&&!['left','right'].includes(data.shopSide)) || (data.mines!==undefined&&!Array.isArray(data.mines)) || !data.effects ||
        !Array.isArray(data.effects.w) || !Array.isArray(data.effects.b))
        throw Error('Неверные данные событий');
      meta.ply=data.ply;meta.crate=data.crate;meta.shopClosed=data.shopClosed;
      meta.shopSide=data.shopSide||'right';
      if((data.mines||[]).length>40)throw Error('Слишком много мин');
      for(const mine of data.mines||[]){
        if(!mine||!['w','b'].includes(mine.owner)||!Number.isInteger(mine.square)||mine.square<0||mine.square>=100||
          !Number.isInteger(mine.remaining)||mine.remaining<1||mine.remaining>7||
          meta.mines.some(m=>m.square===mine.square)||board[mine.square].toLowerCase()==='k')throw Error('Неверные данные мины');
        meta.mines.push({owner:mine.owner,square:mine.square,remaining:mine.remaining});
      }
      for(const c of ['w','b'])for(const effect of data.effects[c]) {
        if(!EFFECTS.some(e=>e.id===effect.id) || !Number.isInteger(effect.remaining) ||
          effect.remaining<1 || effect.remaining>5 || meta.effects[c].some(e=>e.id===effect.id) ||
          data.effects[c].length>10)throw Error('Неверный эффект');
        meta.effects[c].push({id:effect.id,remaining:effect.remaining});
      }
      if(meta.crate>=0 && board[meta.crate]!=='.')throw Error('Ящик должен быть на пустой клетке');
    }
    return { board, turn: parts[1], castle: parts[2] === '-' ? '' : parts[2], ep: parts[3] === '-' ? -1 : xy(parts[3]), half, full, rental, morph,meta };
  }
  function toFen(s) {
    const ranks = [];
    for (let r=0;r<SIZE;r++) {
      let value='',empty=0;
      for (let c=0;c<SIZE;c++) {
        const p=s.board[idx(r,c)];
        if (p==='.') empty++;
        else { if(empty) value+=empty; value+=p; empty=0; }
      }
      if (empty) value+=empty;
      ranks.push(value);
    }
    const fields=[ranks.join('/'),s.turn,s.castle||'-',s.ep<0?'-':name(s.ep),s.half,s.full];
    const extras=['w','b'].filter(c=>s.rental[c]).map(c=>{
      const {type,remaining,square,original}=s.rental[c];
      return `${c}:${type}:${remaining}:${name(square)}:${original}`;
    });
    const morphs=['w','b'].filter(c=>s.morph[c]).map(c=>{
      const {type,square}=s.morph[c];
      return `${c}:${type}:${name(square)}`;
    });
    if(morphs.length)fields.push(extras.join(';')||'-',morphs.join(';'));
    else if(extras.length)fields.push(extras.join(';'));
    if(s.meta && (s.meta.ply!==2*(s.full-1)+(s.turn==='b'?1:0) || s.meta.crate>=0 ||
      s.meta.shopClosed || s.meta.shopSide==='left' || s.meta.mines.length || s.meta.effects.w.length || s.meta.effects.b.length)) {
      while(fields.length<8)fields.push('-');
      fields.push(encodeURIComponent(JSON.stringify(s.meta)));
    }
    return fields.join(' ');
  }
  function attacked(s,target,by) {
    const tr=Math.floor(target/SIZE),tc=target%SIZE;
    for (let i=0;i<100;i++) {
      const piece=s.board[i];
      if (color(piece)!==by) continue;
      const t=piece.toLowerCase(),r=Math.floor(i/SIZE),c=i%SIZE;
      if (t==='p') {
        if (tr===r+(by==='w'?-1:1) && Math.abs(tc-c)===1) return true;
      } else if (t==='u') {
        // UNO only attacks one square forward (straight or diagonally), never backwards.
        if(tr===r+(by==='w'?-1:1) && Math.abs(tc-c)<=1)return true;
      } else if(t==='m'){
        // A miner cannot capture or threaten a king; only planted mines hurt pieces.
        continue;
      } else if (t==='n' || t==='k' || t==='t') {
        const dirs=t==='k'||t==='t'?KING:hasEffect(s,by,'knight')?[...KNIGHT,...KING]:KNIGHT;
        if (dirs.some(([dr,dc])=>tr===r+dr&&tc===c+dc)) return true;
      } else {
        const diagonals=t==='r' && hasEffect(s,by,'rook')?DIAG:[];
        for (const [dr,dc] of [...(VECTORS[t]||[]),...diagonals]) {
          let nr=r+dr,nc=c+dc;
          while(inside(nr,nc)) {
            const dest=idx(nr,nc);
            if(dest===target) return true;
            if(s.board[dest]!=='.' || (t==='q' && hasEffect(s,by,'queen')) ||
              (t==='r' && diagonals.some(([a,b])=>a===dr&&b===dc))) break;
            nr+=dr;nc+=dc;
          }
        }
      }
    }
    return false;
  }
  function check(s,c=s.turn) { return attacked(s,s.board.indexOf(c==='w'?'K':'k'),enemy(c)); }
  function advanceRental(board,rental,who) {
    const item=rental[who];
    if(!item)return;
    const remaining=item.remaining-1;
    if(remaining<=0) {
      // After the fifth *controller's* move the piece returns to its original
      // color ON ITS CURRENT SQUARE; it does not disappear.
      const p=board[item.square];
      if(p!=='.' && color(p)===who)
        board[item.square]=item.original==='w'?p.toUpperCase():p.toLowerCase();
      rental[who]=null;
    } else rental[who]={...item,remaining};
  }
  const backRank=(index,side)=>Math.floor(index/10)===(side==='w'?0:9);
  function expireMorph(board,morph,who){
    if(!morph[who])return;
    const loc=morph[who].square;
    // A magically evolved pawn reaching the last rank becomes permanent;
    // it is NOT promoted or randomly mutated again.
    if(color(board[loc])===who && !backRank(loc,who))board[loc]=who==='w'?'P':'p';
    morph[who]=null;
  }
  function apply(s,m) {
    const board=s.board.slice(),piece=board[m.a],taken=board[m.b],who=s.turn,opp=enemy(who);
    const rental={w:s.rental.w&&{...s.rental.w},b:s.rental.b&&{...s.rental.b}};
    const morph={w:s.morph.w&&{...s.morph.w},b:s.morph.b&&{...s.morph.b}};
    const meta=cloneMeta(s.meta);
    if(m.flags.includes('M')){
      // Planting a mine is the miner's action. It stays where it was;
      // the mine becomes armed for the next seven completed plies.
      meta.mines.push({owner:who,square:m.b,remaining:8});
      advanceRental(board,rental,who);
      expireMorph(board,morph,who);
      return {board,turn:opp,castle:s.castle,ep:-1,half:s.half+1,
        full:s.full+(who==='b'?1:0),rental,morph,meta};
    }
    const epTaken=m.flags.includes('e')?idx(Math.floor(m.a/10),m.b%10):-1;
    const victimSquare=epTaken>=0?epTaken:m.b;
    // Taking a converted figure normally removes it and its conversion timer.
    if(rental[opp]?.square===victimSquare)rental[opp]=null;
    // A temporary evolved pawn can be captured before its next owner turn.
    const victimWasEvolvedPawn=morph[opp]?.square===victimSquare;
    if(victimWasEvolvedPawn)morph[opp]=null;
    const unoConvert=piece.toLowerCase()==='u' && taken!=='.' && taken.toLowerCase()!=='u';
    // UNO captures the pawn's true identity, not the temporary magical form.
    const convertedType=victimWasEvolvedPawn?'p':taken.toLowerCase();
    board[m.a]='.';
    // UNO vanishes, the affected figure stays on its square and switches sides.
    board[m.b]=unoConvert?(who==='w'?convertedType.toUpperCase():convertedType)
      :m.promotion?(who==='w'?m.promotion.toUpperCase():m.promotion):piece;
    if(epTaken>=0)board[epTaken]='.';
    if(m.flags.includes('L')) {
      // The rocket lands on its TARGET square and blasts its 8 neighbors.
      // Its flight ignores intervening pieces. A king anywhere in the
      // 3×3 landing zone makes the whole launch illegal before committing.
      const row=Math.floor(m.b/10),col=m.b%10;
      for(const [dr,dc] of KING){
        if(!inside(row+dr,col+dc))continue;
        const square=idx(row+dr,col+dc);
        const victim=board[square];
        if(victim==='.')continue;
        board[square]='.';
        for(const side of ['w','b']){
          if(rental[side]?.square===square)rental[side]=null;
          if(morph[side]?.square===square)morph[side]=null;
        }
      }
    }
    // A launched rocket is a one-use weapon: remove it after the explosion.
    if(m.flags.includes('L'))board[m.b]='.';
    // Enemy mines detonate when a piece ENTERS the mined square.
    // Kings must never be allowed to enter such a square (checked by pseudo).
    const trap=meta.mines.find(x=>x.square===m.b && x.owner!==who);
    if(trap){
      board[m.b]='.';
      meta.mines=meta.mines.filter(x=>x!==trap);
      if(rental[who]?.square===m.a)rental[who]=null;
      if(morph[who]?.square===m.a)morph[who]=null;
    }
    if(rental[who]?.square===m.a) {
      rental[who]={...rental[who],square:m.b,type:m.promotion||rental[who].type};
    }
    if(morph[who]?.square===m.a)morph[who]={...morph[who],square:m.b};
    if(m.flags.includes('k') || m.flags.includes('q')) {
      const home=who==='w'?9:0;
      const rookFrom=idx(home,m.flags.includes('k')?8:1);
      const rookTo=idx(home,m.flags.includes('k')?6:4);
      board[rookTo]=board[rookFrom]; board[rookFrom]='.';
    }
    let castle=s.castle;
    const disable=(rights)=>{for(const r of rights)castle=castle.replace(r,'');};
    // Blast victims on their original corner squares also lose castling rights.
    if(m.flags.includes('L'))for(const [corner,right] of [[idx(9,8),'K'],[idx(9,1),'Q'],[idx(0,8),'k'],[idx(0,1),'q']]) {
      if(s.board[corner]!==board[corner] && board[corner]==='.')disable(right);
    }
    if(piece==='K')disable('KQ');
    if(piece==='k')disable('kq');
    // Capturing or temporarily converting a rook removes its former castling right.
    for(const [i,flag] of [[idx(9,8),'K'],[idx(9,1),'Q'],[idx(0,8),'k'],[idx(0,1),'q']]) {
      if(m.a===i || m.b===i)disable(flag);
    }
    const ep=piece.toLowerCase()==='p' && Math.abs(m.b-m.a)===20?(m.a+m.b)/2:-1;
    advanceRental(board,rental,who);
    // Evolution ends when its owner completes ONE subsequent move, even if
    // another piece was moved. If the evolved piece was used, it reverts at
    // its new position; if UNO sacrificed itself, there is nothing to revert.
    expireMorph(board,morph,who);
    // Start at FIVE after the converting move, not four: the card's own move
    // must not count against the next five moves of its new controller.
    if(unoConvert) rental[who]={type:convertedType,remaining:5,square:m.b,original:opp};
    return {board,turn:opp,castle,ep,
      half:piece.toLowerCase()==='p'||taken!=='.'||m.flags.includes('e')||m.flags.includes('L')||trap?0:s.half+1,
      full:s.full+(who==='b'?1:0),rental,morph,meta};
  }
  function pseudo(s) {
    const moves=[];
    const push=(a,b,flags='')=> {
      if(s.board[b].toLowerCase()==='k')return;
      if(s.board[a].toLowerCase()==='u' && s.board[b].toLowerCase()==='m' &&
         s.board.some(p=>p===(s.turn==='w'?'M':'m')))return;
      const piece=s.board[a];
      if(piece.toLowerCase()==='p' && (Math.floor(b/10)===(s.turn==='w'?0:9))) {
        for(const promotion of 'qrbn')moves.push({a,b,flags:flags+'p',promotion});
      }else moves.push({a,b,flags,promotion:null});
    };
    for(let a=0;a<100;a++) {
      const piece=s.board[a];
      if(color(piece)!==s.turn)continue;
      const p=piece.toLowerCase(),r=Math.floor(a/10),c=a%10;
      if(p==='p') {
        const dir=s.turn==='w'?-1:1, nr=r+dir;
        if(inside(nr,c) && at(s.board,nr,c)==='.') {
          push(a,idx(nr,c));
          const nr2=r+2*dir;
          if(!hasEffect(s,s.turn,'tired') &&
             (r===(s.turn==='w'?8:1)||hasEffect(s,s.turn,'sprint')) &&
             inside(nr2,c) && at(s.board,nr2,c)==='.') push(a,idx(nr2,c),'b');
        }
        for(const dc of [-1,1])if(inside(nr,c+dc)) {
          const b=idx(nr,c+dc),occupant=s.board[b];
          if(occupant!=='.' && color(occupant)===enemy(s.turn))push(a,b,'c');
          else if(b===s.ep && occupant==='.' && s.board[idx(r,c+dc)]===(s.turn==='w'?'p':'P'))push(a,b,'e');
        }
      } else if(p==='u') {
        // One step forward, either straight or diagonally. Never moves backwards.
        const nr=r+(s.turn==='w'?-1:1);
        for(const dc of [-1,0,1])if(inside(nr,c+dc)) {
          const b=idx(nr,c+dc),occupant=s.board[b];
          if(color(occupant)!==s.turn)push(a,b,occupant!=='.'?'c':'');
        }
      } else if(p==='m') {
        for(const [dr,dc] of KING){
          const nr=r+dr,nc=c+dc;
          if(inside(nr,nc)&&at(s.board,nr,nc)==='.' &&
             !s.meta.mines.some(x=>x.square===idx(nr,nc)))push(a,idx(nr,nc));
          const mr=r+2*dr,mc=c+2*dc;
          if(inside(mr,mc)&&at(s.board,mr,mc)==='.' &&
             !s.meta.mines.some(x=>x.square===idx(mr,mc)))push(a,idx(mr,mc),'M');
        }
      } else if(p==='t') {
        // Adjacent move/capture or three squares straight forward for launch.
        // A rocket cannot land on an occupied square when it launches.
        for(const [dr,dc] of KING){
          const nr=r+dr,nc=c+dc;
          if(inside(nr,nc) && color(at(s.board,nr,nc))!==s.turn)
            push(a,idx(nr,nc),at(s.board,nr,nc)!=='.'?'c':'');
        }
        const landingRow=r+(s.turn==='w'?-3:3);
        if(inside(landingRow,c)&&at(s.board,landingRow,c)==='.'){
          const blast=KING.every(([dr,dc])=>!inside(landingRow+dr,c+dc) ||
            at(s.board,landingRow+dr,c+dc).toLowerCase()!=='k');
          if(blast)push(a,idx(landingRow,c),'L');
        }
      } else if(p==='n'||p==='k') {
        if(p==='n'&&hasEffect(s,s.turn,'sleepy'))continue;
        const vectors=p==='k'?KING:hasEffect(s,s.turn,'knight')?[...KNIGHT,...KING]:KNIGHT;
        for(const [dr,dc] of vectors) {
          const nr=r+dr,nc=c+dc;
          if(inside(nr,nc) && color(at(s.board,nr,nc))!==s.turn &&
             !(p==='k'&&s.meta.mines.some(m=>m.square===idx(nr,nc)&&m.owner!==s.turn)))
            push(a,idx(nr,nc),at(s.board,nr,nc)!=='.'?'c':'');
        }
        if(p==='k' && c===5 && r===(s.turn==='w'?9:0) && !check(s)) {
          const mine=s.turn==='w'?'R':'r', opponent=enemy(s.turn);
          const home=s.turn==='w'?9:0;
          const shortRight=s.turn==='w'?'K':'k', longRight=s.turn==='w'?'Q':'q';
          if(s.castle.includes(shortRight) && at(s.board,home,8)===mine &&
             [6,7].every(c=>at(s.board,home,c)==='.' && !attacked(s,idx(home,c),opponent) &&
               !s.meta.mines.some(m=>m.square===idx(home,c)&&m.owner===opponent)))push(a,idx(home,7),'k');
          if(s.castle.includes(longRight) && at(s.board,home,1)===mine &&
             [2,3,4].every(c=>at(s.board,home,c)==='.') &&
             [4,3].every(c=>!attacked(s,idx(home,c),opponent) &&
               !s.meta.mines.some(m=>m.square===idx(home,c)&&m.owner===opponent)))push(a,idx(home,3),'q');
        }
      } else {
        if(p==='s'&&hasEffect(s,s.turn,'pig'))continue;
        const extra=p==='r'&&hasEffect(s,s.turn,'rook')?DIAG:[];
        for(const [dr,dc] of [...(VECTORS[p]||[]),...extra]) {
          let nr=r+dr,nc=c+dc;
          while(inside(nr,nc)) {
            const b=idx(nr,nc),occupant=s.board[b];
            if(color(occupant)===s.turn)break;
            push(a,b,occupant!=='.'?'c':'');
            if(occupant!=='.'||(p==='q'&&hasEffect(s,s.turn,'queen'))||
              (p==='r'&&extra.some(([a,b])=>a===dr&&b===dc)))break;
            nr+=dr;nc+=dc;
          }
        }
      }
    }
    return moves;
  }
  function legal(s){return pseudo(s).filter(m=>!check(apply(s,m),s.turn));}
  // Variant-aware, deterministic 2-ply evaluation. Not a tablebase or proof of
  // optimal play: compares legal moves against the strongest *immediate* reply.
  // No RNG is consumed; effects, UNO conversions and pig movement are simulated.
  const VALUES={p:100,n:330,b:340,r:510,q:920,s:680,u:570,m:450,t:1190,k:0};
  // Positional evaluator: material, central control, development, pawn structure,
  // king shelter and the value of controlling open files. All deterministic.
  function boardValue(s,viewer){
    let score=0;
    const occupied=s.board,minor={w:0,b:0},pawns={w:Array(10).fill(0),b:Array(10).fill(0)};
    for(let i=0;i<100;i++)if(occupied[i].toLowerCase()==='p')pawns[color(occupied[i])][i%10]++;
    for(let i=0;i<100;i++) {
      const p=occupied[i],owner=color(p);if(!owner)continue;
      const type=p.toLowerCase(),row=Math.floor(i/10),col=i%10;
      const center=Math.max(0,9-Math.abs(col-4.5)-Math.abs(row-4.5));
      const advance=owner==='w'?9-row:row;
      const initialRow=owner==='w'?9:0;
      let pos=0;
      if(type==='p'){
        pos=advance*8+center*3;
        if(pawns[owner][col]>1)pos-=20;
        const neighbors=(col>0?pawns[owner][col-1]:0)+(col<9?pawns[owner][col+1]:0);
        if(!neighbors)pos-=18;
      } else if(type==='n'||type==='b'){
        pos=center*8+(row===initialRow?-12:24);minor[owner]++;
      } else if(type==='r'){
        pos=center*2+(!pawns[owner][col]?25:0)+(!pawns[enemy(owner)][col]?18:0);
      } else if(type==='q')pos=center*3;
      else if(type==='s'||type==='u'||type==='t'||type==='m')pos=center*4+advance*2;
      else if(type==='k') {
        // Reward king shelter before the endgame and centralization later.
        const endgame=occupied.filter(x=>['q','Q','r','R','t','T'].includes(x)).length<3;
        pos=endgame?center*6:(-center*5+((col<3||col>6)?18:0));
      }
      score+=(owner===viewer?1:-1)*(VALUES[type]+pos);
    }
    // A minor-piece imbalance matters less without a supporting army.
    score+=(viewer==='w'?1:-1)*(minor.w-minor.b)*3;
    for(const side of ['w','b'])for(const effect of s.meta.effects[side]){
      const good=BUFFS.some(item=>item.id===effect.id);
      score+=(side===viewer?1:-1)*(good?1:-1)*effect.remaining*9;
    }
    return score;
  }
  const moveIdentity=m=>m.a+':'+m.b+':'+(m.promotion||'')+':'+m.flags;
  function terminalScore(s,who){
    const kingsafe=check(s,s.turn);
    const moves=legal(s);
    if(!moves.length)return kingsafe?(s.turn===who?-90000:90000):0;
    return null;
  }
  function staticMoveScore(s,m,viewer){
    const next=apply(s,m);
    let value=boardValue(next,viewer);
    if(m.flags.includes('L')){
      // The area blast is already included in boardValue(next).
      value+=(viewer===s.turn?1:-1)*22;
    }
    if(check(next,enemy(s.turn)))value+=(viewer===s.turn?1:-1)*44;
    if(s.meta.crate===m.b)value+=(viewer===s.turn?1:-1)*40;
    return value;
  }
  function shortlist(s,moves,viewer,limit,include=null){
    const ranked=moves.map(m=>({m,score:staticMoveScore(s,m,viewer)}))
      .sort((a,b)=>b.score-a.score||a.m.a-b.m.a||a.m.b-b.m.b);
    const picks=ranked.slice(0,limit).map(x=>x.m);
    if(include&&!picks.some(m=>moveIdentity(m)===moveIdentity(include)))picks.push(include);
    return picks;
  }
  // Three-ply selective minimax. Search a shortlist of promising legal
  // first moves, worst opponent replies, and the strongest answer. Checkmate
  // is treated as decisive; the final judgment is intentionally conservative.
  function candidateSearch(s,m){
    const us=s.turn,next=apply(s,m),opponent=enemy(us);
    let replies=legal(next);
    if(!replies.length)return check(next,opponent)?90000:0;
    // Opponent prefers positions with the smallest score for 'us'.
    const threat=replies.map(reply=>({reply,score:staticMoveScore(next,reply,us)}))
      .sort((a,b)=>a.score-b.score||a.reply.a-b.reply.a).slice(0,4);
    let worst=Infinity;
    for(const {reply} of threat){
      const after=apply(next,reply);
      const answer=legal(after);
      if(!answer.length){
        worst=Math.min(worst,check(after,us)?-90000:0);continue;
      }
      const final=shortlist(after,answer,us,3);
      let bestReply=-Infinity;
      for(const response of final){
        const ending=apply(after,response);
        let value=boardValue(ending,us);
        if(check(ending,enemy(us)))value+=45;
        bestReply=Math.max(bestReply,value);
      }
      worst=Math.min(worst,bestReply);
    }
    return worst;
  }
  function analyzePly(s,played,all){
    // Only make a premium award for genuinely tactical decisions. It is not
    // an every-move "best move" badge; quiet improving moves stay unmarked.
    const pre=s.board[played.a].toLowerCase(),next=apply(s,played);
    const explosion=played.flags.includes('L');
    const victims=explosion?blastVictims(s,played.b):[];
    const captured=s.board[played.b]!=='.'||played.flags.includes('e')||victims.length>0;
    const tactical=captured||check(s)||check(next,enemy(s.turn));
    if(pre==='s'||!tactical)return {brilliant:false,score:0,margin:0,best:false,depth:3};
    const options=all.filter(m=>s.board[m.a].toLowerCase()!=='s');
    const root=shortlist(s,options,s.turn,8,played);
    const ranked=root.map(m=>({m,score:candidateSearch(s,m)}))
      .sort((a,b)=>b.score-a.score||a.m.a-b.m.a||a.m.b-b.m.b);
    const choice=ranked.find(x=>moveIdentity(x.m)===moveIdentity(played));
    if(!choice)return {brilliant:false,score:0,margin:0,best:false,depth:3};
    const second=ranked.filter(x=>x!==choice)[0]?.score??-Infinity;
    const margin=choice.score-second;
    const best=ranked[0]===choice;
    const improvement=choice.score-boardValue(s,s.turn);
    const majorTactic=victims.some(x=>VALUES[x.type]>=330)||
      (s.board[played.b]!=='.'&&VALUES[s.board[played.b].toLowerCase()]>=330)||
      (check(next,enemy(s.turn))&&legal(next).length===0);
    // Overwhelmingly best, genuinely significant, not merely a free pawn.
    const brilliant=best&&majorTactic&&margin>=165&&improvement>=170&&choice.score>-50000;
    return {brilliant,score:Math.round(improvement),margin:Number.isFinite(margin)?Math.round(margin):0,
      best,depth:3,alternatives:root.length};
  }
  function blastVictims(s,target){
    const row=Math.floor(target/10),col=target%10,result=[];
    for(const [dr,dc] of KING){
      if(!inside(row+dr,col+dc))continue;
      const square=idx(row+dr,col+dc),piece=s.board[square];
      if(piece!=='.')result.push({square:name(square),type:piece.toLowerCase(),color:color(piece)});
    }
    return result;
  }
  function momentScore(record,next){
    const caught=VALUES[record.captured]||0;
    const tactical=(record.brilliant?1000:0)+(record.type==='trade'?220:0)+
      (record.launch?400+record.launch.victims.reduce((n,v)=>n+Math.round((VALUES[v.type]||0)*0.4),0):0)+
      (record.mineDetonated?300+Math.round((VALUES[record.mineDetonated.victim]||0)*.5):0)+
      Math.round(caught*.63)+(record.morph?180:0)+(record.crateCollected?180:0)+
      (record.crateSpawn?40:0)+(record.type==='u'&&record.captured?260:0)+
      (check(next)?240:0)+(check(next)&&legal(next).length===0?1900:0);
    const quality=Math.max(0,Math.min(200,Math.round((record.analysis?.score||0)/2)));
    return Math.max(1,tactical+quality);
  }
  function statusSan(s,m,all,finalState=null) {
    const t=s.board[m.a].toLowerCase(),f=name(m.a),to=name(m.b);
    let notation='';
    if(m.flags.includes('k'))notation='O-O';
    else if(m.flags.includes('q'))notation='O-O-O';
    else {
      if(t!=='p') {
        notation=t==='s'?'🐷':t==='u'?'🃏':t==='t'?'🚀':t==='m'?'💣':t.toUpperCase();
        const others=all.filter(x=>x.a!==m.a && x.b===m.b && s.board[x.a]===s.board[m.a]);
        if(others.length) notation+= !others.some(x=>x.a%10===m.a%10)?f[0]
          :!others.some(x=>Math.floor(x.a/10)===Math.floor(m.a/10))?f.slice(1):f;
      } else if(m.flags.includes('c')||m.flags.includes('e'))notation=f[0];
      if(m.flags.includes('c')||m.flags.includes('e'))notation+='x';
      if(m.flags.includes('M'))notation='💣'+f+'→'+to;
      notation+=to;
      if(m.promotion)notation+='='+m.promotion.toUpperCase();
    }
    const next=finalState||apply(s,m);
    if(check(next))notation+=legal(next).length?'+':'#';
    return notation;
  }
  function positionKey(s) {return s.board.join('')+'|'+s.turn+'|'+s.castle+'|'+(s.ep>=0 && legal(s).some(m=>m.flags.includes('e'))?s.ep:'-')+'|'+JSON.stringify(s.rental)+'|'+JSON.stringify(s.morph)+'|'+JSON.stringify({crate:s.meta.crate,shopClosed:s.meta.shopClosed,shopSide:s.meta.shopSide,mines:s.meta.mines,effects:s.meta.effects});}
  function insufficient(s) {
    if(['w','b'].some(c=>s.rental[c]||s.morph[c]) || s.meta.mines.length)return false;
    const pieces=s.board.map((p,i)=>[p.toLowerCase(),(Math.floor(i/10)+i%10)%2])
      .filter(([p])=>p!=='.' && p!=='k');
    return pieces.length===0 || (pieces.length===1 && ['b','n'].includes(pieces[0][0])) ||
      (pieces.length>0 && pieces.every(([p])=>p==='b') && new Set(pieces.map(([,square])=>square)).size===1);
  }
  function tickEffects(meta, who) {
    meta.effects[who]=meta.effects[who].map(e=>({...e,remaining:e.remaining-1}))
      .filter(e=>e.remaining>0);
  }
  function putCrate(next, random) {
    const candidates=[];
    for(let i=0;i<100;i++)if(next.board[i]==='.')candidates.push(i);
    next.meta.crate=candidates.length?candidates[Math.floor(random()*candidates.length)]:-1;
    return next.meta.crate>=0?name(next.meta.crate):null;
  }
  function rocketSpawnSquare(s,who){
    // Spawn on own baseline, progressing outward into own half if full.
    const order=[5,4,6,3,7,2,8,1,9,0];
    const rows=who==='w'?[9,8,7,6,5]:[0,1,2,3,4];
    for(const row of rows)for(const col of order){
      const square=idx(row,col);
      if(s.board[square]==='.'&&s.meta.crate!==square)return square;
    }
    return -1;
  }
  function spawnRocket(s,who){
    const square=rocketSpawnSquare(s,who);
    if(square<0)return null;
    s.board[square]=who==='w'?'T':'t';
    return name(square);
  }
  function activateCrate(next, who, random, record) {
    // Rare 2% rocket, all previous 10 effects keep their distribution.
    const roll=random();
    if(roll>=0.98){
      const spawn=spawnRocket(next,who);
      if(spawn){
        next.meta.crate=-1;
        record.crateCollected={id:'rocket',label:'Ракета!',recipient:who,kind:'rocket',duration:0,spawn};
        return;
      }
    }
    const effect=EFFECTS[Math.floor(Math.min(0.999999,roll)*EFFECTS.length)];
    const recipient=BUFFS.some(e=>e.id===effect.id)?who:enemy(who);
    const meta=next.meta;
    meta.effects[recipient]=meta.effects[recipient].filter(e=>e.id!==effect.id);
    meta.effects[recipient].push({id:effect.id,remaining:5});
    meta.crate=-1;
    record.crateCollected={id:effect.id,label:effect.label,recipient,
      kind:recipient===who?'buff':'debuff',duration:5};
  }
  function postAction(game,next,who,record,collectedAt=-1) {
    next.meta=cloneMeta(next.meta);
    // Mines lose one charge on each completed move by either player.
    next.meta.mines=next.meta.mines.map(m=>({...m,remaining:m.remaining-1})).filter(m=>m.remaining>0);
    tickEffects(next.meta,who);
    next.meta.ply++;
    if(collectedAt>=0&&next.board[collectedAt]!=='.'&&color(next.board[collectedAt])===who&&next.meta.crate===collectedAt)activateCrate(next,who,()=>game._roll(),record);
    if(next.meta.ply%30===0)record.crateSpawn=putCrate(next,()=>game._roll());
    if(next.meta.ply===50)record.shopOpened=true;
  }
  class Chess10 {
    constructor(fen=START, random=Math.random){
      if(typeof random!=='function')throw Error('Необходим генератор случайных чисел');
      this._random=random;
      this.load(fen);
    }
    load(fen=START) {
      this._s=fromFen(fen);this._moves=[];this._states=[this._s];this._repeats=new Map([[positionKey(this._s),1]]);
    }
    reset(){this.load();}
    fen(){return toFen(this._s);}
    // A redacted, syntactically valid board for a fog-of-war player/spectator.
    // NEVER use this view for move validation: it substitutes a dummy king.
    viewFen(viewer=null) {
      const masked=new Chess10(this.fen());
      const state=masked._s,own=viewer==='w'||viewer==='b'?viewer:null;
      for(let i=0;i<100;i++){
        const p=state.board[i];
        if(p!=='.'&&(!own||color(p)!==own))state.board[i]='.';
      }
      if(own){
        const hidden=enemy(own);
        state.rental[hidden]=null;state.morph[hidden]=null;
        state.castle=state.castle.replace(hidden==='w'?/[KQ]/g:/[kq]/g,'');
        state.ep=-1;
        const order=hidden==='b'?[5,4,6,3,7,2,8,1,9,0]:[95,94,96,93,97,92,98,91,99,90];
        const dummy=[...order,...Array.from({length:100},(_,i)=>i)].find(i=>state.board[i]==='.'&&i!==state.meta.crate);
        if(dummy===undefined)throw Error('Недостаточно места для изображения тумана');
        state.board[dummy]=hidden==='w'?'K':'k';
      } else {
        state.rental={w:null,b:null};state.morph={w:null,b:null};
        const indexes=Array.from({length:100},(_,i)=>i).filter(i=>i!==state.meta.crate);
        state.board[indexes[0]]='K';state.board[indexes[1]]='k';
        state.castle='';state.ep=-1;
      }
      return masked.fen();
    }
    turn(){return this._s.turn;}
    get(square) {const index=xy(square);if(index<0)return null;const p=this._s.board[index];return p==='.'?null:{type:p.toLowerCase(),color:color(p)};}
    morphs() {return Object.fromEntries(['w','b'].map(c=>[c,this._s.morph[c]&&{
      type:this._s.morph[c].type,square:name(this._s.morph[c].square)
    }]));}
    ply(){return this._s.meta.ply;}
    crate(){return this._s.meta.crate>=0?name(this._s.meta.crate):null;}
    effects(){return JSON.parse(JSON.stringify(this._s.meta.effects));}
    shop(){const side=this._s.meta.shopSide||'right';return {open:this.ply()>=50&&!this._s.meta.shopClosed,
      closed:this._s.meta.shopClosed,opensAt:50,side,entrance:side==='left'?'a6':'j6',
      entrances:shopEntrances(side),tile:side==='left'?'←a6':'k6',prices:{...PRICES}};}
    setShopSide(side){
      if(!['left','right'].includes(side)||this.ply()>0)throw Error('Сторону лавки можно выбрать только перед началом партии');
      this._s.meta.shopSide=side;
      this._repeats=new Map([[positionKey(this._s),1]]);
    }
    mines(){return this._s.meta.mines.map(m=>({...m,square:name(m.square)}));}
    threatened(by){const squares=[];for(let i=0;i<100;i++)if(attacked(this._s,i,by))squares.push(name(i));return squares;}
    rentals() {return Object.fromEntries(['w','b'].map(c=>[c,this._s.rental[c]&&{
      type:this._s.rental[c].type,remaining:this._s.rental[c].remaining,
      square:name(this._s.rental[c].square),original:this._s.rental[c].original
    }]));}
    moves({square,verbose}={}) {
      const id=square===undefined?null:xy(square);
      const available=legal(this._s).filter(m=>id===null||id===m.a);
      return available.map(m=> {
        const orig={from:name(m.a),to:name(m.b),color:this._s.turn,type:this._s.board[m.a].toLowerCase(),
          flags:m.flags,promotion:m.promotion,captured:m.flags.includes('e')?'p':this._s.board[m.b]==='.'?null:this._s.board[m.b].toLowerCase(),
          san:statusSan(this._s,m,available)};
        return verbose ? orig : orig.san;
      });
    }
    _record(record,next) {
      this._s=next;this._moves.push(record);this._states.push(next);
      const key=positionKey(this._s);this._repeats.set(key,(this._repeats.get(key)||0)+1);
      return {...record};
    }
    _roll(){
      const value=Number(this._random());
      if(!Number.isFinite(value)||value<0||value>=1)throw Error('Неверный источник случайности');
      return value;
    }
    _commit(move) {
      const all=legal(this._s),m=all.find(m=>name(m.a)===move.from&&name(m.b)===move.to&&(m.promotion||null)===(move.promotion||null));
      if(!m)throw Error('Недопустимый ход');
      const before=this._s;
      const analysis=analyzePly(before,m,all);
      const previous=before.morph[before.turn];
      const record={from:move.from,to:move.to,color:before.turn,type:before.board[m.a].toLowerCase(),
        flags:m.flags,promotion:m.promotion,captured:m.flags.includes('e')?'p':before.board[m.b]==='.'?null:before.board[m.b].toLowerCase()};
      if(m.flags.includes('L'))record.launch={from:name(m.a),to:name(m.b),victims:blastVictims(before,m.b),consumed:true};
      if(m.flags.includes('M'))record.minePlaced={square:move.to,owner:before.turn,duration:7};
      const trap=before.meta.mines.find(x=>x.square===m.b && x.owner!==before.turn);
      if(trap)record.mineDetonated={square:move.to,victim:record.type,owner:trap.owner};
      const next=apply(before,m); // deterministic simulation; never roll in legal() / apply()
      if(previous){
        const endpoint=previous.square===m.a?m.b:previous.square;
        if(color(next.board[endpoint])===before.turn && backRank(endpoint,before.turn))record.morphLocked={type:previous.type,square:name(endpoint),color:before.turn};
        else record.morphExpired={type:previous.type,square:name(previous.square),color:before.turn};
      }
      // 5% probability for every non-promotion pawn move, including double steps
      // and captures. Only actual committed moves roll; online server owns the RNG.
      if(record.type==='p' && !m.promotion && color(next.board[m.b])===before.turn && next.board[m.b].toLowerCase()==='p') {
        if(this._roll()<(hasEffect(before,before.turn,'luck')?0.25:MUTATION_CHANCE)) {
          const available=MUTATION_TYPES.filter(type=>type!=='u' ||
            !next.board.includes(before.turn==='w'?'U':'u'))
            .filter(type=>type!=='m'||!next.board.includes(before.turn==='w'?'M':'m')); 
          const type=available[Math.floor(this._roll()*available.length)];
          next.board[m.b]=before.turn==='w'?type.toUpperCase():type;
          next.morph[before.turn]={type,square:m.b};
          record.morph={type,color:before.turn,square:name(m.b)};
        }
      }
      // Crate effects and location are resolved ONLY on committed server actions.
      postAction(this,next,before.turn,record,m.b);
      record.san=statusSan(before,m,all,next);
      record.analysis=analysis;record.brilliant=analysis.brilliant;
      record.impact=momentScore(record,next);
      return this._record(record,next);
    }
    move({from,to,promotion}={}) {
      if(this.isGameOver() || !/^[a-j](10|[1-9])$/.test(from||'') || !/^[a-j](10|[1-9])$/.test(to||''))throw Error('Недопустимый ход');
      if(this.get(from)?.type==='s')throw Error('Свинья выбирает ход сама');
      return this._commit({from,to,promotion:promotion|| (this.get(from)?.type==='p' && /^(10|1)$/.test(to.slice(1)) ? 'q':null)});
    }
    pig(from,rand=Math.random) {
      if(this.isGameOver() || this.get(from)?.type!=='s' || this.get(from)?.color!==this.turn())throw Error('Нельзя активировать свинью');
      const options=legal(this._s).filter(m=>m.a===xy(from));
      if(!options.length)throw Error('У свиньи сейчас нет допустимых ходов');
      const value=Number(rand());
      if(!Number.isFinite(value) || value<0 || value>=1)throw Error('Неверный источник случайности');
      const choice=options[Math.floor(value*options.length)];
      return this._commit({from,to:name(choice.b)});
    }
    trade({visitor,sacrifice,receive}={}) {
      if(this.isGameOver())throw Error('Партия уже завершена');
      const before=this._s,who=before.turn,meta=before.meta;
      if(meta.ply<50||meta.shopClosed)throw Error('Лавка закрыта (открывается на 50-м полуходе)');
      const visit=xy(visitor),piece=before.board[visit];
      if(!isShopVisitor(visit,meta.shopSide)||color(piece)!==who||!PRICES[piece.toLowerCase()])
        throw Error('К лавке k6 (или к её зеркальному входу) должна подойти своя фигура на соседней клетке (кроме короля)');
      if(!Array.isArray(sacrifice)||sacrifice.length!==3 || new Set(sacrifice).size!==3 ||
        !sacrifice.includes(visitor) || !PRICES[receive])
        throw Error('Выберите ровно 3 фигуры, включая посетителя лавки, и награду');
      const indexes=sacrifice.map(xy);
      const offerings=indexes.map(i=>before.board[i]);
      if(indexes.some(i=>i<0) || offerings.some(p=>color(p)!==who || !PRICES[p.toLowerCase()]))
        throw Error('Нельзя сдавать короля или чужие фигуры');
      // A temporarily evolved pawn is only worth a pawn, never a free queen.
      const value=offerings.reduce((sum,p,i)=>sum+(before.morph[who]?.square===indexes[i]?PRICES.p:PRICES[p.toLowerCase()]),0);
      if(PRICES[receive]>value)throw Error(`Недостаточно ценности: ${value} < ${PRICES[receive]}`);
      if(['u','m'].includes(receive) && before.board.some((p,i)=>p===(who==='w'?receive.toUpperCase():receive) && !indexes.includes(i)))
        throw Error('У вас уже есть UNO-карта');
      const next={...before,board:before.board.slice(),turn:enemy(who),
        full:before.full+(who==='b'?1:0),half:0,ep:-1,
        rental:{w:before.rental.w&&{...before.rental.w},b:before.rental.b&&{...before.rental.b}},
        morph:{w:before.morph.w&&{...before.morph.w},b:before.morph.b&&{...before.morph.b}},
        castle:before.castle,meta:cloneMeta(meta)};
      for(const i of indexes) {
        next.board[i]='.';
        for(const c of ['w','b']) {
          if(next.rental[c]?.square===i)next.rental[c]=null;
          if(next.morph[c]?.square===i)next.morph[c]=null;
        }
        for(const [home,right] of [[idx(9,8),'K'],[idx(9,1),'Q'],[idx(0,8),'k'],[idx(0,1),'q']])
          if(home===i)next.castle=next.castle.replace(right,'');
      }
      let rocketSquare=null;
      if(receive==='t'){
        rocketSquare=spawnRocket(next,who);
        if(!rocketSquare)throw Error('На вашей половине нет свободного места для ракеты');
      }else next.board[visit]=who==='w'?receive.toUpperCase():receive;
      // Remove effects that would expire on this move and then test real king safety.
      advanceRental(next.board,next.rental,who);
      expireMorph(next.board,next.morph,who);
      next.meta.mines=next.meta.mines.filter(m=>!indexes.includes(m.square));
      next.meta.shopClosed=true;
      const record={type:'trade',color:who,from:visitor,to:visitor,san:`🛒 ${sacrifice.join('+')} → ${receive.toUpperCase()}`,
        trade:{visitor,sacrifice:[...sacrifice],receive,value,spawn:rocketSquare},brilliant:false,analysis:null};
      // Validate before consuming RNG for the next scheduled crate.
      if(check(next,who))throw Error('После обмена нельзя оставлять своего короля под шахом');
      postAction(this,next,who,record,-1);
      record.impact=momentScore(record,next);
      return this._record(record,next);
    }
    history({verbose}={}){return verbose?this._moves.map(m=>({...m})):this._moves.map(m=>m.san);}
    highlights(limit=5){
      const selected=this._moves.map((record,index)=>({record,index,impact:record.impact||1}))
        .sort((a,b)=>b.impact-a.impact||a.index-b.index);
      const picks=[];
      for(const separation of [3,1,0])for(const item of selected){
        if(picks.length>=limit)break;
        if(picks.some(x=>x.index===item.index))continue;
        if(picks.some(x=>Math.abs(x.index-item.index)<=separation))continue;
        picks.push(item);
      }
      return picks.slice(0,limit).sort((a,b)=>a.index-b.index).map((item,i)=>({
        number:i+1,index:item.index,score:item.impact,durationMs:3000,
        before:toFen(this._states[item.index]),after:toFen(this._states[item.index+1]),
        record:{...item.record},title:item.record.brilliant?'💎 Бриллиантовый ход':
          item.record.mineDetonated?'💥 Мина сработала':item.record.minePlaced?'💣 Минное поле':item.record.launch?'🚀 Ракетный удар':item.record.trade?'🏪 Сделка у торговца':item.record.crateCollected?'🎁 Сундук открыт':
          item.record.morph?'✨ Волшебное превращение':item.record.captured?'⚔️ Решающее взятие':
          item.record.crateSpawn?'🎁 Появление ящика':'♟️ Важная позиция',
        label:item.record.san
      }));
    }
    isCheck(){return check(this._s);}
    isCheckmate(){return this.isCheck() && legal(this._s).length===0;}
    isStalemate(){return !this.isCheck() && legal(this._s).length===0;}
    isThreefoldRepetition(){return (this._repeats.get(positionKey(this._s))||0)>=3;}
    isInsufficientMaterial(){return insufficient(this._s);}
    isDraw(){return this.isStalemate()||this.isThreefoldRepetition()||this._s.half>=100||this.isInsufficientMaterial();}
    isGameOver(){return this.isCheckmate()||this.isDraw();}
  }
  return {Chess10, START};
});
