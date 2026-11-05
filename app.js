// Rules shared with the server (loaded by index.html).
const { Chess10 } = window;

const $ = (id) => document.getElementById(id);
const FILES = 'abcdefghij';
const PIECE_NAME = { p: 'Пешка', n: 'Конь', b: 'Слон', r: 'Ладья', q: 'Ферзь', k: 'Король', s: 'Свинья', u: 'UNO-карта', t: 'Ракета' };
const PIECE_SYMBOL = { w: '♔', b: '♚' };
const BUFF_INFO={luck:['Золотая удача','Пешки: 25% шанс магии'],sprint:['Спринт','Двойной ход пешки откуда угодно'],knight:['Стальные кони','Кони ходят и на 1 клетку'],rook:['Рывок ладей','Ладьи ходят на 1 по диагонали'],radar:['Радар','Подсветка опасных клеток']};
const DEBUFF_INFO={fog:['Туман войны','Не видно вражеских фигур'],tired:['Тяжёлые сапоги','Пешки не могут ходить на 2'],sleepy:['Сонные кони','Нельзя двигать конями'],queen:['Скованная королева','Ферзь ходит только на 1'],pig:['Тишина в хлеву','Свиньи не активируются']};
const PIECE_COST={p:1,n:3,b:3,r:5,q:9,s:6,u:6,t:12};
const NAME_SUFFIX={w:'белых',b:'чёрных'};
let socket = null;
let mode = 'local';
let role = 'w';
let room = null;
let localGame = new Chess10();
let selected = null;
let promotionOptions = null;
let receivedAt = Date.now();
let toastTimeout = null;
let pigBusy = false;
let pendingOnline = null; // Immediate client-side move projection; server is authoritative.
let onlineCache = {fen:null,game:null};
let muted = localStorage.getItem('chess-duel:muted') === 'yes';
let audio = null;
let drag = null;
let ignoreClickUntil = 0;
let tradeVisitor=null;
let tradeSelected=[];
let replayActive=false;
let replayTimers=[];
let replayAutoKey=null;
let replayScenes=[];
let musicEnabled=localStorage.getItem('chess-duel:music')!=='off';
let musicVolume=Number(localStorage.getItem('chess-duel:music-volume')??22);
if(!Number.isFinite(musicVolume))musicVolume=22;
musicVolume=Math.max(0,Math.min(100,musicVolume));
const bgMusic=new Audio('/audio/background-loop.mp3');
bgMusic.loop=true;
bgMusic.preload='none';
bgMusic.volume=musicVolume/100;
$('musicVolume').value=String(musicVolume);
let musicBlocked=false;

const savedName = localStorage.getItem('chess-duel:name');
if (savedName) $('playerName').value = savedName;
$('playerName').addEventListener('input', () => localStorage.setItem('chess-duel:name', $('playerName').value));

function toast(message) {
  const node = $('toast');
  node.textContent = message;
  node.classList.add('visible');
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => node.classList.remove('visible'), 3500);
}

function game() {
  if(mode==='local')return localGame;
  if(pendingOnline?.preview)return pendingOnline.preview;
  if(!onlineCache.game || onlineCache.fen!==room?.fen){
    onlineCache.fen=room?.fen;
    onlineCache.game=new Chess10(room?.fen);
  }
  return onlineCache.game;
}

function isGameFinished() {
  return mode === 'local' ? localGame.isGameOver() : !!room?.result;
}

function canMove() {
  if (pigBusy || pendingOnline || isGameFinished()) return false;
  if (mode === 'local') return true;
  return !!(room?.ready && room.started && socket?.connected && (role === 'w' || role === 'b') && room.turn === role);
}

function plyCount(){return mode==='local'?localGame.ply():game().ply();}
function musicUpdate() {
  bgMusic.volume=musicVolume/100;
  $('musicBtn').textContent=musicEnabled?'♫ Музыка вкл.':'♪ Музыка выкл.';
  $('musicBtn').setAttribute('aria-pressed',String(musicEnabled));
  if(!musicEnabled || (isGameFinished() && !replayActive) || (plyCount()===0 && !replayActive)) {bgMusic.pause();return;}
  if(bgMusic.paused)bgMusic.play().then(()=>{musicBlocked=false;}).catch(()=>{
    if(!musicBlocked){musicBlocked=true;toast('Браузер заблокировал автозапуск. Нажми «♫ Музыка», чтобы включить её.');}
  });
}
$('musicBtn').addEventListener('click',()=>{
  musicEnabled=!musicEnabled;
  localStorage.setItem('chess-duel:music',musicEnabled?'on':'off');
  musicBlocked=false;
  musicUpdate();
});
$('musicVolume').addEventListener('input',e=>{
  musicVolume=Number(e.target.value);
  localStorage.setItem('chess-duel:music-volume',String(musicVolume));
  bgMusic.volume=musicVolume/100;
});
function fogActive() {
  return mode==='online' ? !!room?.fog :
    game().effects()[game().turn()].some(e=>e.id==='fog');
}
function resetSelection() {
  selected = null;
  promotionOptions = null;
  $('promotionModal').hidden = true;
}

function trySquare(square) {
  if (promotionOptions || !canMove()) return;
  const current = game();
  const piece = current.get(square);
  if (piece?.type === 's' && piece.color === current.turn()) {
    activatePig(square);
    return;
  }
  if (selected) {
    const candidates = (fogActive() && piece?.color!==current.turn()) && mode==='online' ? [{from:selected,to:square,type:current.get(selected)?.type,color:current.turn(),promotion:null}]
      : current.moves({ square: selected, verbose: true }).filter((move) => move.to === square);
    if(fogActive() && current.get(selected)?.type==='p' &&
      (square.endsWith(current.turn()==='w'?'10':'1')))
      return showPromotion(['q','r','b','n'].map(promotion=>({...candidates[0],promotion})));
    if (candidates.length > 1 && candidates.some((move) => move.promotion)) {
      promotionOptions = candidates;
      showPromotion(candidates);
      return;
    }
    if (candidates.length === 1) {
      submitMove(candidates[0]);
      return;
    }
  }
  if (piece?.color === current.turn()) {
    selected = selected === square ? null : square;
  } else {
    selected = null;
  }
  renderBoard();
}


function showPromotion(options) {
  const container = $('promotionChoices');
  container.replaceChildren();
  for (const type of ['q', 'r', 'b', 'n']) {
    const move = options.find((item) => item.promotion === type);
    if (!move) continue;
    const button = document.createElement('button');
    const image = document.createElement('img');
    image.src = `/pieces/${move.color}${type}.svg`;
    image.alt = PIECE_NAME[type];
    button.title = PIECE_NAME[type];
    button.setAttribute('aria-label', `Превратить в: ${PIECE_NAME[type]}`);
    button.append(image);
    button.addEventListener('click', () => submitMove(move));
    container.append(button);
  }
  $('promotionModal').hidden = false;
}

function submitMove(move) {
  const payload = { from: move.from, to: move.to };
  if (move.promotion) payload.promotion = move.promotion;
  resetSelection();
  if (mode === 'local') {
    try {
      const moveMade = localGame.move(payload);
      render();
      presentMove(moveMade);
    } catch (_error) {
      toast('Недопустимый ход.');
    }
    return;
  }
  if (!socket?.connected) return toast('Нет соединения с сервером.');
  // Send first, then render a deterministic visual projection without waiting
  // for a network round trip. No client RNG is ever trusted by the server.
  if(!room?.fog && new Chess10(room.fen).crate()!==payload.to){
    try{
      const projection=new Chess10(room.fen,()=>.97); // Avoid inventing a rare loot event.
      projection.move(payload);
      pendingOnline={preview:projection,ply:room.moves.length,from:payload.from,to:payload.to};
    }catch{pendingOnline={preview:null,ply:room.moves.length};}
  }else pendingOnline={preview:null,ply:room.moves.length};
  // Server validates, commits random events and broadcasts authoritative FEN.
  socket.timeout(5000).emit('game:move',payload,(err,reply)=>{
    if(err||!reply?.ok){
      pendingOnline=null;render();
      toast(reply?.error||'Сервер не подтвердил ход. Позиция восстановлена.');
    }
  });
  renderBoard();
}

