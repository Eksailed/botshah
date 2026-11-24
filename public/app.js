const tg = window.Telegram?.WebApp;
const el = id => document.getElementById(id);
const labels = {chess:'Шахматы',draughts:'Русские шашки'};
const symbols = {k:'♚',q:'♛',r:'♜',b:'♝',n:'♞',p:'♟'};
const names = {k:'король',q:'ферзь',r:'ладья',b:'слон',n:'конь',p:'пешка'};
const roomId = /^[a-f0-9]{24}$/;
let state, selected, busy = false, choice = [];
let last, review, clockReceived, setupGame, continueId, computerTimer, puzzleHint, hintLevel = 0;
const trainingTotal = 3;
let trainingProgress = {};
const reasons = {mate:'Мат',blocked:'Нет шашек или ходов',resign:'Сдача',timeout:'Время вышло',
  agreement:'По согласию',rules:'По правилам игры'};

async function api(path,body) {
  const response = await fetch('/api/rooms'+path,{
    method:body === undefined ? 'GET' : 'POST',
    headers:{'X-Telegram-Init-Data':tg.initData,'Content-Type':'application/json'},
    body:body === undefined ? undefined : JSON.stringify(body),
    signal:AbortSignal.timeout(10000)
  });
  const data = await response.json();
  if (!response.ok) throw Object.assign(new Error(data.error),{status:response.status});
  return data;
}

