import {navalScreen} from './battleship.js';
const tg = window.Telegram?.WebApp;
const el = id => document.getElementById(id);
const labels = {chess:'Шахматы',draughts:'Русские шашки',tictactoe:'Крестики-нолики',battleship:'Морской бой'};
const symbols = {k:'♚',q:'♛',r:'♜',b:'♝',n:'♞',p:'♟'};
const names = {k:'король',q:'ферзь',r:'ладья',b:'слон',n:'конь',p:'пешка'};
const roomId = /^[a-f0-9]{24}$/;
let state, selected, busy = false, choice = [];
let last, review, clockReceived, setupGame, continueId, computerTimer, puzzleHint, hintLevel = 0;
const trainingTotal = 3;
let trainingProgress = {};
let connectionLost = false, pendingMove, drag, boardTouch, suppressBoardClick = false;
const reasons = {mate:'Мат',blocked:'Нет шашек или ходов',three:'Три знака в ряд',resign:'Сдача',timeout:'Время вышло',
  agreement:'По согласию',rules:'По правилам игры'};

async function api(path,body) {
  let response;
  try {
    response = await fetch('/api/rooms'+path,{
    method:body === undefined ? 'GET' : 'POST',
    headers:{'X-Telegram-Init-Data':tg.initData,'Content-Type':'application/json'},
    body:body === undefined ? undefined : JSON.stringify(body),
    signal:AbortSignal.timeout(10000)
  });
  } catch {
    throw Object.assign(new Error('Связь с сервером потеряна'),{network:true});
  }
  if ([502,503,504].includes(response.status)) {
    throw Object.assign(new Error('Сервер временно недоступен'),{network:true});
  }
  const data = await response.json();
  if (!response.ok) throw Object.assign(new Error(data.error),{status:response.status});
  return data;
}

function connectionStatus(message = '',kind = '') {
  const banner = el('connection-status');
  banner.hidden = !message;
  banner.dataset.kind = kind;
  if (banner.textContent !== message) banner.textContent = message;
}
function lostConnection() {
  connectionLost = true;
  connectionStatus('Связь потеряна. Восстанавливаем…','offline');
}
function restoreConnection(next) {
  if (!connectionLost) return;
  connectionLost = false;
  const move = pendingMove;
  pendingMove = undefined;
  if (!move || next.version > move.version) {
    connectionStatus(move ? 'Связь восстановлена. Позиция обновлена.' : '');
  } else {
    connectionStatus('Ход не отправлен. Сделайте его ещё раз.','offline');
  }
}
window.addEventListener('offline',() => {
  if (state && !state.task && !state.training && !state.result) lostConnection();
});
window.addEventListener('online',() => { void refreshMatch(); });

function lobby() {
  el('naval-game').hidden=true;
  naval?.stop();
  finishDrag();
  connectionLost = false;
  pendingMove = undefined;
  connectionStatus();
  clearTimeout(computerTimer);
  state = selected = review = undefined;
  el('extras').hidden = false;
  el('room-list').replaceChildren();
  choice = [];
  el('title').textContent = 'Доска';
  el('status').textContent = 'Выберите игру';
  el('game').hidden = true;
  el('lobby').hidden = false;
  el('settings').hidden = false;
  menuTab('play-tab');
  continueId = undefined;
  el('resume').hidden = true;
  if (tg?.initData) void refreshContinue();
}

const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const boardSide = () => state.training === 'local' ? 'w' : state.side;
const cell = index => el('board').children[state.game !== 'tictactoe' && boardSide() === 'b' ? 63-index : index];

const moveSound = el('move-sound');
const moveVibration = el('move-vibration');
for (const control of [moveSound,moveVibration]) {
  control.checked = true;
  try { control.checked = localStorage.getItem(control.id) !== 'off'; } catch {}
  control.addEventListener('change',() => {
    try { localStorage.setItem(control.id,control.checked ? 'on' : 'off'); } catch {}
  });
}
let moveAudio;
function unlockMoveAudio() {
  if (!moveSound.checked) return;
  try {
    const Context = window.AudioContext ?? window.webkitAudioContext;
    if (!Context) return;
    moveAudio ??= new Context();
    if (moveAudio.state !== 'running') void moveAudio.resume().catch(() => {});
  } catch {}
}
document.addEventListener('pointerdown',unlockMoveAudio,{passive:true});
document.addEventListener('keydown',unlockMoveAudio);
document.addEventListener('click',event => {
  if (event.target.closest('button') && !event.target.closest('#board')) ceramicSound('button');
});
moveSound.addEventListener('change',unlockMoveAudio);

function ceramicSound(kind) {
  if (!moveSound.checked || moveAudio?.state !== 'running' || document.hidden || tg?.isActive === false) return;
  const notes = {
    x:[[980,0,.075,.075],[2330,.002,.025,.045]],
    o:[[620,0,.085,.095],[1470,.003,.025,.065]],
    line:[[1046,0,.025,.12],[1318,.07,.025,.13],[1568,.14,.025,.14]],
    win:[[523,0,.035,.4],[659,.06,.03,.38],[784,.12,.03,.36]],
    loss:[[440,0,.035,.22],[349,.18,.03,.28]],
    draw:[[420,0,.012,.16],[610,.08,.014,.16],[820,.16,.012,.18],[580,.25,.008,.14]],
    button:[[900,0,.012,.035]]
  }[kind];
  for (const [frequency,offset,volume,duration] of notes) {
    const tone = moveAudio.createOscillator();
    const gain = moveAudio.createGain();
    const start = moveAudio.currentTime+offset;
    tone.type = 'sine';
    tone.frequency.setValueAtTime(frequency,start);
    gain.gain.setValueAtTime(.0001,start);
    gain.gain.exponentialRampToValueAtTime(volume,start+.003);
    gain.gain.exponentialRampToValueAtTime(.0001,start+duration);
    tone.connect(gain).connect(moveAudio.destination);
    tone.onended = () => { tone.disconnect(); gain.disconnect(); };
    tone.start(start);
    tone.stop(start+duration+.01);
  }
}

