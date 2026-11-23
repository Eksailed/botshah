const tg = window.Telegram?.WebApp;
const el = id => document.getElementById(id);
const labels = {chess:'Шахматы',draughts:'Русские шашки'};
const symbols = {k:'♚',q:'♛',r:'♜',b:'♝',n:'♞',p:'♟'};
const names = {k:'король',q:'ферзь',r:'ладья',b:'слон',n:'конь',p:'пешка'};
const roomId = /^[a-f0-9]{24}$/;
let state, selected, busy = false, choice = [];
let last, review, clockReceived, setupGame, continueId;

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

async function animateMove(move, after) {
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
  const jump = draughts && state.board.some((old,i) => old?.[0] !== piece[0] && old &&
    !state.taken?.includes(i) && (!after.board[i] || after.taken?.includes(i)));
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

async function show(next) {
  const delta = next.version-state?.version;
  if (state?.id === next.id && delta > 0 && !reducedMotion.matches && !document.hidden) {
    const frames = next.game === 'draughts' && next.replay?.length >= delta ? next.replay.slice(-delta)
      : delta === 1 && next.lastMove ? [{...next,move:next.lastMove}] : [];
    for (const [index,frame] of frames.entries()) {
      await animateMove(frame.move,frame);
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
  clockReceived = performance.now();
  el('extras').hidden = true;
  el('settings').hidden = true;
  const feedback = el('feedback');
  feedback.hidden = !next.task;
  feedback.classList.toggle('solved',next.solved === true);
  feedback.textContent = next.solved
    ? (next.game === 'chess' ? '✓ Задача решена. Мат!' : '✓ Задача решена. Шашка взята!')
    : next.solved === false ? 'Этот ход не решает задачу. Попробуйте другой.' : '';
  el('puzzle-retry').hidden = !next.solved;
  el('back').textContent = next.task ? 'К задачам' : 'К выбору игры';
  if (!next.task) last = next.id;
  try { if (!next.task) localStorage.setItem('last-room',last); } catch {}
  const score = el('score');
  score.hidden = !state.score;
  if (state.score) {
    const {wins,losses,draws} = state.score;
    score.textContent = 'С этим соперником: побед '+wins+' · поражений '+losses+' · ничьих '+draws;
  }
  el('title').textContent = labels[state.game];
  el('lobby').hidden = true;
  el('game').hidden = false;
  const color = state.side === 'w' ? 'белыми' : 'чёрными';
  const turn = state.turn === state.side ? 'Ваш ход' : 'Ход соперника';
  const result = state.result === 'draw' ? 'Ничья' : state.result === state.side ? 'Вы выиграли' : 'Соперник выиграл';
  el('status').textContent = state.huff?.length && state.turn === state.side ? 'Выберите шашку, которую хотите снять' : state.task ?? (state.result ? result : 'Вы играете '+color+' · '+(state.ready ? turn : 'Ждём соперника'));
  actions();
  draw();
}

function actions() {
  const rematch = el('rematch');
  rematch.hidden = !state.result || !state.ready || Boolean(review);
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
  el('opponent-name').textContent = state.ready ? 'Соперник' : 'Место свободно';
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
      await show(await api('/puzzle',{game:state.game,move}));
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
  el('puzzle-panel').hidden = id !== 'puzzle-tab';
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
el('settings').onclick = () => {
  el('settings-dialog').showModal();
  void api('/preferences').then(({enabled}) => showPreference(enabled)).catch(() => {});
};
for (const button of document.querySelectorAll('[data-game]')) {
  button.onclick = () => {
    if (busy) return;
    setupGame = button.dataset.game;
    el('setup-title').textContent = labels[setupGame];
    el('setup').returnValue = '';
    el('setup').showModal();
  };
}
el('setup').onclose = () => {
  if (el('setup').returnValue !== 'create') return;
  perform(async () => show(await api('',{game:setupGame,clock:el('clock-mode').value})));
};
for (const button of document.querySelectorAll('[data-puzzle]')) {
  button.onclick = () => perform(async () => show(await api('/puzzle',{game:button.dataset.puzzle})));
}
async function loadRooms() {
  menuTab('my-games');
  const {rooms} = await api('');
  const list = el('room-list');
  list.replaceChildren();
  if (!rooms.length) {
    const empty = document.createElement('p');
    empty.className = 'room-empty';
    empty.textContent = 'Активных партий пока нет';
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
    if (room.ready && room.yourTurn) button.classList.add('your-turn');
    title.append(status);
    button.append(art,title);
    paintClubArt(art);
    button.onclick = () => perform(async () => show(await api('/'+room.id)));
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
el('my-games').onclick = () => perform(loadRooms);
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
el('puzzle-retry').onclick = () => perform(async () => show(await api('/puzzle',{game:state.game})));
el('back').onclick = () => {
  if (busy) return;
  const fromPuzzle = Boolean(state?.task);
  lobby();
  if (fromPuzzle) menuTab('puzzle-tab');
};
el('invite').onclick = () => {
  const url = 'https://t.me/share/url?url='+encodeURIComponent(state.invite);
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
  else if (invite === 'chess' || invite === 'draughts') {
    perform(async () => show(await api('',{game:invite})));
  }
  setInterval(drawClocks,250);
  setInterval(() => {
    if (state && !state.task && !review && !document.hidden && (!state.result || !state.rematch)) {
      perform(async () => {
        const next = await api('/'+state.id);
        if (next.version !== state.version || next.ready !== state.ready || next.result !== state.result || next.offer !== state.offer || next.rematch !== state.rematch || JSON.stringify(next.score) !== JSON.stringify(state.score)) await show(next);
      });
    }
  },2000);
}

const clubArt = new Image();
const crops = {hero:[0,79,499,232],draughts:[244,501,250,120],chess:[244,648,250,120],puzzle:[244,790,250,120]};
function paintClubArt(canvas) {
  if (!clubArt.complete || !clubArt.naturalWidth) return;
  canvas.getContext('2d')?.drawImage(clubArt,...crops[canvas.dataset.clubArt],0,0,canvas.width,canvas.height);
}
clubArt.onload = () => document.querySelectorAll('[data-club-art]').forEach(paintClubArt);
clubArt.src = '/club-art.png';