function lobby() {
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
const cell = index => el('board').children[state.side === 'b' ? 63-index : index];

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
moveSound.addEventListener('change',unlockMoveAudio);

function moveEffects(before,move,after) {
  const piece = before.board[move.from];
  if (!piece) return {};
  const capture = move.from === move.to || before.board.some((old,i) => old && old[0] !== piece[0] &&
    !before.taken?.includes(i) && (after.board[i] !== old || after.taken?.includes(i)));
  const crowned = before.game === 'draughts' && move.from !== move.to &&
    piece[1] === 'p' && after.board[move.to] === piece[0]+'k';
  return {capture,crowned};
}
function playMoveEffects({capture,crowned}) {
  if (document.hidden || tg?.isActive === false) return;
  if (moveSound.checked && moveAudio?.state === 'running') {
    const start = moveAudio.currentTime;
    const taps = capture ? [[225,0,.095],[510,.034,.065]] : [[370,0,.068]];
    for (const [frequency,offset,volume] of taps) {
      const time = start+offset;
      const tone = moveAudio.createOscillator();
      const gain = moveAudio.createGain();
      tone.type = 'triangle';
      tone.frequency.setValueAtTime(frequency,time);
      tone.frequency.exponentialRampToValueAtTime(frequency*.62,time+.032);
      gain.gain.setValueAtTime(.001,time);
      gain.gain.exponentialRampToValueAtTime(volume,time+.003);
      gain.gain.exponentialRampToValueAtTime(.001,time+.055);
      tone.connect(gain).connect(moveAudio.destination);
      tone.start(time);
      tone.stop(time+.06);
    }
  }
  if (crowned && moveVibration.checked) {
    try {
      if (tg?.HapticFeedback?.notificationOccurred && tg.isVersionAtLeast?.('6.1') !== false) {
        tg.HapticFeedback.notificationOccurred('success');
      } else {
        navigator.vibrate?.(35);
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

function presentMatchResult(next) {
  const sheet = el('match-result');
  const outcome = next.result === 'draw' ? 'draw' : next.result === next.side ? 'win' : 'loss';
  const reason = el('match-result-reason');
  sheet.dataset.outcome = outcome;
  sheet.returnValue = '';
  el('match-result-title').textContent = {win:'Вы победили!',loss:'Вы проиграли',draw:'Ничья'}[outcome];
  reason.textContent = reasons[next.reason] ?? '';
  reason.hidden = !reason.textContent;
  if (!sheet.open) sheet.showModal();
}
el('match-result').onclose = () => {
  if (el('match-result').returnValue === 'menu') lobby();
};

async function show(next) {
  const finished = Boolean(!next.task && next.result && state?.id === next.id && !state.result);
  const delta = next.version-state?.version;
  if (state?.id === next.id && delta > 0 && !document.hidden) {
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
  const color = state.side === 'w' ? 'белыми' : 'чёрными';
  const turn = state.turn === state.side ? 'Ваш ход' : 'Ход соперника';
  const result = state.result === 'draw' ? 'Ничья' : state.result === state.side ? 'Вы выиграли' : 'Соперник выиграл';
  el('status').textContent = state.huff?.length && state.turn === state.side ? 'Выберите шашку, которую хотите снять' : state.task ? state.task+(state.series ? ' · '+(state.series.index+1)+'/'+state.series.total : '') : (state.result ? result+(state.reason ? ' · '+reasons[state.reason] : '') : 'Вы играете '+color+' · '+(state.ready ? turn : 'Ждём соперника'));
  actions();
  draw();
  scheduleComputer();
  if (finished) presentMatchResult(next);
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
  el('training-undo').hidden = !state.training || !state.version || Boolean(review);
  const rematch = el('rematch');
  rematch.hidden = !state.result || !state.ready || Boolean(state.training || review);
  rematch.disabled = state.offer === 'sent' && !state.rematch;
  rematch.textContent = state.rematch ? 'Открыть реванш' : state.offer === 'received'
    ? 'Принять реванш' : state.offer === 'sent' ? 'Реванш предложен' : 'Реванш';
  el('invite').hidden = Boolean(state.task || review || state.ready);
  el('review').hidden = !state.result || !state.version || Boolean(review);
  el('review-controls').hidden = !review;
  drawClocks();
}

function drawClocks() {
  if (!state || state.task || review || state.clock?.mode === 'none' || !state.clock) {
    el('self-clock').hidden = el('opponent-clock').hidden = true;
    return;
  }
  const clock = state.clock;
  const elapsed = !state.result && clock.started !== null
    ? Math.max(0,clock.now-clock.started+performance.now()-clockReceived) : 0;
  for (const [id,side] of [['self-clock',state.side],['opponent-clock',state.side === 'w' ? 'b' : 'w']]) {
    const seconds = Math.ceil(Math.max(0,clock[side]-(state.turn === side ? elapsed : 0))/1000);
    const hours = Math.floor(seconds/3600);
    const minutes = String(Math.floor(seconds%3600/60)).padStart(2,'0');
    const label = (hours ? hours+' ч ' : '')+minutes+':'+String(seconds%60).padStart(2,'0');
    const clockEl = el(id);
    clockEl.hidden = false;
    if (clockEl.textContent !== label) clockEl.textContent = label;
  }
}

function updateBoardFrame() {
  const panelHidden = Boolean(state.task || review);
  const playing = !panelHidden && state.ready && !state.result;
  const white = state.side === 'w';
  el('self-panel').hidden = el('opponent-panel').hidden = panelHidden;
  el('self-panel').dataset.side = state.side;
  el('opponent-panel').dataset.side = white ? 'b' : 'w';
  el('opponent-name').textContent = state.training ? 'Компьютер' : state.ready ? 'Соперник' : 'Место свободно';
  el('self-turn').textContent = state.huff?.length ? 'Снимите шашку' : 'Ваш ход';
  el('self-turn').hidden = !playing || state.turn !== state.side;
  el('opponent-turn').hidden = !playing || state.turn === state.side;
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
  const squares = Array.from({length:64},(_,i) => {
    const index = state.side === 'b' ? 63-i : i;
    const piece = display.taken?.includes(index) ? null : display.board[index];
    const button = document.createElement('button');
    button.className = 'cell';
    if (((index >> 3)+index)%2) button.classList.add('dark');
    if (piece?.[0] === 'w') button.classList.add('white');
    if (puzzleHint?.from === index) button.classList.add('hint-source');
    if (puzzleHint?.to === index) button.classList.add('hint-destination');
    if (state.mateSquare === index) button.classList.add('mate-square');
    if (display.lastMove?.from === index || display.lastMove?.to === index) button.classList.add('last-move');
    if (!review && state.huff?.includes(index) && state.side === state.turn) button.classList.add('huff-target');
    if (selected === index) button.classList.add('selected');
    if (targets.has(index)) button.classList.add('target');
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
    try { await show(await api(path+'/move',{...move,version:state.version})); }
    catch (error) {
      if (error.status === 409) await show(await api(path));
      throw error;
    }
  });
}

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
  el('clock-label').hidden = el('clock-mode').hidden = el('opponent-mode').value !== 'friend';
}
el('opponent-mode').onchange = updateSetupClock;
el('setup').onclose = () => {
  if (el('setup').returnValue !== 'create') return;
    const mode = el('opponent-mode').value;
  perform(async () => show(await api('',{game:setupGame,clock:mode === 'friend' ? el('clock-mode').value : 'none',
    training:mode === 'friend' ? null : mode})));
};
for (const button of document.querySelectorAll('[data-puzzle]')) {
  button.onclick = () => perform(async () => show(await api('/puzzle',{game:button.dataset.puzzle})));
}
function scheduleComputer() {
  clearTimeout(computerTimer);
  if (!state?.training || state.result || state.turn !== 'b' || review) return;
  computerTimer = setTimeout(() => {
    if (busy) return scheduleComputer();
    if (!state?.training || state.result || state.turn !== 'b') return;
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
      const outcome = room.result === 'draw' ? 'Ничья' : (room.result === 'w') === Boolean(room.isWhite) ? 'Победа' : 'Поражение';
      const date = room.date ? new Intl.DateTimeFormat('ru',{day:'numeric',month:'short'}).format(room.date) : null;
      status.textContent = [outcome,room.training ? 'Компьютер' : room.opponent || 'Соперник',date].filter(Boolean).join(' · ');
    } else if (room.training) {
      status.textContent = 'Тренировка с компьютером';
    }
    if (!archived && room.ready && room.yourTurn) button.classList.add('your-turn');
    title.append(status);
    button.append(art,title);
    paintClubArt(art);
    button.onclick = () => perform(async () => show(await api('/'+room.id)));
    if (archived) {
      list.append(button);
      continue;
    }
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'room-close';
    close.textContent = room.started ? 'Сдаться' : 'Отозвать';
    close.setAttribute('aria-label',close.textContent+' — '+labels[room.game]);
    close.onclick = () => {
      const question = room.started ? 'Сдаться? Сопернику засчитается победа.' : 'Отозвать партию? Приглашение перестанет действовать.';
      if (!window.confirm(question)) return;
      perform(async () => {
        try {
          await api('/'+room.id+'/close',{intent:room.started ? 'resign' : 'withdraw'});
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
  for (const [id,label] of [['all','Все'],['draughts','Шашки'],['chess','Шахматы']]) {
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
el('rematch').onclick = () => perform(async () => {
  const next = state.rematch ? state : await api('/'+state.id+'/rematch',{});
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
  else if (invite === 'chess' || invite === 'draughts') {
    perform(async () => show(await api('',{game:invite})));
  }
  setInterval(drawClocks,250);
  setInterval(refreshMatch,2000);
}

let refreshingMatch = false;
async function refreshMatch() {
  if (refreshingMatch || busy || !state || state.task || state.training || review ||
      document.hidden || (state.result && state.rematch)) return;
  const snapshot = state;
  refreshingMatch = true;
  try {
    const next = await api('/'+snapshot.id);
    if (state !== snapshot || busy || review || document.hidden) return;
    const changed = ['version','ready','result','drawOffer','offer','rematch'].some(key => next[key] !== snapshot[key])
      || JSON.stringify(next.score) !== JSON.stringify(snapshot.score);
    if (changed) await perform(() => show(next));
  } catch (error) {
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