function woodSound(kind,game,king = false) {
  if (!moveSound.checked || moveAudio?.state !== 'running' || document.hidden || tg?.isActive === false) return;
  const deep = game === 'chess' ? .8 : king ? .86 : 1;
  const patterns = {
    move:[[330*deep,0,.065,.07]],
    capture:[[260*deep,0,.07,.065],[420*deep,.05,.045,.065]],
    castle:[[300,0,.055,.07],[360,.1,.045,.07]],
    huff:[[280,0,.035,.12],[180,.05,.025,.1]],
    crown:[[659,.09,.025,.18],[880,.18,.02,.22]],
    check:[[550,.08,.02,.16]],
    win:[[392,0,.025,.4],[494,.07,.022,.35],[587,.14,.02,.35]],
    loss:[[330,0,.025,.22],[262,.18,.022,.28]],
    draw:[[300,0,.035,.065],[300,.14,.03,.065]],
    time:[[660,0,.018,.12]]
  }[kind];
  for (const [frequency,offset,volume,duration] of patterns) {
    const start = moveAudio.currentTime+offset;
    const tone = moveAudio.createOscillator(), gain = moveAudio.createGain();
    tone.type = ['move','capture','castle','huff','draw'].includes(kind) ? 'triangle' : 'sine';
    tone.frequency.setValueAtTime(frequency,start);
    tone.frequency.exponentialRampToValueAtTime(frequency*.72,start+duration);
    gain.gain.setValueAtTime(.0001,start);
    gain.gain.exponentialRampToValueAtTime(volume,start+.002);
    gain.gain.exponentialRampToValueAtTime(.0001,start+duration);
    tone.connect(gain).connect(moveAudio.destination);
    tone.onended = () => { tone.disconnect(); gain.disconnect(); };
    tone.start(start); tone.stop(start+duration+.01);
  }
}

function moveEffects(before,move,after) {
  const piece = before.board[move.from];
  if (!piece) return {};
  const capture = move.from === move.to || before.board.some((old,i) => old && old[0] !== piece[0] &&
    !before.taken?.includes(i) && (after.board[i] !== old || after.taken?.includes(i)));
  const crowned = before.game === 'draughts' && move.from !== move.to &&
    piece[1] === 'p' && after.board[move.to] === piece[0]+'k';
  const castle = before.game === 'chess' && piece[1] === 'k' && Math.abs(move.to-move.from) === 2;
  return {capture,crowned,castle,game:before.game,king:piece[1] === 'k',
    huff:before.game === 'draughts' && move.from === move.to,
    promoted:Boolean(move.promotion),check:before.game === 'chess' && after.check && !after.result};
}
function playMoveEffects({capture,crowned,placement,game,king,castle,huff,promoted,check}) {
  if (document.hidden || tg?.isActive === false) return;
  if (!placement) {
    woodSound(huff ? 'huff' : castle ? 'castle' : capture ? 'capture' : 'move',game,king);
    if (crowned || promoted) woodSound('crown',game);
    if (check) woodSound('check',game);
  }  if ((crowned || placement) && moveVibration.checked) {
    try {
      if (placement && tg?.HapticFeedback?.impactOccurred && tg.isVersionAtLeast?.('6.1') !== false) {
        tg.HapticFeedback.impactOccurred('light');
      } else if (crowned && tg?.HapticFeedback?.notificationOccurred && tg.isVersionAtLeast?.('6.1') !== false) {
        tg.HapticFeedback.notificationOccurred('success');
      } else {
        navigator.vibrate?.(placement ? 12 : 35);
      }
    } catch {}
  }
}

async function animateMove(move, capture) {
  const piece = state.board[move.from];
  const source = cell(move.from);
  if (move.from === move.to || !piece || !source || typeof source.animate !== 'function') return;
  const draughts = state.game === 'draughts';
  const lines = [[move.from,move.to]];
  const castle = !draughts && piece[1] === 'k' && Math.abs(move.from-move.to) === 2;
  if (castle) {
    const kingSide = move.to > move.from;
    lines.push([kingSide ? move.from+3 : move.from-4, kingSide ? move.from+1 : move.from-1]);
  }
  const jump = draughts && capture;
  const overlays = [];
  try {
    const animations = lines.map(([from,to]) => {
      const start = cell(from);
      const a = start.getBoundingClientRect();
      const b = cell(to).getBoundingClientRect();
      const image = document.createElement('span');
      image.className = 'moving-piece'+(state.board[from][0] === 'w' ? ' white' : '');
      if (draughts) image.append(start.firstElementChild.cloneNode(true));
      else {
        image.classList.add('chess-piece');
        image.textContent = start.textContent;
      }
      Object.assign(image.style,{left:a.left+'px',top:a.top+'px',width:a.width+'px',height:a.height+'px'});
      image.setAttribute('aria-hidden','true');
      document.body.append(image);
      start.classList.add('moving-source');
      overlays.push([image,start]);
      const dx = b.left-a.left;
      const dy = b.top-a.top;
      const frames = [{transform:'translate(0,0)'}];
      if (jump) frames.push({transform:'translate('+dx/2+'px,'+(dy/2-a.height*.22)+'px) scale(1.18)'});
      frames.push({transform:'translate('+dx+'px,'+dy+'px)'});
      return image.animate(frames,{duration:jump ? 220 : 160,easing:'ease-in-out',fill:'forwards'}).finished;
    });
    await Promise.all(animations);
  } finally {
    for (const [image,start] of overlays) {
      image.remove();
      start.classList.remove('moving-source');
    }
  }
}

const colorName = (side,game = state.game) => game === 'tictactoe'
  ? (side === 'w' ? 'Крестики' : 'Нолики') : (side === 'w' ? 'Белые' : 'Чёрные');
function resultLabel(match) {
  if (match.game === 'battleship' && match.training === 'local') return (match.result === 'w' ? 'Первый' : 'Второй')+' игрок победил';
  if (match.result === 'draw') return 'Ничья';
  if (match.training === 'local') return 'Победили '+colorName(match.result,match.game).toLowerCase();
  return match.result === match.side ? 'Вы победили!' : 'Вы проиграли';
}
function presentMatchResult(next) {
  const sheet = el('match-result');
  const outcome = next.result === 'draw' ? 'draw' : next.training === 'local' || next.result === next.side ? 'win' : 'loss';
  const reason = el('match-result-reason');
  sheet.dataset.outcome = outcome;
  if (next.game !== 'tictactoe') woodSound(outcome,next.game);
  if (next.game === 'tictactoe' && outcome !== 'draw') ceramicSound(outcome);
  sheet.classList.toggle('tic-result',next.game === 'tictactoe');
  sheet.returnValue = '';
  el('match-result-title').textContent = resultLabel(next);
  reason.textContent = reasons[next.reason] ?? '';
  reason.hidden = !reason.textContent;
  if (!sheet.open) sheet.showModal();
}
el('match-result').onclose = () => {
  if (el('match-result').returnValue === 'menu') lobby();
};

