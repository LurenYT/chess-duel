/* Flat SVG piece set. Run: node tools/build-piece-icons.cjs */
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const base='<path d="M28 75h44l7 10H21z"/>';
const art={
 p:'<circle cx="50" cy="27" r="12"/><path d="M41 40h18l3 21 9 14H29l9-14z"/>'+base,
 n:'<path d="M28 75l8-23-14-7 9-13 12-16 15 6 13 18-2 35z"/><path d="M43 19l-2-9 13 9M54 36l8 12v15" fill="none"/><circle cx="38" cy="34" r="2" fill="var(--ink)" stroke="none"/>'+base,
 b:'<path d="M50 11Q26 30 35 47l8 5-6 15-8 8h42l-8-8-6-15 8-5Q74 30 50 11z"/><path d="M57 23L44 39" fill="none"/>'+base,
 r:'<path d="M27 16h12v12h8V16h8v12h8V16h12v24l-11 7v20l8 8H28l8-8V47l-9-7z"/>'+base,
 q:'<path d="M25 26l9 32h32l9-32-17 14-8-23-8 23zM35 58h30l-3 9 10 8H28l10-8z"/><circle cx="25" cy="23" r="4"/><circle cx="50" cy="14" r="4"/><circle cx="75" cy="23" r="4"/>'+base,
 k:'<path d="M50 10v22M40 20h20" fill="none" stroke-width="5"/><path d="M35 36h30l-7 18 5 13 9 8H28l9-8 5-13z"/>'+base,
 s:'<path d="M29 32l-6-18 21 10h12l21-10-6 18q9 11 7 26-3 21-28 21T22 58q-2-15 7-26z"/><rect x="33" y="48" width="34" height="21" rx="10"/><path d="M42 57v3m16-3v3M34 39h1m30 0h1" fill="none" stroke-width="4"/>',
 u:'<rect x="24" y="13" width="52" height="74" rx="8"/><path d="M35 40h30l-9-9m9 29H35l9 9" fill="none" stroke-width="4"/>',
 t:'<path d="M50 10Q30 27 34 58h32Q70 27 50 10zM34 45L23 62v13l15-9m28-21 11 17v13L62 66"/><circle cx="50" cy="34" r="7"/><path d="M43 66l7 21 7-21"/>',
 m:'<path d="M25 43q0-27 25-27t25 27H25zM20 44h60v9H20zM31 57h38v18H31z"/><path d="M50 10v16M40 66h20m-10-8v16" fill="none"/>'+base,
 h:'<path d="M29 47l6-32 15 12 15-12 6 32-13 13 5 7 9 8H28l9-8 5-7z"/><path d="M50 33v19m-8-11h16" fill="none"/>'+base,
 c:'<path d="M24 18h13v12h9V18h8v12h9V18h13v27L63 55v12l9 8H28l9-8V55L24 45z"/><path d="M42 41l8-5 9 9-8 11" fill="none"/>'+base,
 l:'<path d="M24 75V53q0-16 12-16 7 0 10 10 4-17 15-13l2-18 12-6 8 10-9 7-1 36-7 12H54l-3-16-8 1-7 15z"/><path d="M68 18h1" fill="none" stroke-width="4"/>'+base,
 g:'<path d="M50 12l28 12v27q-3 23-28 36Q25 74 22 51V24z"/><path d="M50 33v30M35 48h30" fill="none" stroke-width="5"/>',
 a:'<path d="M29 61l-7 18h57L62 61z"/><path d="M23 36l48-20 8 17-48 20z"/><circle cx="45" cy="64" r="14"/><circle cx="45" cy="64" r="4"/>',
 d:'<circle cx="50" cy="50" r="35"/><circle cx="50" cy="50" r="25" fill="none"/>',
 v:'<circle cx="50" cy="50" r="35"/><path d="M30 40l7 22h26l7-22-13 10-7-18-7 18z"/>'
};
for(const [color,fill,ink] of [['w','#f8f4e8','#252b28'],['b','#252b28','#f8f4e8']]){
 for(const [type,shape] of Object.entries(art)){
  const svg=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" role="img" aria-label="${color}${type}" style="--ink:${ink}"><g fill="${fill}" stroke="${ink}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">${shape}</g></svg>\n`;
  for(const dir of ['public/pieces','pieces']){
   fs.mkdirSync(path.join(root,dir),{recursive:true});fs.writeFileSync(path.join(root,dir,color+type+'.svg'),svg);
  }
 }
}
const labels={p:'Пешка',n:'Конь',b:'Слон',r:'Ладья',q:'Ферзь',k:'Король',s:'Свинья',u:'UNO',t:'Ракета',m:'Минёр',h:'Архиепископ',c:'Канцлер',l:'Верблюд',g:'Страж',a:'Пушка'};
fs.writeFileSync(path.join(root,'public/pieces.html'),`<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Фигуры CHESS DUEL</title><style>*{box-sizing:border-box}body{margin:0;padding:40px max(20px,5vw);background:#202522;color:#f8f4e8;font:16px system-ui}a{color:#bed58e}h1{font-size:clamp(28px,5vw,48px);margin-bottom:10px}p{color:#c5cfc2;line-height:1.6}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(175px,1fr));gap:14px;margin-top:28px}article{background:#2c332e;padding:18px;border-radius:12px;border:1px solid #485343}h2{font-size:16px;font-weight:500;margin:14px 0 0}.pair{display:grid;grid-template-columns:1fr 1fr;border-radius:7px;overflow:hidden}.pair img{width:100%;padding:5px;background:#e8edce}.pair img+img{background:#7d985b}.new{font-size:11px;color:#c4dc91;letter-spacing:.12em;margin:10px 0 -4px}footer{margin-top:30px;color:#aab6a7}</style><a href="/">← К игре</a><h1>Один стиль. Пятнадцать фигур.</h1><p>Чистые силуэты, две краски. Пять новых тактических ролей для доски 10×10.</p><div class="grid">${Object.entries(labels).map(([t,label])=>`<article><div class="pair"><img src="/pieces/w${t}.svg" alt="Белый ${label}"><img src="/pieces/b${t}.svg" alt="Чёрный ${label}"></div>${'hclga'.includes(t)?'<div class="new">НОВАЯ ФИГУРА</div>':''}<h2>${label}</h2></article>`).join('')}</div><footer>CHESS DUEL · MINIMAL PIECE SET</footer></html>`);
console.log('Generated 34 minimal icons and piece gallery.');
