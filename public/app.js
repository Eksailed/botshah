const tg = window.Telegram?.WebApp;
const el = id => document.getElementById(id);
const labels = {chess:'Шахматы',draughts:'Русские шашки'};
const symbols = {k:'♚',q:'♛',r:'♜',b:'♝',n:'♞',p:'♟'};
const names = {k:'король',q:'ферзь',r:'ладья',b:'слон',n:'конь',p:'пешка'};
const roomId = /^[a-f0-9]{24}$/;
let state, selected, busy = false, choice = [];
let last;

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
  state = selected = undefined;
  choice = [];
  el('title').textContent = 'Доска';
  el('status').textContent = 'Выберите игру';
  el('game').hidden = true;
  el('lobby').hidden = false;
  el('resume').hidden = !last;
}

function show(next) {
  if (state?.id !== next.id || state.version !== next.version) {
    selected = next.chain ?? undefined;
    choice = [];
  }
  state = next;
  last = next.id;
  try { localStorage.setItem('last-room',last); } catch {}
  el('title').textContent = labels[state.game];
  el('lobby').hidden = true;
  el('game').hidden = false;
  const color = state.side === 'w' ? 'белыми' : 'чёрными';
  const turn = state.turn === state.side ? 'Ваш ход' : 'Ход соперника';
  const result = state.result === 'draw' ? 'Ничья' : state.result === state.side ? 'Вы выиграли' : 'Соперник выиграл';
  el('status').textContent = state.result ? result : 'Вы играете '+color+' · '+(state.ready ? turn : 'Ждём соперника');
  draw();
}

function draw() {
  const targets = new Set(state.moves.filter(m => m.from === selected).map(m => m.to));
  const squares = Array.from({length:64},(_,i) => {
    const index = state.side === 'b' ? 63-i : i;
    const piece = state.taken?.includes(index) ? null : state.board[index];
    const button = document.createElement('button');
    button.className = 'cell';
    if (((index >> 3)+index)%2) button.classList.add('dark');
    if (piece?.[0] === 'w') button.classList.add('white');
    if (selected === index) button.classList.add('selected');
    if (targets.has(index)) button.classList.add('target');
    const coordinate = 'abcdefgh'[index%8]+(8-(index>>3));
    let description = coordinate;
    if (piece) {
      if (state.game === 'chess') {
        button.textContent = symbols[piece[1]];
        description += ', '+names[piece[1]];
      } else {
        const disc = document.createElement('span');
        disc.className = 'disc';
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
  if (busy) return;
  choice = state.moves.filter(m => m.from === selected && m.to === index);
  if (choice.length === 1) return send(choice[0]);
  if (!choice.length) selected = state.moves.some(m => m.from === index) ? index : state.chain ?? undefined;
  draw();
}

function send(move) {
  return perform(async () => {
    const path = '/'+state.id;
    try { show(await api(path+'/move',{...move,version:state.version})); }
    catch (error) {
      if (error.status === 409) show(await api(path));
      throw error;
    }
  });
}

for (const button of document.querySelectorAll('[data-game]')) {
  button.onclick = () => perform(async () => show(await api('',{game:button.dataset.game})));
}
el('resume').onclick = () => perform(async () => show(await api('/'+last)));
el('back').onclick = () => { if (!busy) lobby(); };
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
  setInterval(() => {
    if (state && !state.result && !document.hidden) {
      perform(async () => {
        const next = await api('/'+state.id);
        if (next.version !== state.version || next.ready !== state.ready) show(next);
      });
    }
  },2000);
}