async function animateTicTacToe(next,placed,finished) {
  if (placed) {
    ceramicSound(next.board[next.lastMove.to] === 'w' ? 'x' : 'o');
    playMoveEffects({placement:true});
    const mark = cell(next.lastMove.to)?.firstElementChild;
    if (mark && !reducedMotion.matches) {
      await mark.animate([
        {transform:'translateY(-14%) scale(1.14)',opacity:0},
        {transform:'scale(.91)',opacity:1,filter:'brightness(1.4)',offset:.65},
        {transform:'scale(1)',opacity:1}
      ],{duration:150,easing:'ease-out'}).finished;
    }
  }
  if (!finished || document.hidden || state !== next) return;
  ceramicSound(next.result === 'draw' ? 'draw' : 'line');
  if (reducedMotion.matches) return;
  const board = el('board');
  const effect = document.createElement('span');
  effect.setAttribute('aria-hidden','true');
  const line = next.winningCells;
  if (line?.length === 3) {
    const origin = board.getBoundingClientRect();
    const center = index => {
      const {left,top,width,height} = cell(index).getBoundingClientRect();
      return [left-origin.left-board.clientLeft+width/2,top-origin.top-board.clientTop+height/2];
    };
    const [x,y] = center(line[0]);
    const [endX,endY] = center(line[2]);
    effect.className = 'tic-winning-line';
    effect.style.left = x+'px';
    effect.style.top = y+'px';
    effect.style.width = Math.hypot(endX-x,endY-y)+'px';
    effect.style.setProperty('--tic-angle',Math.atan2(endY-y,endX-x)+'rad');
  } else if (next.result === 'draw') {
    effect.className = 'tic-draw-sweep';
  } else {
    return;
  }
  board.append(effect);
  try {
    await Promise.allSettled(effect.getAnimations().map(animation => animation.finished));
  } finally {
    if (next.result === 'draw') effect.remove();
  }
}

function navalSound(kind) {
  if(!document.hidden&&['hit','win'].includes(kind)&&moveVibration.checked){
    try {
      if(tg?.HapticFeedback?.impactOccurred)tg.HapticFeedback.impactOccurred('light');
      else navigator.vibrate?.(15);
    } catch {}
  }
  if (!moveSound.checked || moveAudio?.state !== 'running' || document.hidden) return;
  const patterns = {
    splash:[[180,0,.035,.18],[280,.04,.02,.18]],
    hit:[[90,0,.06,.22],[150,.03,.03,.16]],
    plane:[[180,0,.025,.35],[120,.12,.025,.3]],
    torpedo:[[240,0,.025,.32],[100,.2,.04,.2]],
    scan:[[900,0,.025,.18],[900,.22,.012,.18]],
    win:[[392,0,.03,.4],[494,.08,.025,.35],[587,.16,.025,.35]],
    loss:[[330,0,.03,.2],[262,.18,.025,.25]]
  }[kind];
  for (const [frequency,offset,volume,duration] of patterns ?? []) {
    const start=moveAudio.currentTime+offset;
    const tone=moveAudio.createOscillator(), gain=moveAudio.createGain();
    tone.type='sine';tone.frequency.setValueAtTime(frequency,start);
    tone.frequency.exponentialRampToValueAtTime(frequency*.65,start+duration);
    gain.gain.setValueAtTime(.0001,start);
    gain.gain.exponentialRampToValueAtTime(volume,start+.008);
    gain.gain.exponentialRampToValueAtTime(.0001,start+duration);
    tone.connect(gain).connect(moveAudio.destination);
    tone.onended=()=>{tone.disconnect();gain.disconnect();};
    tone.start(start);tone.stop(start+duration+.01);
  }

}
let naval;
async function show(next) {
  if(next.game === 'battleship'){
    if(!naval)naval=navalScreen({root:el('naval-game'),api,onMenu:lobby,onUpdate:value=>state=value,onSound:navalSound});
    el('lobby').hidden=el('extras').hidden=el('game').hidden=true;
    clearTimeout(computerTimer);
    el('settings').hidden=true;
    el('naval-game').hidden=false;
    el('title').textContent='Морской бой';
    el('status').textContent='';
    await naval.load(next);
    return;
  }
  el('naval-game').hidden=true;
  naval?.stop();
  const opponentJoined = state?.id === next.id && !state.ready && next.ready && !next.training && !next.task;
  finishDrag();
  const finished = Boolean(!next.task && next.result && state?.id === next.id && !state.result);
  const delta = next.version-state?.version;
  const tic = next.game === 'tictactoe';
  const placed = tic && state?.id === next.id && delta > 0 && Boolean(next.lastMove);
  if (!tic && state?.id === next.id && delta > 0 && !document.hidden) {
    const frames = next.game === 'draughts' && next.replay?.length >= delta ? next.replay.slice(-delta)
      : delta === 1 && next.lastMove ? [{...next,move:next.lastMove}] : [];
    for (const [index,frame] of frames.entries()) {
      const effects = moveEffects(state,frame.move,frame);
      if (!reducedMotion.matches) await animateMove(frame.move,effects.capture);
      playMoveEffects(effects);
      if (index+1 < frames.length) {
        state = {...state,board:frame.board,taken:frame.taken,lastMove:frame.move,moves:[]};
        selected = undefined;
        draw();
      }
    }
  }
  if (state?.id !== next.id || state.version !== next.version) {
    selected = next.chain ?? undefined;
    choice = [];
  }
  if (state?.id !== next.id) review = undefined;
  state = next;
  puzzleHint = undefined;
  hintLevel = 0;
  el('puzzle-hint').hidden = !next.task || Boolean(next.solved);
  el('puzzle-hint').textContent = 'Подсказка';
  el('puzzle-hint').disabled = false;
  if (next.solved && next.series) {
    const {kind,index} = next.series;
    trainingProgress[kind] = [...new Set([...(trainingProgress[kind] ?? []),index])];
  }
  clockReceived = performance.now();
  el('extras').hidden = true;
  el('settings').hidden = true;
  const feedback = el('feedback');
  feedback.hidden = !next.task;
  feedback.classList.toggle('solved',next.solved === true);
  feedback.textContent = next.solved
    ? ('✓ Задача решена. '+({queen:'Ферзь взят!',crown:'Шашка стала дамкой!',chain:'Все шашки взяты!'}[next.series?.kind]
      ?? (next.game === 'chess' ? 'Мат!' : 'Шашка взята!')))
    : next.solved === false ? 'Этот ход не решает задачу. Попробуйте другой.' : '';
  el('puzzle-retry').hidden = !next.solved;
  const nextIndex = next.series ? unsolvedIndex(next.series,next.series.index+1) : -1;
  el('puzzle-next').hidden = !next.solved || nextIndex < 0;
  if (next.solved && next.series && nextIndex < 0) {
    feedback.textContent = '✓ Серия завершена ('+next.series.total+' из '+next.series.total+')';
  }
  el('back').textContent = next.task ? 'К задачам' : 'К выбору игры';
  if (!next.task) last = next.id;
  try { if (!next.task) localStorage.setItem('last-room',last); } catch {}
  const score = el('score');
  score.hidden = !state.score;
  el('share-score').disabled = false;
  if (state.score) {
    const {wins,losses,draws} = state.score;
    score.textContent = labels[state.game]+' · счёт '+wins+':'+losses+' · ничьих '+draws;
    score.classList.toggle('result-score',Boolean(state.result));
  }
  el('title').textContent = labels[state.game];
  el('lobby').hidden = true;
  el('game').hidden = false;
  const color = state.game === 'tictactoe' ? (state.side === 'w' ? 'крестиками' : 'ноликами') : state.side === 'w' ? 'белыми' : 'чёрными';
  const turn = state.turn === state.side ? 'Ваш ход' : 'Ход соперника';
  const local = state.training === 'local';
  const result = resultLabel(state);
  el('status').textContent = state.huff?.length && state.turn === state.side ? 'Выберите шашку, которую хотите снять' : state.task ? state.task+(state.series ? ' · '+(state.series.index+1)+'/'+state.series.total : '') : (state.result ? result+(state.reason ? ' · '+reasons[state.reason] : '') : (local ? 'Ходят '+colorName(state.turn).toLowerCase() : 'Вы играете '+color+' · '+(state.ready ? turn : 'Ждём соперника')));
  actions();
  draw();
  scheduleComputer();
  if (opponentJoined && !connectionLost) {
    const name = next.opponent?.name;
    connectionStatus(name && name !== 'Соперник' ? name+' за доской' : 'Соперник за доской');
    const message = el('connection-status').textContent;
    setTimeout(() => {
      if (el('connection-status').textContent === message) connectionStatus();
    },3500);
  }
  if (tic && !document.hidden) await animateTicTacToe(next,placed,finished);
  if (finished && state === next) presentMatchResult(next);
}

