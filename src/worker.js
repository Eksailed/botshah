import { timingSafeEqual } from 'node:crypto';
import { position } from './games.js';
import { fail, verifyLaunch } from './telegram.js';

async function body(request) {
  const raw = await request.text();
  if (raw.length > 4096) fail(413,'Слишком большой запрос');
  let input;
  try { input = raw ? JSON.parse(raw) : {}; } catch { fail(400,'Некорректный запрос'); }
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail(400,'Некорректный запрос');
  return input;
}

async function webhook(request, env, origin) {
  const received = Buffer.from(request.headers.get('X-Telegram-Bot-Api-Secret-Token') ?? '');
  const expected = Buffer.from(env.WEBHOOK_SECRET ?? '');
  if (!expected.length || received.length !== expected.length || !timingSafeEqual(received,expected)) {
    fail(403,'Запрос отклонён');
  }
  const {message} = await body(request);
  if (message?.chat?.type === 'private' && /^\/start(?:@\w+)?(?:\s|$)/.test(message.text ?? '')) {
    const response = await fetch('https://api.telegram.org/bot'+env.BOT_TOKEN+'/sendMessage',{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({chat_id:message.chat.id,text:'Выберите шахматы или шашки и пригласите друга.',
        reply_markup:{inline_keyboard:[[{text:'Играть',web_app:{url:env.APP_URL || origin}}]]}})
    });
    if (!response.ok) fail(502,'Telegram не принял ответ');
  }
  return Response.json({ok:true});
}

async function room(request, env, path) {
  const user = verifyLaunch(request.headers.get('X-Telegram-Init-Data') ?? '',env.BOT_TOKEN);
  const db = env.DB;
  const match = /^\/api\/rooms\/([a-f0-9]{24})(?:\/(join|move))?$/.exec(path);
  const post = request.method === 'POST';
  const input = post ? await body(request) : {};
  let id = match?.[1];
  const action = match?.[2];
  if (post && path === '/api/rooms') {
    if (!['chess','draughts'].includes(input.game)) fail(400,'Выберите игру');
    id = crypto.randomUUID().replaceAll('-','').slice(0,24);
    await db.prepare('INSERT INTO rooms (id,game,white) VALUES (?,?,?)').bind(id,input.game,user).run();
  } else if (post && action === 'join') {
    await db.prepare('UPDATE rooms SET black = ? WHERE id = ? AND white != ? AND black IS NULL')
      .bind(user,id,user).run();
  } else if (!(match && ((post && action === 'move') || (request.method === 'GET' && !action)))) {
    fail(404,'Запрос не найден');
  }

  const row = await db.prepare('SELECT * FROM rooms WHERE id = ?').bind(id).first();
  if (!row) fail(404,'Комната не найдена');
  const side = row.white === user ? 'w' : row.black === user ? 'b' : fail(403,'Комната занята');
  const history = JSON.parse(row.history);
  let state = position(row.game,history);
  const ready = row.black !== null;
  if (action === 'move') {
    if (input.version !== history.length) fail(409,'Позиция уже изменилась');
    if (!ready || state.turn !== side || state.result) fail(403,'Ход сейчас недоступен');
    const move = state.moves.find(m => m.from === input.from && m.to === input.to && m.promotion === input.promotion);
    if (!move) fail(400,'Недопустимый ход');
    history.push({from:move.from,to:move.to,promotion:move.promotion});
    state = position(row.game,history);
    const updated = await db.prepare('UPDATE rooms SET history = ? WHERE id = ? AND history = ?')
      .bind(JSON.stringify(history),id,row.history).run();
    if (!updated.meta.changes) fail(409,'Позиция уже изменилась');
  }
  return Response.json({...state,id,game:row.game,side,ready,version:history.length,
    moves:ready && state.turn === side ? state.moves : [],
    invite:'https://t.me/'+env.BOT_USERNAME+'?startapp='+id},{headers:{'Cache-Control':'no-store'}});
}

export default {
  async fetch(request,env) {
    const url = new URL(request.url);
    try {
      if (url.pathname === '/telegram' && request.method === 'POST') return await webhook(request,env,url.origin);
      if (url.pathname.startsWith('/api/')) return await room(request,env,url.pathname);
      fail(404,'Запрос не найден');
    } catch (error) {
      if (!error.status) console.error(error);
      return Response.json({error:error.status ? error.message : 'Ошибка сервера'},{status:error.status ?? 500});
    }
  }
};