function renderRentals() {
  const current=game();
  const rentals=current.rentals();
  const container=$('unoReserveList');
  const fragment=document.createDocumentFragment();
  for(const controller of ['w','b']) {
    const viewer=mode==='online'?role:current.turn();
    const converted=fogActive() && controller!==viewer ? null : rentals[controller];
    const row=document.createElement('div');
    row.className=`uno-reserve-row ${converted?'has-rental':'no-rental'}`;
    const emblem=document.createElement('div');
    emblem.className='uno-reserve-emblem';
    if(converted) {
      const picture=document.createElement('img');
      picture.src=`/pieces/${controller}${converted.type}.svg`;
      picture.alt=PIECE_NAME[converted.type];
      emblem.append(picture);
    } else emblem.textContent='🃏';
    const information=document.createElement('div');
    information.className='uno-reserve-info';
    const who=document.createElement('strong');
    who.textContent=controller==='w'?'Под управлением белых':'Под управлением чёрных';
    const detail=document.createElement('span');
    detail.textContent=converted
      ?`${PIECE_NAME[converted.type]} на ${converted.square} · ещё ${converted.remaining} ход(ов) · потом снова ${converted.original==='w'?'белая':'чёрная'}`
      :'Нет перекрашенных фигур';
    information.append(who,detail);
    row.append(emblem,information);
    fragment.append(row);
  }
  container.replaceChildren(fragment);
}

function renderMorphs() {
  const morphs = game().morphs();
  const container = $('morphActiveList');
  const fragment = document.createDocumentFragment();
  for(const owner of ['w','b']) {
    const viewer=mode==='online'?role:game().turn();
    const item=fogActive() && owner!==viewer ? null : morphs[owner];
    const row=document.createElement('div');
    row.className=`morph-info-row ${item?'morph-live':''}`;
    if(item) {
      const image=document.createElement('img');
      image.src=`/pieces/${owner}${item.type}.svg`;
      image.alt='';
      const text=document.createElement('span');
      text.textContent=`${owner==='w'?'Белая':'Чёрная'} пешка → ${PIECE_NAME[item.type]} на ${item.square} · ещё 1 ход`;
      row.append(image,text);
    } else {
      row.textContent=`${owner==='w'?'Белые':'Чёрные'}: сейчас нет превращения`;
    }
    fragment.append(row);
  }
  container.replaceChildren(fragment);
}

function renderEvents(){
  const current=game(),ply=current.ply(),crate=current.crate(),effects=current.effects(),shop=current.shop();
  const toNext=30-(ply%30);
  $('crateCountdown').textContent=`через ${toNext} ход(ов)`;
  $('crateDescription').textContent=crate?`🎁 Ящик на ${crate}! Собери фигурой: бафф, ослабление или редкая ракета (2%).`:
    `На ${ply+toNext}-м полуходе появится новый ящик на случайной пустой клетке. Ящик не мешает перемещениям.`;
  const list=$('effectsList');list.replaceChildren();
  for(const c of ['w','b'])for(const e of effects[c]){
    const row=document.createElement('div'); row.className='effect-item '+(BUFF_INFO[e.id]?'is-buff':'is-debuff');
    const data=BUFF_INFO[e.id]||DEBUFF_INFO[e.id];
    row.textContent=`${BUFF_INFO[e.id]?'✦':'☁'} ${data[0]} (${NAME_SUFFIX[c]}) · ${e.remaining} ход. — ${data[1]}`;
    list.append(row);
  }
  if(!list.children.length)list.textContent='Активных эффектов пока нет';
  $('shopStatus').textContent=shop.closed?'Сделка завершена':shop.open?'ОТКРЫТА':`до открытия ${50-ply} ход(ов)`;
  const tile=$('shopTile');tile.classList.toggle('open',shop.open);
  tile.classList.toggle('closed',shop.closed);
  tile.classList.toggle('shop-flipped',mode==='online'&&role==='b');
  $('shopTileLabel').textContent=shop.closed?'ПРОДАНО':shop.open?'k6 · ВОЙТИ':'ХОД 50';
  tile.title=shop.closed?'Лавка закрыта после сделки':shop.open?
    'Вход k6: выберите фигуру на j5, j6 или j7 и нажмите лавку (или перетащите её сюда).':'Лавка открывается на 50-м полуходе';
  const visitor=tradeVisitor&&current.get(tradeVisitor);
  const preview=$('shopVisitorArt');
  preview.replaceChildren();
  tile.classList.toggle('has-visitor',!!visitor);
  if(visitor){
    const pic=document.createElement('img');pic.src=`/pieces/${visitor.color}${visitor.type}.svg`;
    pic.alt=`${PIECE_NAME[visitor.type]} вошла в лавку`;
    preview.append(pic);
  }
}
const SHOP_NEAR=['j5','j6','j7'];
function visitorValue(current,square){
  const piece=current.get(square);
  if(!piece)return 0;
  return Object.values(current.morphs()).some(m=>m?.square===square)?1:(PIECE_COST[piece.type]||0);
}
function showShop(entrance){
  if(!canMove())return toast('Сейчас нельзя торговать.');
  const current=game(),shop=current.shop();
  if(!shop.open)return toast(shop.closed?'Торговец уже совершил единственную сделку.':`Лавка откроется через ${50-current.ply()} ход(ов).`);
  const allowed=SHOP_NEAR.filter(square=>current.get(square)?.color===current.turn()&&visitorValue(current,square)>0);
  const visitor=entrance&&allowed.includes(entrance)?entrance:
    selected&&allowed.includes(selected)?selected:allowed.length===1?allowed[0]:null;
  if(!visitor){
    $('shopTile').classList.add('needs-visitor');
    setTimeout(()=>$('shopTile').classList.remove('needs-visitor'),1400);
    return toast(allowed.length>1?'Выбери свою фигуру на j5, j6 или j7, затем нажми лавку k6.':
      'Подведи любую свою фигуру, кроме короля, на j5, j6 или j7.');
  }
  tradeVisitor=visitor;tradeSelected=[];
  selected=null;
  const unit=current.get(visitor),value=visitorValue(current,visitor);
  $('tradeVisitorText').textContent=`В лавку k6 вошла ${PIECE_NAME[unit.type].toLowerCase()} (${visitor}, ${value} очк.). Она автоматически включена в обмен и подсвечена голубым. Выбери ещё две свои фигуры.`;
  const container=$('tradePieces');container.replaceChildren();
  const myColor=current.turn();
  for(const file of FILES)for(let r=1;r<=10;r++){
    const square=`${file}${r}`,p=current.get(square);
    if(!p||p.color!==myColor||p.type==='k'||square===visitor)continue;
    const button=document.createElement('button');button.type='button';button.className='trade-piece';button.dataset.square=square;
    const icon=document.createElement('img');icon.alt='';icon.src=`/pieces/${myColor}${p.type}.svg`;
    const name=document.createElement('span');name.textContent=`${PIECE_NAME[p.type]} ${square} · ${visitorValue(current,square)}`;
    button.append(icon,name);button.onclick=()=>{
      tradeSelected=tradeSelected.includes(square)?tradeSelected.filter(x=>x!==square):
        tradeSelected.length<2?[...tradeSelected,square]:tradeSelected;
      updateTradeOptions();
    };container.append(button);
  }
  updateTradeOptions();
  renderBoard();renderEvents();
  $('tradeModal').hidden=false;
}
function updateTradeOptions(){
  const current=game(),value=visitorValue(current,tradeVisitor)+tradeSelected.reduce((sum,sq)=>sum+visitorValue(current,sq),0);
  for(const button of $('tradePieces').children)button.classList.toggle('chosen',tradeSelected.includes(button.dataset.square));
  const selector=$('tradeReceive'),last=selector.value;
  selector.replaceChildren();
  for(const [type,price] of Object.entries(PIECE_COST)){
    const opt=document.createElement('option');opt.value=type;opt.textContent=`${PIECE_NAME[type]} — ${price} очков`;
    opt.disabled=tradeSelected.length!==2||price>value||
      (type==='u'&&![...Array(100)].every((_,i)=>{
        const sq=FILES[i%10]+(10-Math.floor(i/10));const p=current.get(sq);
        return p?.type!=='u'||p.color!==current.turn()||[tradeVisitor,...tradeSelected].includes(sq);
      }));
    selector.append(opt);
  }
  if([...selector.options].some(x=>x.value===last&&!x.disabled))selector.value=last;
  else selector.selectedIndex=[...selector.options].findIndex(x=>!x.disabled);
  $('tradeValue').textContent=`Предложение: ${value} очков (${tradeSelected.length+1}/3 фигур). Посетитель ${tradeVisitor||'—'} уже учтён! Получить можно только фигуру не дороже ${value}.`;
  $('tradeSubmit').disabled=tradeSelected.length!==2||!selector.value||selector.selectedOptions[0]?.disabled;
}
function commitTrade(){
  if(!tradeVisitor||tradeSelected.length!==2||!$('tradeReceive').value)return;
  const payload={visitor:tradeVisitor,sacrifice:[tradeVisitor,...tradeSelected],receive:$('tradeReceive').value};
  if(mode==='local'){
    try{const move=localGame.trade(payload);$('tradeModal').hidden=true;tradeVisitor=null;render();presentMove(move);}
    catch(e){toast(e.message);}
  }else{
    socket.emit('game:trade',payload,reply=>{
      if(!reply?.ok)toast(reply?.error||'Не удалось обменять фигуры.');
      else {$('tradeModal').hidden=true;tradeVisitor=null;renderBoard();renderEvents();}
    });
  }
}
$('shopTile').addEventListener('click',()=>showShop());
$('tradeCancel').addEventListener('click',()=>{$('tradeModal').hidden=true;tradeVisitor=null;renderBoard();renderEvents();});
$('tradeReceive').addEventListener('change',updateTradeOptions);
$('tradeSubmit').addEventListener('click',commitTrade);
const catalog=$('effectCatalog');
for(const [kind,group] of [['✦ УСИЛЕНИЯ',BUFF_INFO],['☁ ПОМЕХИ',DEBUFF_INFO]]){
  const strong=document.createElement('strong');strong.textContent=kind;catalog.append(strong);
  for(const [id,[label,description]] of Object.entries(group)){
    const text=document.createElement('div');text.textContent=`${label}: ${description} (5 ходов)`;catalog.append(text);
  }
}