function actions() {
  const rule = el('game-rule');
  rule.hidden = state.task || state.game !== 'draughts';
  rule.textContent = state.rules === 'strict' ? 'Обязательное взятие' : 'За фук';
  const canShare = Boolean(state.result && state.score && state.opponent && !review);
  el('opponent-history').hidden = el('share-score').hidden = !canShare;
  const canDraw = state.ready && !state.task && !state.training && !state.result && !review;
  el('draw-offer').hidden = !canDraw;
  el('draw-offer').disabled = state.drawOffer === 'sent';
  el('draw-offer').textContent = state.drawOffer === 'received' ? 'Принять ничью'
    : state.drawOffer === 'sent' ? 'Ничья предложена' : 'Предложить ничью';
  el('draw-decline').hidden = !canDraw || state.drawOffer !== 'received';
  el('training-undo').hidden = !state.training || state.training === 'local' || !state.version || Boolean(review);
  const rematch = el('rematch');
  rematch.hidden = !state.result || !state.ready || Boolean(state.training || review);
  rematch.disabled = state.offer === 'sent' && !state.rematch;
  rematch.textContent = state.rematch ? 'Открыть реванш' : state.offer === 'received'
    ? 'Принять реванш' : state.offer === 'sent' ? 'Реванш предложен' : 'Реванш';
  const resultRematch = el('result-rematch');
  resultRematch.hidden = rematch.hidden;
  resultRematch.disabled = rematch.disabled;
  resultRematch.textContent = rematch.textContent;
  el('invite').hidden = Boolean(state.task || review || state.ready);
  el('review').hidden = !state.result || !state.version || Boolean(review);
  el('review-controls').hidden = !review;
  drawClocks();
}

const timeWarnings = new Set();
function drawClocks() {
  if (!state || state.game === 'battleship' || state.task || review || state.clock?.mode === 'none' || !state.clock) {
    el('self-clock').hidden = el('opponent-clock').hidden = true;
    return;
  }
  const clock = state.clock;
  const elapsed = !state.result && clock.started !== null
    ? Math.max(0,clock.now-clock.started+performance.now()-clockReceived) : 0;
  for (const [id,side] of [['self-clock',state.side],['opponent-clock',state.side === 'w' ? 'b' : 'w']]) {
    const seconds = Math.ceil(Math.max(0,clock[side]-(state.turn === side ? elapsed : 0))/1000);
    if (side === state.side && state.game !== 'tictactoe' && !state.result &&
        seconds > 0 && seconds <= 10 && !timeWarnings.has(state.id)) {
      timeWarnings.add(state.id);
      woodSound('time',state.game);
    }
    const hours = Math.floor(seconds/3600);
    const minutes = String(Math.floor(seconds%3600/60)).padStart(2,'0');
    const label = (hours ? hours+' ч ' : '')+minutes+':'+String(seconds%60).padStart(2,'0');
    const clockEl = el(id);
    clockEl.hidden = false;
    if (clockEl.textContent !== label) clockEl.textContent = label;
  }
}

function updateBoardFrame() {
  const tic = state.game === 'tictactoe';
  el('board').closest('.board-frame').classList.toggle('tic-frame',tic);
  const panelHidden = Boolean(state.task || review);
  const playing = !panelHidden && state.ready && !state.result;
  const white = boardSide() === 'w';
  el('self-panel').hidden = el('opponent-panel').hidden = panelHidden;
  el('self-panel').dataset.side = boardSide();
  el('opponent-panel').dataset.side = white ? 'b' : 'w';
  el('self-panel').dataset.symbol = tic ? (white ? '×' : '○') : '';
  el('opponent-panel').dataset.symbol = tic ? (white ? '○' : '×') : '';
  const local = state.training === 'local';
  el('self-name').textContent = local ? colorName(boardSide()) : 'Вы';
  el('opponent-name').textContent = local ? colorName(white ? 'b' : 'w') : state.training ? 'Компьютер' : state.ready ? (state.opponent?.name ?? 'Соперник') : 'Место свободно';
  const turnLabel = state.huff?.length ? 'Снимите шашку' : 'Ходят '+colorName(state.turn).toLowerCase();
  el('self-turn').textContent = local ? turnLabel : state.huff?.length ? 'Снимите шашку' : 'Ваш ход';
  el('opponent-turn').textContent = local ? turnLabel : 'Ход соперника';
  el('self-turn').hidden = !playing || state.turn !== boardSide();
  el('opponent-turn').hidden = !playing || state.turn === boardSide();
  el('status').classList.toggle('match-status',!state.task && !state.result && !(state.huff?.length && state.turn === state.side));
  for (const [id,values] of [['files',white ? 'abcdefgh' : 'hgfedcba'],['ranks',white ? '87654321' : '12345678']]) {
    if (el(id).textContent === values) continue;
    el(id).replaceChildren(...Array.from(values, value => {
      const label = document.createElement('span');
      label.textContent = value;
      return label;
    }));
  }
}

async function showReview(ply) {
  review = {...await api('/'+state.id+'/review',{ply}),ply};
  selected = undefined;
  el('ply').textContent = ply+' / '+state.version;
  el('prev-ply').disabled = ply === 0;
  el('next-ply').disabled = ply === state.version;
  actions();
  draw();
}

function draw() {
  updateBoardFrame();
  const display = review ?? state;
  const targets = new Set(state.moves.filter(m => m.from === selected).map(m => m.to));
  const tic = state.game === 'tictactoe';
  const squares = Array.from({length:tic ? 9 : 64},(_,i) => {
    const index = !tic && boardSide() === 'b' ? 63-i : i;
    const piece = display.taken?.includes(index) ? null : display.board[index];
    const button = document.createElement('button');
    button.className = 'cell';
    button.dataset.square = index;
    if (!tic && ((index >> 3)+index)%2) button.classList.add('dark');
    if (piece?.[0] === 'w') button.classList.add('white');
    if (puzzleHint?.from === index) button.classList.add('hint-source');
    if (puzzleHint?.to === index) button.classList.add('hint-destination');
    if (state.mateSquare === index) button.classList.add('mate-square');
    if (display.lastMove?.from === index || display.lastMove?.to === index) button.classList.add('last-move');
    if (!review && state.huff?.includes(index) && state.side === state.turn) button.classList.add('huff-target');
    if (selected === index) button.classList.add('selected');
    if (targets.has(index)) button.classList.add('target');
    if (tic) {
      const description = 'Ряд '+(Math.floor(index/3)+1)+', столбец '+(index%3+1);
      button.setAttribute('aria-label',description+', '+(piece ? (piece === 'w' ? 'крестик' : 'нолик') : 'свободно'));
      if (piece) {
        const mark = document.createElement('span');
        mark.className = 'tic-mark '+(piece === 'w' ? 'tic-x' : 'tic-o');
        mark.textContent = piece === 'w' ? '×' : '○';
        button.append(mark);
      }
      if (display.winningCells?.includes(index)) button.classList.add('tic-win');
      button.onclick = () => select(index);
      return button;
    }
    const coordinate = 'abcdefgh'[index%8]+(8-(index>>3));
    let description = coordinate;
    if (piece) {
      if (state.game === 'chess') {
        const figure = document.createElement('span');
        figure.className = 'chess-piece';
        figure.textContent = symbols[piece[1]];
        button.append(figure);
        description += ', '+names[piece[1]];
      } else {
        const disc = document.createElement('span');
        disc.className = piece[1] === 'k' ? 'disc crowned' : 'disc';
        disc.textContent = piece[1] === 'k' ? '♛' : '';
        button.append(disc);
        description += piece[1] === 'k' ? ', дамка' : ', шашка';
      }
      description += piece[0] === 'w' ? ', белые' : ', чёрные';
    }
    button.setAttribute('aria-label',description);
    button.onclick = () => select(index);
    return button;
  });
  el('board').replaceChildren(...squares);
  const options = choice.map(move => {
    const button = document.createElement('button');
    button.textContent = names[move.promotion];
    button.onclick = () => send(move);
    return button;
  });
  el('promotion').replaceChildren(...options);
  el('promotion').hidden = !options.length;
}

async function perform(action) {
  if (busy) return;
  busy = true;
  el('error').textContent = '';
  try { await action(); }
  catch (error) { el('error').textContent = error.message; }
  finally { busy = false; }
}

function select(index) {
  if (busy || review || state.solved) return;
  if (state.game === 'tictactoe') {
    const move = state.moves.find(item => item.to === index);
    if (move) return send(move);
    return;
  }
  if (state.huff?.length) {
    const penalty = state.moves.find(move => move.from === index);
    if (penalty) return send(penalty);
    return;
  }
  choice = state.moves.filter(m => m.from === selected && m.to === index);
  if (choice.length === 1) return send(choice[0]);
  if (state.task && !choice.length && selected !== undefined && state.board[index]?.[0] !== state.side) {
    el('feedback').textContent = state.game === 'draughts' && state.moves.some(move => move.victim !== undefined)
      ? 'Взятие обязательно. Выберите подсвеченную клетку.' : 'Так ходить нельзя. Выберите подсвеченную клетку.';
    return;
  }
  if (state.task && state.solved !== true) el('feedback').textContent = '';
  if (!choice.length) selected = state.moves.some(m => m.from === index) ? index : state.chain ?? undefined;
  draw();
}

function send(move) {
  return perform(async () => {
    if (state.task) {
      selected = undefined;
      choice = [];
      await show(await api('/puzzle',{game:state.game,move,series:state.series}));
      return;
    }
    const path = '/'+state.id;
    if (state.training) {
      try { await show(await api(path+'/move',{...move,version:state.version})); }
      catch (error) {
        if (error.status === 409) await show(await api(path));
        else throw error;
      }
      return;
    }
    pendingMove = {version:state.version};
    connectionStatus('Отправляем ход…');
    try {
      const next = await api(path+'/move',{...move,version:state.version});
      pendingMove = undefined;
      connectionLost = false;
      connectionStatus();
      await show(next);
    } catch (error) {
      if (error.network) {
        lostConnection();
        return;
      }
      pendingMove = undefined;
      connectionStatus();
      if (error.status === 409) await show(await api(path));
      throw error;
    }
  });
}