function renderBoard() {
  if (mode === 'online' && !room) return;
  const current = game();
  const board = $('board');
  const useExisting = board.children.length === 100 && board.dataset.flip === String(mode === 'online' && role === 'b');
  const reversed = mode === 'online' && role === 'b';
  const last = mode === 'local'
    ? localGame.history({ verbose: true }).at(-1)
    : room?.moves?.at(-1);
  const legalMoves = selected && canMove() && !fogActive() ? current.moves({ square: selected, verbose: true }) : [];
  const fog=fogActive();
  const viewerColor=mode==='online'?role:current.turn();
  const radarSide=mode==='online'?role:current.turn();
  const danger=new Set(!fog && ['w','b'].includes(radarSide) && current.effects()[radarSide].some(e=>e.id==='radar')
    ?current.threatened(radarSide==='w'?'b':'w'):[]);
  const crateSquare=current.crate();
  const rentalPositions = current.rentals();
  const morphPositions = current.morphs();
  const targetSquares = new Set(legalMoves.map((move) => move.to));
  const fragment = document.createDocumentFragment();

  for (let row = 0; row < 10; row++) {
    for (let col = 0; col < 10; col++) {
      const file = reversed ? FILES[9 - col] : FILES[col];
      const rank = reversed ? row + 1 : 10 - row;
      const square = `${file}${rank}`;
      const piece = current.get(square);
      const light = (FILES.indexOf(file) + rank) % 2 === 0;
      const button = useExisting ? board.children[row*10+col] : document.createElement('button');
      if(useExisting){
        // Reuse the 100 existing square elements instead of recreating the
        // entire grid each click/network update; preserve the piece image when
        // it has not changed to avoid flicker and needless image decode.
        for(const child of [...button.children])if(!child.classList.contains('square-label')){
          if(child.tagName!=='IMG' || child.classList.contains('crate-art'))child.remove();
        }
      }
      button.type = 'button';
      button.className = `square ${light ? 'light' : 'dark'}`;
      button.setAttribute('role', 'gridcell');
      button.dataset.square = square;
      button.setAttribute('aria-label', `${square}, ${fog && piece?.color!==viewerColor ? 'скрыто туманом' : piece ? `${PIECE_NAME[piece.type]} (${piece.color === 'w' ? 'белые' : 'чёрные'})` : 'пусто'}`);
      if (!fog && last && (square === last.from || square === last.to)) button.classList.add('last-move');
      if(!fog&&last?.brilliant&&(square===last.from||square===last.to))button.classList.add('brilliant-square');
      if(square===tradeVisitor)button.classList.add('shop-visitor-square');
      if(SHOP_NEAR.includes(square)&&current.shop().open&&piece?.color===current.turn())button.classList.add('shop-adjacent');
      if(danger.has(square))button.classList.add('radar-danger');
      if(fog)button.classList.add('fog-square');
      if (square === selected) button.classList.add('selected');
      if (piece?.type === 'k' && piece.color === current.turn() && (mode==='online'?room.check:current.isCheck())) button.classList.add('check', 'king-shake');
      if (piece?.type === 'u' && !(fog && piece.color!==viewerColor)) {
        button.classList.add('uno-square');
        button.title = '🃏 Один шаг вперёд: прямо или по диагонали. При ударе фигура меняет цвет на 5 ходов.';
      }
      const evolved = ['w','b'].find((side)=>morphPositions[side]?.square===square);
      if (evolved && !(fog && piece?.color!==viewerColor)) {
        button.classList.add('morph-square');
        button.title = `✨ Пешка стала: ${PIECE_NAME[morphPositions[evolved].type]}! Один ход до возврата в пешку.`;
      }
      const borrowing = ['w','b'].find((side)=>rentalPositions[side]?.square===square);
      if (borrowing && !(fog && piece?.color!==viewerColor)) {
        button.classList.add('rental-square');
        button.title=`Перекрашена UNO-картой · осталось ходов: ${rentalPositions[borrowing].remaining}`;
      }
      if(piece?.type==='t' && !(fog && piece.color!==viewerColor)){
        button.classList.add('rocket-square');
        button.title='🚀 Соседняя клетка — обычный ход. На 3 клетки прямо вперёд — взлёт и взрыв 8 соседних клеток!';
      }
      if (piece?.type === 's' && !(fog && piece.color!==viewerColor)) {
        button.classList.add('pig-square');
        button.title = '🐷 Хрю! Нажми — свинья сама сделает случайный ход';
      }
      if (targetSquares.has(square)){
        const rocketTarget=legalMoves.some(m=>m.to===square && m.flags.includes('L'));
        button.classList.add(rocketTarget?'rocket-target':piece?'can-capture':'can-move');
      }
      if(crateSquare===square){
        button.classList.add('crate-square');
        const crate=document.createElement('img');crate.className='crate-art';crate.src='/items/chest.svg';crate.alt='';
        crate.setAttribute('aria-label','Ящик с сюрпризом');button.append(crate);
      }
      const hidePiece=fog && piece && piece.color!==viewerColor;
      if(hidePiece){button.title='Фигуры противника скрыты туманом';}
      const imageSrc=piece&&!hidePiece?`/pieces/${piece.color}${piece.type}.svg`:null;
      const retained=button.querySelector(':scope > img:not(.crate-art)');
      if(retained && retained.getAttribute('src')!==imageSrc)retained.remove();
      if(imageSrc && (!retained||!retained.isConnected)){
        const img=document.createElement('img');img.src=imageSrc;img.alt='';img.draggable=false;
        button.append(img);
      }
      if (evolved && !(fog && piece?.color!==viewerColor)) {
        const shimmer=document.createElement('span');
        shimmer.className='morph-counter';
        shimmer.textContent='✦';
        shimmer.setAttribute('aria-label','Временно превращённая пешка');
        button.append(shimmer);
      }
      if (borrowing && !(fog && piece?.color!==viewerColor)) {
        const counter=document.createElement('span');
        counter.className='rental-counter';
        counter.textContent=String(rentalPositions[borrowing].remaining);
        counter.setAttribute('aria-label','Осталось ходов');
        button.append(counter);
      }
      if (col === 0 && !useExisting) {
        const label = document.createElement('span');
        label.className = 'square-label rank';
        label.textContent = rank;
        button.append(label);
      }
      if (row === 9 && !useExisting) {
        const label = document.createElement('span');
        label.className = 'square-label file';
        label.textContent = file;
        button.append(label);
      }
      // A delegated click listener also handles taps after drag-and-drop.
      if(!useExisting)fragment.append(button);
    }
  }
  if(!useExisting)board.replaceChildren(fragment);
  board.dataset.flip=String(reversed);
  $('orientationLabel').textContent = reversed ? 'Чёрные снизу' : 'Белые снизу';
}