const boardSurface = el('board');
function finishDrag() {
  if (!drag) return;
  drag.ghost?.remove();
  drag.source?.classList.remove('moving-source');
  const pointer = drag.pointer;
  drag = undefined;
  if (boardSurface.hasPointerCapture(pointer)) boardSurface.releasePointerCapture(pointer);
}
boardSurface.addEventListener('pointerdown',event => {
  suppressBoardClick = false;
  if (!event.isPrimary || event.button !== 0 || busy || review || !state || state.result || state.solved) return;
  const from = Number(event.target.closest('.cell')?.dataset.square);
  if (!Number.isInteger(from)) return;
  if (event.pointerType === 'touch') {
    boardTouch = {pointer:event.pointerId,from,id:state.id,version:state.version,turn:state.turn};
    boardSurface.setPointerCapture(event.pointerId);
  }
  if (state.game === 'tictactoe' || state.huff?.length) return;
  if (!state.moves.some(move => move.from === from)) return;
  drag = {pointer:event.pointerId,from,x:event.clientX,y:event.clientY};
});
boardSurface.addEventListener('pointermove',event => {
  if (drag?.pointer !== event.pointerId) return;
  if (!drag.ghost) {
    if (Math.hypot(event.clientX-drag.x,event.clientY-drag.y) < 8) return;
    if (boardTouch?.pointer === event.pointerId &&
        document.elementFromPoint(event.clientX,event.clientY)?.closest('#board .cell') === cell(drag.from)) return;
    selected = drag.from;
    choice = [];
    draw();
    const source = cell(drag.from);
    const figure = source.firstElementChild;
    if (!figure) { finishDrag(); return; }
    const rect = source.getBoundingClientRect();
    const ghost = document.createElement('span');
    ghost.className = 'moving-piece drag-piece'+(source.classList.contains('white') ? ' white' : '');
    ghost.append(figure.cloneNode(true));
    Object.assign(ghost.style,{width:rect.width+'px',height:rect.height+'px',fontSize:getComputedStyle(source).fontSize});
    ghost.setAttribute('aria-hidden','true');
    document.body.append(ghost);
    Object.assign(drag,{ghost,source});
    source.classList.add('moving-source');
    boardSurface.setPointerCapture(event.pointerId);
  }
  drag.ghost.style.left = event.clientX+'px';
  drag.ghost.style.top = event.clientY+'px';
});
boardSurface.addEventListener('pointerup',event => {
  const touch = boardTouch?.pointer === event.pointerId ? boardTouch : undefined;
  if (!touch && drag?.pointer !== event.pointerId) return;
  if (touch) boardTouch = undefined;
  const moving = drag?.pointer === event.pointerId && Boolean(drag.ghost);
  const target = document.elementFromPoint(event.clientX,event.clientY)?.closest('#board .cell');
  finishDrag();
  if (!moving && !touch) return;
  suppressBoardClick = true;
  if (!target || !state) return;
  const to = Number(target.dataset.square);
  if (touch && (state.id !== touch.id || state.version !== touch.version || state.turn !== touch.turn ||
      (!moving && to !== touch.from))) return;
  select(to);
});
boardSurface.addEventListener('pointercancel',event => {
  if (boardTouch?.pointer === event.pointerId) boardTouch = undefined;
  if (drag?.pointer === event.pointerId) finishDrag();
});
boardSurface.addEventListener('lostpointercapture',event => {
  if (event.target !== boardSurface) return;
  if (boardTouch?.pointer === event.pointerId) boardTouch = undefined;
  if (drag?.pointer === event.pointerId) finishDrag();
});
boardSurface.addEventListener('pointerleave',event => {
  if (drag?.pointer === event.pointerId && !drag.ghost) finishDrag();
});
boardSurface.addEventListener('click',event => {
  if (!suppressBoardClick || event.detail === 0) return;
  suppressBoardClick = false;
  event.stopImmediatePropagation();
},true);

function menuTab(id) {
  for (const tab of ['play-tab','my-games','puzzle-tab']) {
    el(tab).setAttribute('aria-pressed',String(tab === id));
  }
  el('lobby').hidden = id !== 'play-tab';
  el('party-panel').hidden = id !== 'my-games';
  el('puzzle-panel').hidden = el('series-panel').hidden = id !== 'puzzle-tab';
  if (id === 'puzzle-tab') {
    loadTrainingArt();
    void refreshTrainingProgress().catch(() => {});
  }
}
async function refreshContinue() {
  try {
    const {rooms} = await api('');
    if (state) return;
    const room = rooms.find(r => r.ready && r.yourTurn) ?? rooms.find(r => r.id === last) ?? rooms[0];
    continueId = room?.id;
    el('resume').hidden = !room;
    if (room) {
      el('resume').textContent = room.ready && room.yourTurn
        ? 'Ваш ход · Продолжить партию' : 'Продолжить партию';
    }
  } catch {
    // Остальные действия главного меню доступны независимо от списка партий.
  }
}
el('play-tab').onclick = () => { if (!busy) menuTab('play-tab'); };
el('puzzle-tab').onclick = () => { if (!busy) menuTab('puzzle-tab'); };
el('training-toggle').onclick = () => {
  const list = el('series-list');
  list.hidden = !list.hidden;
  el('training-toggle').setAttribute('aria-expanded',String(!list.hidden));
};
el('settings').onclick = () => {
  el('settings-dialog').showModal();
  void api('/preferences').then(({enabled}) => showPreference(enabled)).catch(() => {});
};
for (const button of document.querySelectorAll('[data-game]')) {
  button.onclick = () => {
    if (busy) return;
    setupGame = button.dataset.game;
    el('setup-title').textContent = labels[setupGame];
    el('opponent-mode').value = 'friend';
    updateSetupClock();
    el('setup').returnValue = '';
    el('setup').showModal();
  };
}
function updateSetupClock() {
  el('clock-label').hidden = el('clock-mode').hidden = el('opponent-mode').value !== 'friend' || setupGame === 'battleship';
}
el('opponent-mode').onchange = updateSetupClock;
el('setup').onclose = () => {
  if (el('setup').returnValue !== 'create') return;
    const mode = el('opponent-mode').value;
  perform(async () => show(await api('',{game:setupGame,clock:mode === 'friend' && setupGame !== 'battleship' ? el('clock-mode').value : 'none',
    training:mode === 'friend' ? null : mode})));
};
for (const button of document.querySelectorAll('[data-puzzle]')) {
  button.onclick = () => perform(async () => show(await api('/puzzle',{game:button.dataset.puzzle})));
}
function scheduleComputer() {
  clearTimeout(computerTimer);
  if (!state?.training || state.training === 'local' || state.result || state.turn !== 'b' || review) return;
  computerTimer = setTimeout(() => {
    if (busy) return scheduleComputer();
    if (!state?.training || state.training === 'local' || state.result || state.turn !== 'b') return;
    perform(async () => {
      const path = '/'+state.id;
      try { await show(await api(path+'/computer',{version:state.version})); }
      catch (error) {
        if (error.status === 409) await show(await api(path));
        else throw error;
      }
    });
  },250);
}
function unsolvedIndex({kind,total},start = 0) {
  const done = trainingProgress[kind] ?? [];
  for (let i=0; i<total; i++) {
    const index = (start+i)%total;
    if (!done.includes(index)) return index;
  }
  return -1;
}
async function refreshTrainingProgress() {
  const {progress} = await api('/progress');
  for (const [kind,indices] of Object.entries(progress)) {
    trainingProgress[kind] = [...new Set([...(trainingProgress[kind] ?? []),...indices])];
  }
  for (const button of document.querySelectorAll('[data-series]')) {
    const count = trainingProgress[button.dataset.series]?.length ?? 0;
    const category = labels[button.dataset.gameKind];
    button.querySelector('small').textContent = category+' · '+count+' из '+trainingTotal+' решено';
  }
}
for (const button of document.querySelectorAll('[data-series]')) {
  const kind = button.dataset.series;
  button.onclick = () => perform(async () => {
    await refreshTrainingProgress();
    const index = unsolvedIndex({kind,total:trainingTotal});
    await show(await api('/puzzle',{game:button.dataset.gameKind,series:{kind,index:Math.max(0,index)}}));
  });
}
el('puzzle-next').onclick = () => perform(async () => {
  const index = unsolvedIndex(state.series,state.series.index+1);
  if (index >= 0) await show(await api('/puzzle',{game:state.game,series:{kind:state.series.kind,index}}));
});
el('puzzle-hint').onclick = () => perform(async () => {
  if (!state?.task || state.solved || hintLevel >= 2) return;
  const level = hintLevel+1;
  const {hint} = await api('/puzzle',{game:state.game,series:state.series,hint:level});
  if (!hint) return;
  hintLevel = level;
  puzzleHint = hint;
  selected = undefined;
  choice = [];
  el('feedback').textContent = hint.text;
  el('puzzle-hint').textContent = level === 1 ? 'Показать ход' : 'Ход показан';
  el('puzzle-hint').disabled = level === 2;
  draw();
});
el('draw-offer').onclick = () => perform(async () => show(await api('/'+state.id+'/draw',{
  intent:state.drawOffer === 'received' ? 'accept' : 'offer'
})));
el('draw-decline').onclick = () => perform(async () => show(await api('/'+state.id+'/draw',{intent:'decline'})));
el('training-undo').onclick = () => {
  clearTimeout(computerTimer);
  perform(async () => show(await api('/'+state.id+'/undo',{version:state.version})));
};
async function loadRooms(archived = false) {
  menuTab('my-games');
  selectPartyTab(archived ? 'archived-rooms' : 'active-rooms');
  const {rooms} = await api(archived ? '/archive' : '');
  const list = el('room-list');
  list.replaceChildren();
  if (!rooms.length) {
    const empty = document.createElement('p');
    empty.className = 'room-empty';
    empty.textContent = archived ? 'Завершённых партий пока нет' : 'Активных партий пока нет';
    list.append(empty);
  }
  for (const room of rooms) {
    const button = document.createElement('button');
    button.className = 'club-tile';
    const art = document.createElement('canvas');
    art.width = 250;
    art.height = 120;
    art.dataset.clubArt = room.game;
    art.setAttribute('aria-hidden','true');
    const title = document.createElement('span');
    title.textContent = labels[room.game];
    const status = document.createElement('small');
    status.textContent = !room.ready ? 'Ждём соперника' : room.yourTurn ? 'Ваш ход' : 'Ход соперника';
    if (archived) {
      const outcome = room.result === 'draw' ? 'Ничья' : room.training === 'local' ? resultLabel(room) : (room.result === 'w') === Boolean(room.isWhite) ? 'Победа' : 'Поражение';
      const date = room.date ? new Intl.DateTimeFormat('ru',{day:'numeric',month:'short'}).format(room.date) : null;
      status.textContent = [outcome,room.training === 'local' ? 'На одном телефоне' : room.training ? 'Компьютер' : room.opponent || 'Соперник',date].filter(Boolean).join(' · ');
    } else if (room.training) {
      status.textContent = room.training === 'local' ? 'На одном телефоне' : 'Тренировка с компьютером';
    }
    if (!archived && room.ready && room.yourTurn) button.classList.add('your-turn');
    title.append(status);
    if (room.game === 'tictactoe' || room.game === 'battleship') {
      const illustration = document.createElement('span');
      illustration.className = room.game === 'battleship' ? 'battleship-art' : 'tictactoe-art';
      illustration.setAttribute('aria-hidden','true');
      button.append(illustration,title);
    } else {
      button.append(art,title);
      paintClubArt(art);
    }
    button.onclick = () => perform(async () => show(await api('/'+room.id)));
    if (archived) {
      list.append(button);
      continue;
    }
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'room-close';
    close.textContent = 'Удалить';
    close.setAttribute('aria-label',close.textContent+' — '+labels[room.game]);
    close.onclick = () => {
      const question = 'Удалить партию для обоих игроков без изменения счёта?';
      if (!window.confirm(question)) return;
      perform(async () => {
        try {
          await api('/'+room.id+'/close',{intent:'delete',version:room.version});
        } catch (error) {
          if (error.status === 409 || error.status === 410) await loadRooms();
          throw error;
        }
        await refreshContinue();
        await loadRooms();
      });
    };
    const row = document.createElement('div');
    row.className = 'room-entry';
    row.append(button,close);
    list.append(row);
  }
}
el('my-games').onclick = el('active-rooms').onclick = () => perform(loadRooms);
el('archived-rooms').onclick = () => perform(() => loadRooms(true));
function selectPartyTab(id) {
  for (const tab of ['active-rooms','archived-rooms','opponents-rooms']) {
    el(tab).setAttribute('aria-pressed',String(tab === id));
  }
}
function menuButton(label, action) {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = label;
  button.onclick = () => perform(action);
  return button;
}
function tallyText({wins,losses,draws}) {
  return wins+':'+losses+' · ничьих '+draws;
}
function shareScore(url,label,score) {
  tg.openTelegramLink('https://t.me/share/url?url='+encodeURIComponent(url)+'&text='+
    encodeURIComponent('Наш счёт в «Доске» ('+label+'): '+tallyText(score)+'. Сначала мои победы.'));
}
async function showOpponents() {
  menuTab('my-games');
  selectPartyTab('opponents-rooms');
  const {opponents} = await api('/opponents');
  const list = el('room-list');
  list.replaceChildren();
  if (!opponents.length) {
    const empty = document.createElement('p');
    empty.className = 'room-empty';
    empty.textContent = 'Завершённых встреч пока нет';
    list.append(empty);
  }
  for (const opponent of opponents) {
    const button = menuButton(opponent.name+' · '+tallyText(opponent),() => showMeetings(opponent.id));
    button.className = 'meeting-card';
    list.append(button);
  }
}
async function showMeetings(opponent,game = 'all') {
  const {name,groups,rooms,shareUrl} = await api('/opponents',{opponent,game});
  const totals = {wins:0,losses:0,draws:0};
  for (const group of groups) {
    if (game !== 'all' && game !== group.game) continue;
    for (const key of Object.keys(totals)) totals[key] += group[key];
  }
  menuTab('my-games');
  selectPartyTab('opponents-rooms');
  const list = el('room-list');
  const title = document.createElement('h2');
  title.className = 'meeting-title';
  title.textContent = name+' · '+tallyText(totals);
  const filters = document.createElement('div');
  filters.className = 'actions archive-tabs';
  for (const [id,label] of [['all','Все'],['draughts','Шашки'],['chess','Шахматы'],['tictactoe','Крестики-нолики'],['battleship','Морской бой']]) {
    const filter = menuButton(label,() => showMeetings(opponent,id));
    filter.setAttribute('aria-pressed',String(game === id));
    filters.append(filter);
  }
  list.replaceChildren(title,filters);
  if (!rooms.length) {
    const empty = document.createElement('p');
    empty.textContent = 'В этом режиме встреч пока нет';
    list.append(empty);
  }
  for (const room of rooms) {
    const result = room.result === 'draw' ? 'Ничья' : (room.result === 'w') === Boolean(room.isWhite) ? 'Победа' : 'Поражение';
    const date = room.date ? new Intl.DateTimeFormat('ru',{day:'numeric',month:'short'}).format(room.date) : null;
    const button = menuButton([labels[room.game],result,date].filter(Boolean).join(' · '),async () => show(await api('/'+room.id)));
    button.className = 'meeting-card';
    list.append(button);
  }
  const controls = document.createElement('div');
  controls.className = 'actions meeting-controls';
  controls.append(menuButton('К соперникам',showOpponents));
  if (rooms.length) controls.append(menuButton('Поделиться счётом',() => shareScore(shareUrl,labels[game] ?? 'все встречи',totals)));
  list.append(controls);
}
el('opponents-rooms').onclick = () => perform(showOpponents);
el('opponent-history').onclick = () => perform(async () => {
  const {opponent,game} = state;
  lobby();
  await showMeetings(opponent.id,game);
});
el('share-score').onclick = () => {
  if (!busy && state?.score) shareScore(state.invite.split('?')[0],labels[state.game],state.score);
};
el('rematch').onclick = el('result-rematch').onclick = () => perform(async () => {
  const next = state.rematch ? state : await api('/'+state.id+'/rematch',{});
  if (next.rematch && el('match-result').open) el('match-result').close();
  await show(next.rematch ? await api('/'+next.rematch) : next);
});
el('review').onclick = () => perform(() => showReview(0));
el('prev-ply').onclick = () => perform(() => showReview(review.ply-1));
el('next-ply').onclick = () => perform(() => showReview(review.ply+1));
el('exit-review').onclick = () => {
  if (busy) return;
  review = undefined;
  actions();
  draw();
};
function showPreference(enabled) {
  el('notifications').textContent = enabled ? 'Выключить уведомления о ходе' : 'Включить уведомления о ходе';
}
el('notifications').onclick = () => perform(async () => {
  const {enabled} = await api('/preferences');
  if (!enabled && tg.requestWriteAccess) {
    const allowed = await new Promise(resolve => tg.requestWriteAccess(resolve));
    if (!allowed) return;
  }
  showPreference((await api('/preferences',{enabled:!enabled})).enabled);
});
el('resume').onclick = () => perform(async () => show(await api('/'+continueId)));
el('puzzle-retry').onclick = () => perform(async () => show(await api('/puzzle',{game:state.game,series:state.series ? {kind:state.series.kind,index:state.series.index} : null})));
el('back').onclick = () => {
  if (busy) return;
  const fromPuzzle = Boolean(state?.task);
  lobby();
  if (fromPuzzle) menuTab('puzzle-tab');
};
el('invite').onclick = () => {
  const description = labels[state.game]+(state.game === 'draughts'
    ? (state.rules === 'strict' ? ' · Обязательное взятие' : ' · За фук') : '');
  const url = 'https://t.me/share/url?url='+encodeURIComponent(state.invite)+'&text='+encodeURIComponent(description);
  tg.openTelegramLink(url);
};