function formatClock(time) {
  const seconds = Math.max(0, Math.ceil(time / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

function updateClocks() {
  const bottom = mode === 'online' && role === 'b' ? 'b' : 'w';
  const top = bottom === 'w' ? 'b' : 'w';
  for (const [color, element] of [[bottom, $('bottomClock')], [top, $('topClock')]]) {
    element.classList.remove('active-clock', 'low-time');
    if (mode === 'local') {
      element.textContent = '—:—';
      continue;
    }
    const running = !!(room?.ready && room?.started && !room?.result && socket?.connected && room?.turn === color);
    const value = (room?.clock?.[color] ?? 600000) - (running ? Date.now() - receivedAt : 0);
    element.textContent = formatClock(value);
    if (running) element.classList.add(value < 30000 ? 'low-time' : 'active-clock');
  }
}

function renderPlayers() {
  const bottom = mode === 'online' && role === 'b' ? 'b' : 'w';
  const top = bottom === 'w' ? 'b' : 'w';
  const colors = { top, bottom };
  for (const [place, color] of Object.entries(colors)) {
    const upper = place === 'top' ? 'top' : 'bottom';
    const name = mode === 'local' ? (color === 'w' ? 'Белые фигуры' : 'Чёрные фигуры')
      : room?.players?.[color]?.name || 'Ожидание игрока';
    const player = room?.players?.[color];
    $(upper + 'PlayerName').textContent = name;
    $(upper + 'PlayerStatus').textContent = mode === 'local'
      ? (localGame.turn() === color ? 'Сейчас ходят' : 'Ожидают хода')
      : (!player ? 'Место свободно' : !player.online ? 'Не в сети'
        : role === color ? 'Это вы' : 'В сети');
    const avatar = $(upper + 'Avatar');
    avatar.textContent = PIECE_SYMBOL[color];
    avatar.className = `avatar ${color === 'w' ? 'light-avatar' : 'dark-avatar'}`;
  }
  updateClocks();
}

function statusInfo() {
  if (mode === 'online') {
    if (!socket?.connected) return ['СОЕДИНЕНИЕ ПОТЕРЯНО', 'Нет связи с сервером', 'Переподключение произойдёт автоматически.', 'waiting'];
    if (room.result) {
      const result = room.result;
      const subject = result.winner ? `${result.winner === 'w' ? 'Белые' : 'Чёрные'} победили` : 'Ничья';
      return ['ПАРТИЯ ОКОНЧЕНА', subject, result.reason, 'finished'];
    }
    if (!room.started) return ['ЖДЁМ СОПЕРНИКА', 'Комната создана', 'Отправьте другу ссылку или код приглашения.', 'waiting'];
    if (!room.ready) return ['ПАРТИЯ НА ПАУЗЕ', 'Игрок отключился', 'Матч продолжится после переподключения.', 'waiting'];
    const offeredBy = room.drawOffer;
    const msg = offeredBy && offeredBy !== role ? 'Соперник предлагает ничью. Вы можете принять её.'
      : offeredBy === role ? 'Предложение ничьей отправлено сопернику.' : 'Время идёт. Продумайте следующий ход.';
    return ['ОНЛАЙН · ПАРТИЯ ИДЁТ', `${room.turn === 'w' ? 'Ход белых' : 'Ход чёрных'}${room.check ? ' · шах!' : ''}`, msg, 'playing'];
  }
  if (localGame.isGameOver()) {
    const desc = localGame.isCheckmate() ? 'Мат — ' + (localGame.turn() === 'w' ? 'чёрные' : 'белые') + ' победили.'
      : localGame.isStalemate() ? 'Пат — ничья.' : 'Партия завершилась вничью.';
    return ['ПАРТИЯ ОКОНЧЕНА', localGame.isCheckmate() ? 'Шах и мат!' : 'Ничья', desc, 'finished'];
  }
  return ['ЛОКАЛЬНАЯ ИГРА', `Ход ${localGame.turn() === 'w' ? 'белых' : 'чёрных'}${localGame.isCheck() ? ' · шах!' : ''}`,
    '✨ При ходе пешки есть 5% шанс на волшебное превращение на один ход! 🐷 ходит случайно, а 🃏 перекрашивает противника.', 'playing'];
}

function renderMoves() {
  const moves = mode === 'local' ? localGame.history({ verbose: true }) : (room?.moves || []);
  $('moveCounter').textContent = `${moves.length} ${moves.length === 1 ? 'ХОД' : 'ХОДОВ'}`;
  const container = $('movesArea');
  if (!moves.length) {
    container.innerHTML = '<div class="empty-moves"><span>♙</span><p>Здесь появятся ходы<br>вашей партии</p></div>';
    return;
  }
  const fragment = document.createDocumentFragment();
  for (let i = 0; i < moves.length; i += 2) {
    const row = document.createElement('div');
    row.className = 'move-row';
    const number = document.createElement('span');
    number.className = 'move-number';
    number.textContent = `${i / 2 + 1}.`;
    row.append(number);
    for (const move of [moves[i], moves[i + 1]]) {
      const san = document.createElement('span');
      san.className = 'move-san';
      if (move) {
        san.textContent = `${move.brilliant?'💎 ':''}${move.san}`;
        if(move.brilliant){san.classList.add('brilliant-move');san.title='Лучший ход по двухполуходной оценке позиции';}
        if (move === moves.at(-1)) san.classList.add('recent');
      }
      row.append(san);
    }
    fragment.append(row);
  }
  container.replaceChildren(fragment);
  container.scrollTop = container.scrollHeight;
}

function render() {
  if (mode === 'online' && !room) return;
  $('localBtn').classList.toggle('active', mode === 'local');
  $('createBtn').classList.toggle('active', mode === 'online');
  $('connectionLabel').textContent = mode === 'local' ? 'Локальная игра'
    : socket?.connected ? `Онлайн · ${role === 'spectator' ? 'наблюдатель' : 'подключено'}` : 'Нет соединения';
  $('gameModeLabel').textContent = mode === 'local' ? 'ЛОКАЛЬНАЯ ПАРТИЯ' : `ОНЛАЙН · КОМНАТА ${room.code}`;
  $('roomPill').innerHTML = mode === 'local' ? '10×10 <span>·</span> без часов' : '10×10 <span>·</span> 10 минут';
  $('inviteBlock').hidden = mode !== 'online';
  if (room) $('activeRoomCode').textContent = room.code;
  const [tag, title, description, phase] = statusInfo();
  $('statusTag').textContent = tag;
  $('statusText').textContent = title;
  $('statusDescription').textContent = description;
  $('statusSymbol').textContent = phase === 'finished' ? '♛' : phase === 'waiting' ? '◷' : '◉';
  $('statusCard').className = `status-card ${phase === 'playing' ? '' : phase}`;
  const onlinePlayer = mode === 'online' && role !== 'spectator';
  const gameOver = isGameFinished();
  $('drawBtn').hidden = !onlinePlayer || gameOver;
  $('resignBtn').hidden = !onlinePlayer || gameOver;
  $('drawBtn').disabled = !room?.ready || room?.drawOffer === role;
  $('drawBtn').querySelector('span').textContent = room?.drawOffer && room.drawOffer !== role ? 'Принять ничью'
    : room?.drawOffer === role ? 'Ожидаем ответ' : 'Предложить ничью';
  $('rematchBtn').hidden = !onlinePlayer || !gameOver;
  $('rematchBtn').disabled = !room?.ready || room?.rematch?.includes(role);
  $('rematchBtn').querySelector('span').textContent = room?.rematch?.includes(role) ? 'Ждём реванш' : 'Реванш';
  $('resetBtn').hidden = mode !== 'local';
  const highlights=mode==='local'?localGame.highlights(5):room?.highlights;
  $('watchReplayBtn').hidden=!(gameOver&&highlights?.length);
  scheduleReplay(gameOver,highlights);
  renderPlayers();
  renderBoard();
  renderMoves();
  renderRentals();
  renderMorphs();
  renderEvents();
  musicUpdate();
}

function setRoom(reply) {
  if (!reply?.ok) return toast(reply?.error || 'Ошибка соединения с комнатой.');
  mode = 'online';
  role = reply.color;
  closeReplay();replayAutoKey=null;
  room = reply.state;
  pendingOnline=null;onlineCache.fen=null;onlineCache.game=null;
  pigBusy = false;
  receivedAt = Date.now();
  if (reply.token) localStorage.setItem(`chess-duel:seat:${reply.code}`, reply.token);
  const url = new URL(location.href);
  url.searchParams.set('room', reply.code);
  history.replaceState(null, '', url);
  resetSelection();
  render();
  if (role === 'spectator') toast('Комната полная — вы подключены как зритель.');
  else toast(`Вы подключились: ${role === 'w' ? 'белые' : 'чёрные'}.`);
}

function startLocal() {
  mode = 'local';
  role = 'w';
  room = null;
  localGame = new Chess10();
  pendingOnline=null;onlineCache.fen=null;onlineCache.game=null;
  closeReplay();replayAutoKey=null;bgMusic.pause();bgMusic.currentTime=0;
  pigBusy = false;
  resetSelection();
  if (socket?.connected) socket.disconnect();
  const url = new URL(location.href);
  url.searchParams.delete('room');
  history.replaceState(null, '', url);
  render();
  toast('Новая локальная партия начата.');
}

function ensureConnected() {
  if (!socket) {
    toast('Не удалось загрузить онлайн-модуль. Проверьте соединение.');
    return false;
  }
  if (!socket.connected) socket.connect();
  return true;
}

function createRoom() {
  if (!ensureConnected()) return;
  socket.timeout(9000).emit('room:create', { name: $('playerName').value }, (error, reply) => {
    if (error) return toast('Сервер не отвечает. Попробуйте снова.');
    setRoom(reply);
  });
}

function joinRoom(code, silent = false) {
  if (!/^[A-Z2-9]{6}$/.test(code)) {
    if (!silent) toast('Введите шестизначный код комнаты.');
    return;
  }
  if (!ensureConnected()) return;
  socket.timeout(9000).emit('room:join', {
    code, name: $('playerName').value, token: localStorage.getItem(`chess-duel:seat:${code}`)
  }, (error, reply) => {
    if (error) return toast('Не удалось подключиться к серверу.');
    if (silent && reply?.ok) {
      mode = 'online'; role = reply.color; room = reply.state; receivedAt = Date.now();
      if (reply.token) localStorage.setItem(`chess-duel:seat:${reply.code}`, reply.token);
      resetSelection(); render();
    } else setRoom(reply);
  });
}

function askConfirm(title, message, action) {
  $('confirmTitle').textContent = title;
  $('confirmMessage').textContent = message;
  $('confirmModal').hidden = false;
  $('confirmAccept').onclick = () => {
    $('confirmModal').hidden = true;
    action();
  };
}

function sendAction(event) {
  if (!socket?.connected) return toast('Нет связи с сервером.');
  socket.emit(event, {}, (reply) => {
    if (!reply?.ok) toast(reply?.error || 'Не удалось выполнить действие.');
  });
}

async function copyText(text, successMessage) {
  try {
    await navigator.clipboard.writeText(text);
    toast(successMessage);
  } catch (_error) {
    toast('Копирование заблокировано браузером. Выделите код комнаты вручную.');
  }
}

function audioContext() {
  if (muted) return null;
  try {
    if (!audio) audio = new (window.AudioContext || window.webkitAudioContext)();
    if (audio.state === 'suspended') audio.resume().catch(() => {});
    return audio;
  } catch (_error) { return null; }
}

function tone(ctx, when, frequency, ending, duration, wave, volume) {
  const oscillator = ctx.createOscillator();
  const gain = ctx.createGain();
  oscillator.type = wave;
  oscillator.frequency.setValueAtTime(frequency, when);
  oscillator.frequency.exponentialRampToValueAtTime(Math.max(1, ending), when + duration);
  gain.gain.setValueAtTime(0.0001, when);
  gain.gain.exponentialRampToValueAtTime(volume, when + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, when + duration);
  oscillator.connect(gain).connect(ctx.destination);
  oscillator.start(when);
  oscillator.stop(when + duration + 0.02);
}

function playSound(type) {
  const ctx = audioContext();
  if (!ctx) return;
  const now = ctx.currentTime + 0.015;
  if(type==='rocket'){
    tone(ctx,now,85,380,.59,'sawtooth',.18);
    tone(ctx,now+.13,140,840,.54,'triangle',.14);
    tone(ctx,now+.58,120,48,.43,'sawtooth',.14);
    tone(ctx,now+.65,320,85,.33,'triangle',.17);
  } else if (type==='crate'){
    tone(ctx,now,380,760,.18,'triangle',.11);
    tone(ctx,now+.12,540,1180,.25,'sine',.13);
    tone(ctx,now+.26,850,1550,.36,'triangle',.10);
  } else if(type==='trade'){
    tone(ctx,now,390,470,.23,'sine',.13);
    tone(ctx,now+.16,600,840,.32,'triangle',.12);
    tone(ctx,now+.28,820,1040,.35,'sine',.12);
  } else if(type==='brilliant'){
    // A distinct cyan 7-note fanfare that stands out over the background music.
    tone(ctx,now,196,392,.24,'sawtooth',.07);
    const melody=[784,988,1175,1568,1976,2350,3136];
    for(let i=0;i<melody.length;i++){
      tone(ctx,now+.075+i*.084,melody[i]*.74,melody[i],.24,'triangle',.15-i*.012);
      tone(ctx,now+.1+i*.084,melody[i]*1.02,melody[i]*1.09,.16,'sine',.068);
    }
  } else if (type === 'pig') {
    // Two low, quivering vocalizations — synthesized locally, no sound files.
    tone(ctx, now, 220, 105, 0.18, 'sawtooth', 0.12);
    tone(ctx, now + 0.17, 170, 90, 0.2, 'triangle', 0.18);
    tone(ctx, now + 0.18, 360, 180, 0.15, 'square', 0.032);
  } else if (type === 'capture') {
    tone(ctx, now, 280, 76, 0.19, 'triangle', 0.12);
    tone(ctx, now + 0.045, 110, 65, 0.13, 'square', 0.045);
  } else if (type === 'uno') {
    tone(ctx, now, 730, 400, 0.13, 'square', 0.055);
    tone(ctx, now + 0.11, 430, 680, 0.22, 'sine', 0.11);
    tone(ctx, now + 0.25, 850, 300, 0.21, 'triangle', 0.06);
  } else if (type === 'morph') {
    // Layered rising magic fanfare, synthesized with Web Audio.
    tone(ctx, now, 132, 58, 0.44, 'sawtooth', 0.065);
    tone(ctx, now + .02, 330, 660, 0.28, 'triangle', 0.10);
    tone(ctx, now + .13, 494, 988, 0.34, 'sine', 0.13);
    tone(ctx, now + .26, 659, 1320, 0.42, 'sine', 0.12);
    tone(ctx, now + .34, 880, 1760, 0.51, 'triangle', 0.07);
    tone(ctx, now + .49, 1245, 1860, 0.42, 'sine', 0.06);
  } else if (type === 'demorph') {
    tone(ctx, now, 750, 290, .24, 'triangle', .085);
    tone(ctx, now + .08, 440, 180, .2, 'sine', .065);
  } else if (type === 'check') {
    tone(ctx, now, 500, 460, 0.15, 'sine', 0.11);
    tone(ctx, now + 0.13, 670, 540, 0.21, 'triangle', 0.1);
  } else {
    tone(ctx, now, 380, 250, 0.09, 'sine', 0.075);
    tone(ctx, now + 0.065, 270, 185, 0.085, 'triangle', 0.045);
  }
}

function updateSoundButton() {
  const button = $('soundBtn');
  button.textContent = muted ? '🔇 Звук выключен' : '🔊 Звук включён';
  button.setAttribute('aria-pressed', String(!muted));
}

function boardSquare(square) {
  return [...$('board').children].find((node) => node.dataset.square === square);
}

function floatingSymbol(text, square) {
  const cell = boardSquare(square);
  if (!cell) return;
  const rect = cell.getBoundingClientRect();
  const note = document.createElement('span');
  note.className = 'floating-sound';
  note.textContent = text;
  note.style.left = `${rect.left + rect.width / 2}px`;
  note.style.top = `${rect.top - 4}px`;
  document.body.append(note);
  setTimeout(() => note.remove(), 950);
}

function captureEffect(record) {
  if (!record.captured) return;
  const victimSquare = record.flags?.includes('e') ? record.to[0] + record.from.slice(1) : record.to;
  const cell = boardSquare(victimSquare);
  if (!cell) return;
  const rect = cell.getBoundingClientRect();
  const ghost = document.createElement('img');
  ghost.className = 'captured-ghost';
  ghost.alt = '';
  ghost.src = `/pieces/${record.color === 'w' ? 'b' : 'w'}${record.captured}.svg`;
  ghost.style.left = `${rect.left + rect.width * 0.08}px`;
  ghost.style.top = `${rect.top + rect.height * 0.08}px`;
  ghost.style.width = `${rect.width * 0.84}px`;
  ghost.style.height = `${rect.height * 0.84}px`;
  document.body.append(ghost);
  setTimeout(() => ghost.remove(), 640);
  for (let i = 0; i < 7; i++) {
    const particle = document.createElement('span');
    particle.className = 'capture-spark';
    particle.style.left = `${rect.left + rect.width/2}px`;
    particle.style.top = `${rect.top + rect.height/2}px`;
    const angle = (i / 7) * Math.PI * 2;
    particle.style.setProperty('--spark-x', `${Math.cos(angle) * rect.width * 0.67}px`);
    particle.style.setProperty('--spark-y', `${Math.sin(angle) * rect.height * 0.67}px`);
    document.body.append(particle);
    setTimeout(() => particle.remove(), 590);
  }
}

function morphEffect(morph) {
  const cell=boardSquare(morph.square);
  if(!cell)return;
  const reduced=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const rect=cell.getBoundingClientRect();
  playSound('morph');
  floatingSymbol(`✨ 5%! ${PIECE_NAME[morph.type].toUpperCase()}!`,morph.square);
  cell.classList.add('morph-burst');
  setTimeout(()=>cell.classList.remove('morph-burst'),1050);
  if(reduced)return;
  const ring=document.createElement('span');
  ring.className='morph-shockwave';
  ring.style.left=`${rect.left+rect.width/2}px`;
  ring.style.top=`${rect.top+rect.height/2}px`;
  ring.style.width=`${rect.width}px`;
  ring.style.height=`${rect.height}px`;
  document.body.append(ring);
  setTimeout(()=>ring.remove(),820);
  for(let i=0;i<24;i++) {
    const particle=document.createElement('span');
    particle.className='morph-particle';
    const angle=(i/24)*Math.PI*2;
    const radius=rect.width*(0.65+(i%4)*0.19);
    particle.style.left=`${rect.left+rect.width/2}px`;
    particle.style.top=`${rect.top+rect.height/2}px`;
    particle.style.setProperty('--mx',`${Math.cos(angle)*radius}px`);
    particle.style.setProperty('--my',`${Math.sin(angle)*radius}px`);
    particle.style.setProperty('--rot',`${i*33}deg`);
    particle.style.animationDelay=`${(i%5)*29}ms`;
    document.body.append(particle);
    setTimeout(()=>particle.remove(),1100);
  }
}

function brilliantEffect(record){
  const cell=boardSquare(record.to);
  if(!cell)return;
  cell.classList.add('brilliant-burst');
  playSound('brilliant');
  floatingSymbol('💎 БРИЛЛИАНТОВЫЙ ХОД!',record.to);
  toast(`💎 ${record.san} — редкий выдающийся ход (анализ 3 полуходов, позиционная оценка).`);
  setTimeout(()=>cell.classList.remove('brilliant-burst'),1550);
  if(window.matchMedia('(prefers-reduced-motion: reduce)').matches)return;
  const rect=cell.getBoundingClientRect();
  for(let i=0;i<22;i++){
    const sparkle=document.createElement('span');sparkle.className='diamond-particle';
    sparkle.style.left=`${rect.left+rect.width/2}px`;
    sparkle.style.top=`${rect.top+rect.height/2}px`;
    const a=i*Math.PI*2/22,rad=rect.width*(.7+i%4*.16);
    sparkle.style.setProperty('--mx',`${Math.cos(a)*rad}px`);
    sparkle.style.setProperty('--my',`${Math.sin(a)*rad}px`);
    document.body.append(sparkle);
    setTimeout(()=>sparkle.remove(),1100);
  }
}

function presentMove(record) {
  if (!record) return;
  if(record.trade){
    playSound(record.trade.receive==='t'?'rocket':'trade');
    if(record.trade.receive==='t'){
      toast(`🚀 Ракета куплена за 12 очков! Появилась на ${record.trade.spawn}.`);
      floatingSymbol('🚀 НОВАЯ РАКЕТА!',record.trade.spawn);
    }
    floatingSymbol('🏪 СДЕЛКА ЗАКЛЮЧЕНА!',record.trade.visitor);
    boardSquare(record.trade.visitor)?.classList.add('trade-flash');
    setTimeout(()=>boardSquare(record.trade.visitor)?.classList.remove('trade-flash'),1100);
    musicUpdate();return;
  }
  if(record.crateSpawn){setTimeout(()=>{
    playSound('crate');floatingSymbol('🎁 СЮРПРИЗ!',record.crateSpawn);
    boardSquare(record.crateSpawn)?.classList.add('crate-arrive');
  },180);}
  if(record.crateCollected){
    playSound(record.crateCollected.kind==='rocket'?'rocket':'crate');
    if(record.crateCollected.kind==='rocket'){
      toast(`🚀 Редкая находка! Ракета появилась на ${record.crateCollected.spawn}.`);
      floatingSymbol('🚀 РАКЕТА ИЗ ЯЩИКА!',record.crateCollected.spawn);
    }floatingSymbol(`🎁 ${record.crateCollected.label.toUpperCase()}!`,record.to);
    boardSquare(record.to)?.classList.add('crate-arrive');
    if(record.crateCollected.kind!=='rocket')toast(`🎁 ${record.crateCollected.label}: ${record.crateCollected.kind==='buff'?'усиление':'помеха'} на 5 ходов!`);
  }
  if(record.shopOpened)toast('🏪 Лавка k6 открыта! Приведите любую фигуру на j5, j6 или j7.');
  if(record.launch){
    // Zooming rocket followed by a ring of light and 8-cell blast.
    playSound('rocket');
    const toCell=boardSquare(record.to);
    toCell?.classList.add('rocket-impact');
    setTimeout(()=>toCell?.classList.remove('rocket-impact'),950);
    floatingSymbol(`🚀 ВЗРЫВ! ${record.launch.victims.length} фигур`,record.to);
    for(const victim of record.launch.victims){
      const cell=boardSquare(victim.square);
      cell?.classList.add('rocket-burn');
      setTimeout(()=>cell?.classList.remove('rocket-burn'),900);
    }
  }
  if(record.brilliant)setTimeout(()=>brilliantEffect(record),180);
  musicUpdate();
  const from = boardSquare(record.from);
  const to = boardSquare(record.to);
  if (!from || !to) return;
  const r1 = from.getBoundingClientRect();
  const r2 = to.getBoundingClientRect();
  const targetPiece = to.querySelector('img');
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const check = mode==='online'?room.check:game().isCheck();
  const unoEffect=record.type==='u' && record.captured && record.captured!=='u';
  if (record.captured && !unoEffect) captureEffect(record);
  if(!record.launch)playSound(unoEffect?'uno':record.captured ? 'capture' : 'move');
  if (record.morph) setTimeout(()=>morphEffect(record.morph),310);
  else if (record.morphExpired) {
    const square=record.from===record.morphExpired.square?record.to:record.morphExpired.square;
    setTimeout(()=>{
      playSound('demorph');
      floatingSymbol('✧ Снова пешка',square);
      boardSquare(square)?.classList.add('morph-return');
      setTimeout(()=>boardSquare(square)?.classList.remove('morph-return'),520);
    },260);
  }
  if(unoEffect) {
    floatingSymbol('↪ СМЕНА ЦВЕТА · 5 ХОДОВ',record.to);
    to.classList.add('conversion-flash');
    setTimeout(()=>to.classList.remove('conversion-flash'),950);
  }
  if (check) setTimeout(() => playSound('check'), 150);
  if (reduced) return;

  const flight = document.createElement('img');
  flight.className = 'flight-piece';
  flight.alt = '';
  flight.src = `/pieces/${record.color}${record.type}.svg`;
  flight.style.left = `${r1.left + r1.width*.08}px`;
  flight.style.top = `${r1.top + r1.height*.08}px`;
  flight.style.width = `${r1.width*.84}px`;
  flight.style.height = `${r1.height*.84}px`;
  const dx = r2.left - r1.left, dy = r2.top - r1.top;
  if (targetPiece) targetPiece.classList.add('hidden-while-moving');
  document.body.append(flight);
  const pig = record.type === 's';
  const unoEffectActive = record.type === 'u' && record.captured && record.captured !== 'u';
  const frames = pig ? [
    { transform: 'translate(0,0) rotate(-7deg) scale(1)' },
    { transform: `translate(${dx*.24}px,${dy*.24-18}px) rotate(9deg) scale(1.15)`, offset: .25 },
    { transform: `translate(${dx*.52}px,${dy*.52}px) rotate(-8deg) scale(1.03)`, offset: .52 },
    { transform: `translate(${dx*.78}px,${dy*.78-14}px) rotate(7deg) scale(1.12)`, offset: .78 },
    { transform: `translate(${dx}px,${dy}px) rotate(0deg) scale(1)` }
  ] : record.launch ? [
    {transform:'translate(0,0) scale(.85) rotate(0deg)',filter:'drop-shadow(0 0 2px #fff)'},
    {transform:`translate(${dx*.5}px,${dy*.5}px) scale(1.72) rotate(-8deg)`,filter:'drop-shadow(0 0 18px #ff8b24)',offset:.52},
    {transform:`translate(${dx}px,${dy}px) scale(.9) rotate(0deg)`,filter:'drop-shadow(0 0 40px #fff)'}
  ] : [
    {transform:'translate(0,0) scale(1)'},
    {transform:`translate(${dx*.52}px,${dy*.52-12}px) scale(1.09)`,offset:.52},
    {transform:`translate(${dx}px,${dy}px) scale(1)`}
  ];
  if(unoEffectActive)frames[frames.length-1].transform += ' rotate(16deg) scale(.01)';
  const animation = flight.animate(frames, {duration:record.launch?760:pig?690:unoEffectActive?480:250, easing:'ease-in-out',fill:'forwards'});
  const cleanup = () => {
    flight.remove();
    if (targetPiece) targetPiece.classList.remove('hidden-while-moving');
  };
  animation.addEventListener('finish', cleanup, {once:true});
  animation.addEventListener('cancel', cleanup, {once:true});
}

function activatePig(square) {
  if (!canMove() || game().get(square)?.type !== 's' || game().get(square)?.color !== game().turn()) return;
  // Prevent multiple clicks while the pig is preparing its surprise move.
  pigBusy = true;
  resetSelection();
  renderBoard();
  boardSquare(square)?.classList.add('oinking');
  playSound('pig');
  floatingSymbol('ХРЮ! 🐷', square);
  setTimeout(() => {
    if (mode === 'local') {
      try {
        const move = localGame.pig(square, () => {
          const random = new Uint32Array(1);
          if (window.crypto?.getRandomValues) return window.crypto.getRandomValues(random)[0] / 2**32;
          return Math.random();
        });
        pigBusy = false;
        render();
        presentMove(move);
      } catch (error) { pigBusy=false; render(); toast(error.message); }
    } else if (socket?.connected && room?.turn === role && room?.ready && !room?.result) {
      // The client never sends a destination: the server chooses it securely.
      socket.emit('game:pig', {from:square}, (reply) => {
        if (!reply?.ok) { pigBusy=false; render(); toast(reply?.error || 'Свинья не может пойти.'); }
      });
    } else { pigBusy=false; render(); }
  }, 270);
}

// Pointer Events make the same interaction work for mouse, touchscreen and stylus.
function dragCleanup() {
  if (drag?.ghost) drag.ghost.remove();
  if (drag?.hover) drag.hover.classList.remove('drag-over');
  drag=null;
  $('board').classList.remove('dragging-board');
}
$('board').addEventListener('pointerdown', (event) => {
  if (event.button !== 0 || promotionOptions || !canMove()) return;
  const button = event.target.closest('.square');
  if (!button) return;
  const source = button.dataset.square;
  const piece = game().get(source);
  if (piece && piece.color === game().turn() && (piece.type !== 's' || (game().shop().open && SHOP_NEAR.includes(source)))) {
    drag={id:event.pointerId,from:source,piece,startX:event.clientX,startY:event.clientY,
      active:false,ghost:null,hover:null};
  }
});
document.addEventListener('pointermove', (event) => {
  if (!drag || drag.id !== event.pointerId) return;
  if (!drag.active && Math.hypot(event.clientX-drag.startX,event.clientY-drag.startY)<7) return;
  if (!drag.active) {
    drag.active=true;
    selected=drag.from;
    renderBoard();
    drag.ghost=document.createElement('img');
    drag.ghost.className='drag-ghost';
    drag.ghost.src=`/pieces/${drag.piece.color}${drag.piece.type}.svg`;
    drag.ghost.alt='';
    document.body.append(drag.ghost);
    $('board').classList.add('dragging-board');
  }
  event.preventDefault();
  const width=boardSquare(drag.from)?.getBoundingClientRect().width||60;
  drag.ghost.style.width=`${width*1.12}px`;
  drag.ghost.style.height=`${width*1.12}px`;
  drag.ghost.style.left=`${event.clientX-width*.56}px`;
  drag.ghost.style.top=`${event.clientY-width*.56}px`;
  const hover=document.elementFromPoint(event.clientX,event.clientY)?.closest('.square');
  if (drag.hover !== hover) {
    drag.hover?.classList.remove('drag-over');
    drag.hover=hover;
    hover?.classList.add('drag-over');
  }
}, {passive:false});
document.addEventListener('pointerup', (event) => {
  if (!drag || drag.id!==event.pointerId) return;
  const wasActive=drag.active;
  const start=drag.from;
  const dropped=wasActive?document.elementFromPoint(event.clientX,event.clientY):null;
  const inShop=!!dropped?.closest('#shopTile');
  const target=wasActive?dropped?.closest('.square')?.dataset.square:null;
  dragCleanup();
  if (wasActive) {
    ignoreClickUntil=Date.now()+240;
    selected=start;
    if(inShop)showShop(start);
    else if (target && target!==start) trySquare(target);
    else renderBoard();
  }
});
document.addEventListener('pointercancel', dragCleanup);
$('board').addEventListener('click', (event) => {
  if (Date.now()<ignoreClickUntil) return;
  const button=event.target.closest('.square');
  if (button) trySquare(button.dataset.square);
});
$('soundBtn').addEventListener('click', () => {
  muted=!muted;
  localStorage.setItem('chess-duel:muted',muted?'yes':'no');
  updateSoundButton();
  if (!muted) playSound('move');
});
updateSoundButton();

$('localBtn').addEventListener('click', startLocal);
$('resetBtn').addEventListener('click', startLocal);
$('createBtn').addEventListener('click', createRoom);
$('promoCreateBtn').addEventListener('click', createRoom);
$('joinBtn').addEventListener('click', () => joinRoom($('roomCode').value.trim().toUpperCase()));
$('roomCode').addEventListener('keydown', (event) => {
  if (event.key === 'Enter') joinRoom($('roomCode').value.trim().toUpperCase());
});
$('copyCodeBtn').addEventListener('click', () => room && copyText(room.code, 'Код комнаты скопирован.'));
$('copyLinkBtn').addEventListener('click', () => {
  if (!room) return;
  const url = new URL(location.origin);
  url.searchParams.set('room', room.code);
  copyText(url.toString(), 'Ссылка на матч скопирована.');
});
$('cancelPromotion').addEventListener('click', () => { resetSelection(); renderBoard(); });
$('confirmCancel').addEventListener('click', () => { $('confirmModal').hidden = true; });
$('resignBtn').addEventListener('click', () => askConfirm('Сдаться в партии?', 'Сопернику будет засчитана победа. Отменить это действие невозможно.', () => sendAction('game:resign')));
$('drawBtn').addEventListener('click', () => sendAction('game:draw'));
$('rematchBtn').addEventListener('click', () => sendAction('game:rematch'));

if (typeof window.io === 'function') {
  socket = window.io({ autoConnect: false, reconnection: true, transports: ['websocket','polling'], tryAllTransports: true, reconnectionDelay: 250, reconnectionDelayMax: 1500 });
  const initialRoom = new URLSearchParams(location.search).get('room')?.trim().toUpperCase();
  socket.on('connect', () => {
    const roomFromUrl = new URLSearchParams(location.search).get('room')?.trim().toUpperCase();
    if (mode === 'online' && room?.code) joinRoom(room.code, true);
    else if (roomFromUrl && /^[A-Z2-9]{6}$/.test(roomFromUrl)) joinRoom(roomFromUrl, true);
  });
  socket.on('disconnect', () => { if (mode === 'online') render(); });
  socket.on('room:state', (updated) => {
    if (mode === 'online' && room?.code === updated.code) {
      const previous = room;
      if(previous?.result&&!updated.result){closeReplay();replayAutoKey=null;}
      room = updated;
      if(pendingOnline && (updated.moves.length>pendingOnline.ply||updated.result))pendingOnline=null;
      onlineCache.fen=null;onlineCache.game=null;
      receivedAt = Date.now();
      pigBusy = false;
      render();
      if (updated.moves.length === previous.moves.length + 1) presentMove(updated.moves.at(-1));
    }
  });
  socket.on('room:replaced', () => {
    role = 'spectator';
    if (mode === 'online') render();
    toast('Ваше место в комнате занято другим подключением.');
  });
  if (initialRoom) socket.connect();
}


// ── POST-GAME HIGHLIGHTS: five 3-second cinematic clips ──
function replayTimer(action,delay){replayTimers.push(setTimeout(action,delay));}
function stopReplayTimers(){for(const id of replayTimers)clearTimeout(id);replayTimers=[];}
function closeReplay(){
  stopReplayTimers();
  replayActive=false;
  $('replayModal').hidden=true;
  musicUpdate();
}
function scheduleReplay(gameOver,highlights){
  if(!gameOver||!highlights?.length||replayActive)return;
  const key=`${mode}:${mode==='online'?room?.code:'local'}:${game().ply()}:${(mode==='online'?room?.moves:localGame.history()).length}`;
  if(replayAutoKey===key)return;
  replayAutoKey=key;
  // The match results are visible first; then the best moments play automatically.
  replayTimer(()=>{
    if(isGameFinished()&&!replayActive)startReplay();
  },1450);
}
function replayDraw(fen,record=null,after=false){
  const board=$('replayBoard'),state=new Chess10(fen);
  const fragment=document.createDocumentFragment();
  for(let rank=10;rank>=1;rank--)for(const file of FILES){
    const square=`${file}${rank}`,piece=state.get(square);
    const el=document.createElement('div');el.className=`replay-cell ${(FILES.indexOf(file)+rank)%2===0?'light':'dark'}`;
    el.dataset.square=square;
    if(record?.brilliant&&(square===record.from||square===record.to))el.classList.add('replay-diamond');
    if(after&&square===record?.to)el.classList.add('replay-landed');
    if(after&&record?.launch?.victims.some(v=>v.square===square))el.classList.add('replay-blast');
    const crate=state.crate();
    if(crate===square){const gift=document.createElement('img');gift.src='/items/chest.svg';gift.className='replay-crate';gift.alt='';el.append(gift);}
    if(piece){const image=document.createElement('img');image.src=`/pieces/${piece.color}${piece.type}.svg`;image.alt='';el.append(image);}
    fragment.append(el);
  }
  board.replaceChildren(fragment);
}
function replayFly(moment){
  if(!replayActive)return;
  const rec=moment.record;
  const from=$('replayBoard').querySelector(`[data-square="${rec.from}"]`);
  const to=$('replayBoard').querySelector(`[data-square="${rec.to}"]`);
  if(!from||!to)return;
  const sourceImg=from.querySelector('img:not(.replay-crate)');
  if(!sourceImg)return;
  const first=from.getBoundingClientRect(),last=to.getBoundingClientRect();
  const ghost=document.createElement('img');
  ghost.className='replay-flight';ghost.src=sourceImg.src;ghost.alt='';
  ghost.style.left=`${first.left}px`;ghost.style.top=`${first.top}px`;
  ghost.style.width=`${first.width}px`;ghost.style.height=`${first.height}px`;
  document.body.append(ghost);
  sourceImg.style.opacity='.12';
  const travel=ghost.animate([
    {transform:'translate(0,0) scale(1)',opacity:1},
    {transform:`translate(${(last.left-first.left)*.5}px,${(last.top-first.top)*.5-(rec.launch?38:12)}px) scale(${rec.launch?1.6:1.22})`,opacity:1,offset:.55},
    {transform:`translate(${last.left-first.left}px,${last.top-first.top}px) scale(${rec.type==='u'&&rec.captured?.12:1})`,opacity:1}
  ],{duration:1240,easing:'cubic-bezier(.22,.61,.25,1)',fill:'forwards'});
  const cleanup=()=>ghost.remove();travel.onfinish=cleanup;travel.oncancel=cleanup;
  replayTimer(cleanup,1500);
}
function replayClip(index){
  if(!replayActive)return;
  if(index>=replayScenes.length){
    $('replaySubtitle').textContent=`Все ${replayScenes.length} лучших моментов просмотрены`;
    $('replayCounter').textContent='★ ФИНАЛ';
    $('replayCaption').textContent='Повтори кинематографическую нарезку или закрой окно.';
    $('replayProgress').style.animation='none';
    $('replayPlayAgain').hidden=false;
    replayActive=false;
    musicUpdate();
    return;
  }
  const moment=replayScenes[index],record=moment.record;
  const scene=$('replayScene');scene.classList.remove('replay-entrance');
  void scene.offsetWidth;scene.classList.add('replay-entrance');
  replayDraw(moment.before,record,false);
  $('replayTitle').textContent=moment.title;
  $('replayCounter').textContent=`МОМЕНТ ${index+1}/${replayScenes.length}`;
  $('replaySubtitle').textContent=`Ход ${moment.index+1} · ${moment.label} · ценность ${moment.score}`;
  $('replayCaption').textContent=record.brilliant?'💎 Лучший найденный вариант!':'Замедление ×0.25 · настоящий момент партии';
  const progress=$('replayProgress');progress.style.animation='none';void progress.offsetWidth;
  progress.style.animation='replay-progress 3s linear forwards';
  replayTimer(()=>{
    if(!replayActive)return;
    replayFly(moment);
    if(record.brilliant)playSound('brilliant');
    else if(record.launch)playSound('rocket');
    else if(record.captured)playSound('capture');
    else if(record.trade)playSound('trade');
    else if(record.crateCollected)playSound('crate');
    else playSound('move');
  },820);
  replayTimer(()=>{
    if(!replayActive)return;
    replayDraw(moment.after,record,true);
    $('replayCaption').textContent=record.brilliant?'💎 ХОД БРИЛЛИАНТОВЫЙ!':
      record.launch?'🚀 РАКЕТНЫЙ ВЗРЫВ!':record.captured?'⚔️ ВЗЯТИЕ!':record.crateCollected?'🎁 СЮРПРИЗ!':record.trade?'🏪 ОБМЕН!': '✦ ХОД ЗАВЕРШЁН';
  },2190);
  replayTimer(()=>replayClip(index+1),3000);
}
function startReplay(){
  const moments=mode==='online'?room?.highlights:localGame.highlights(5);
  if(!isGameFinished()||!moments?.length)return toast('Реплей доступен после окончания партии.');
  stopReplayTimers();
  replayScenes=moments;
  replayActive=true;
  $('replayModal').hidden=false;
  $('replayPlayAgain').hidden=true;
  musicUpdate();
  replayClip(0);
}
$('watchReplayBtn').addEventListener('click',startReplay);
$('replayClose').addEventListener('click',closeReplay);
$('replayPlayAgain').addEventListener('click',startReplay);

setInterval(updateClocks, 250);
render();