if (!tg?.initData) {
  el('status').textContent = 'Откройте игру через бота в Telegram.';
} else {
  tg.ready();
  tg.expand();
  try { last = localStorage.getItem('last-room'); } catch {}
  if (!roomId.test(last)) last = undefined;
  lobby();
  const invite = tg.initDataUnsafe?.start_param;
  if (roomId.test(invite)) perform(async () => show(await api('/'+invite+'/join',{})));
  else if (typeof invite === 'string' && invite.startsWith('i_')) {
    perform(async () => show(await api('/challenge',{payload:invite})));
  }
  else if (invite === 'chess' || invite === 'draughts' || invite === 'tictactoe' || invite === 'battleship') {
    perform(async () => show(await api('',{game:invite})));
  }
  setInterval(drawClocks,250);
  setInterval(refreshMatch,2000);
}

let refreshingMatch = false;
async function refreshMatch() {
  if (refreshingMatch || busy || !state || state.game === 'battleship' || state.task || state.training || review ||
      document.hidden || (state.result && state.rematch)) return;
  const snapshot = state;
  refreshingMatch = true;
  try {
    const next = await api('/'+snapshot.id);
    if (state !== snapshot || busy || review || document.hidden) return;
    restoreConnection(next);
    const changed = ['version','ready','result','drawOffer','offer','rematch'].some(key => next[key] !== snapshot[key])
      || next.opponent?.name !== snapshot.opponent?.name || JSON.stringify(next.score) !== JSON.stringify(snapshot.score);
    if (changed) await perform(() => show(next));
  } catch (error) {
    if (error.network && state === snapshot && !busy && !snapshot.result) lostConnection();
    if (error.status === 410 && state === snapshot && !busy && !review) {
      await perform(async () => {
        lobby();
        throw error;
      });
    }
  } finally {
    refreshingMatch = false;
  }
}

const clubArt = new Image();
const crops = {hero:[0,79,499,232],draughts:[244,501,250,120],chess:[244,648,250,120],puzzle:[244,790,250,120]};
function paintClubArt(canvas) {
  if (!clubArt.complete || !clubArt.naturalWidth) return;
  canvas.getContext('2d')?.drawImage(clubArt,...crops[canvas.dataset.clubArt],0,0,canvas.width,canvas.height);
}
clubArt.onload = () => document.querySelectorAll('[data-club-art]').forEach(paintClubArt);
clubArt.src = '/club-art.png';

let trainingArtStarted = false;
function loadTrainingArt() {
  if (trainingArtStarted) return;
  trainingArtStarted = true;
  const art = new Image();
  art.onload = () => {
    const canvas = el('training-art');
    canvas.getContext('2d')?.drawImage(art,0,105,art.naturalWidth,528,0,0,canvas.width,canvas.height);
  };
  art.onerror = () => { trainingArtStarted = false; };
  art.src = '/training-art.png';
}
