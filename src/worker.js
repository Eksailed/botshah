import { timingSafeEqual } from 'node:crypto';
import { position } from './games.js';
import { clocks, notifyTurn, puzzle, roomId } from './play.js';
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
  const {message, inline_query: query} = await body(request);
  if (query) {
    const games = [['draughts','Русские шашки'],['chess','Шахматы']];
    const search = query.query.trim().toLowerCase();
    const results = games.filter(([id,title]) => id.includes(search) || title.toLowerCase().includes(search))
      .map(([id,title]) => ({
        type:'article',id,title,description:'Создать партию и пригласить друга',
        input_message_content:{message_text:title+' в «Доске»'},
        reply_markup:{inline_keyboard:[[{text:'Создать партию',url:'https://t.me/'+env.BOT_USERNAME+'?startapp='+id}]]}
      }));
    const response = await fetch('https://api.telegram.org/bot'+env.BOT_TOKEN+'/answerInlineQuery',{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({inline_query_id:query.id,results,cache_time:60})
    });
    if (!response.ok) fail(502,'Telegram не принял карточки');
  }
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

async function room(request, env, path, ctx) {
  const user = verifyLaunch(request.headers.get('X-Telegram-Init-Data') ?? '',env.BOT_TOKEN);
  const db = env.DB;
  const match = /^\/api\/rooms\/([a-f0-9]{24})(?:\/(join|move|rematch|review|close))?$/.exec(path);
  const post = request.method === 'POST';
  const input = post ? await body(request) : {};
  if (path === '/api/rooms/preferences') {
    if (post) {
      const sql = input.enabled
        ? 'INSERT OR IGNORE INTO notifications (user_id) VALUES (?)'
        : 'DELETE FROM notifications WHERE user_id = ?';
      await db.prepare(sql).bind(user).run();
    }
    const enabled = Boolean(await db.prepare('SELECT 1 FROM notifications WHERE user_id = ?').bind(user).first());
    return Response.json({enabled},{headers:{'Cache-Control':'no-store'}});
  }
  if (path === '/api/rooms/puzzle' && post) return Response.json(puzzle(input.game,input.move));
  if (path === '/api/rooms' && request.method === 'GET') {
    const {results} = await db.prepare(
      "SELECT id,game,black IS NOT NULL AS ready, history != '[]' AS started, white = ?1 AS isWhite, turn, CASE WHEN turn IS NULL THEN history END AS legacy "+
      "FROM rooms WHERE (white = ?1 OR black = ?1) AND result IS NULL ORDER BY rowid DESC"
    ).bind(user).all();
    return Response.json({rooms:results.map(({id,game,ready,started,isWhite,turn,legacy}) => ({
      id,game,ready,started,yourTurn:(turn ?? position(game,JSON.parse(legacy)).turn) === (isWhite ? 'w' : 'b')
    })).sort((a,b) => Number(b.ready && b.yourTurn)-Number(a.ready && a.yourTurn))},{headers:{'Cache-Control':'no-store'}});
  }
  let id = match?.[1];
  const action = match?.[2];
  if (post && path === '/api/rooms') {
    if (!['chess','draughts'].includes(input.game)) fail(400,'Выберите игру');
    const clock = input.clock ?? 'none';
    if (!Object.hasOwn(clocks,clock)) fail(400,'Выберите контроль времени');
    id = roomId();
    await db.prepare('INSERT INTO rooms (id,game,white,clock,white_ms,black_ms) VALUES (?,?,?,?,?,?)')
      .bind(id,input.game,user,clock,clocks[clock],clocks[clock]).run();
  } else if (post && action === 'join') {
    await db.prepare("UPDATE rooms SET black = ?, started_ms = CASE WHEN clock != 'none' THEN ? END WHERE id = ? AND white != ? AND black IS NULL AND result IS NULL")
      .bind(user,Date.now(),id,user).run();
  } else if (!(match && ((post && ['move','rematch','review','close'].includes(action)) || (request.method === 'GET' && !action)))) {
    fail(404,'Запрос не найден');
  }

  let row = await db.prepare('SELECT * FROM rooms WHERE id = ?').bind(id).first();
  if (!row) fail(404,'Комната не найдена');
  const side = row.white === user ? 'w' : row.black === user ? 'b' : fail(403,'Комната занята');
  if (row.result === 'cancelled') fail(410,'Партия отозвана');
  const history = JSON.parse(row.history);
  let state = position(row.game,history);
  const ready = row.black !== null;
  const now = Date.now();
  const remaining = state.turn === 'w' ? row.white_ms : row.black_ms;
  if (ready && !row.result && row.started_ms !== null && now-row.started_ms >= remaining) {
    const winner = state.turn === 'w' ? 'b' : 'w';
    await db.prepare("UPDATE rooms SET result = ?, white_ms = CASE WHEN ? = 'w' THEN 0 ELSE white_ms END, black_ms = CASE WHEN ? = 'b' THEN 0 ELSE black_ms END WHERE id = ? AND result IS NULL AND history = ? AND started_ms = ?")
      .bind(winner,state.turn,state.turn,id,row.history,row.started_ms).run();
    row = await db.prepare('SELECT * FROM rooms WHERE id = ?').bind(id).first();
    if (row.history !== JSON.stringify(history)) fail(409,'Позиция уже изменилась');
  }
  state.result = row.result ?? state.result;
  if (action === 'close') {
    if (state.result) fail(409,'Партия уже завершена');
    const required = history.length ? 'resign' : 'withdraw';
    if (input.intent !== required) fail(409,'Партия изменилась. Обновите список');
    const result = required === 'withdraw' ? 'cancelled' : side === 'w' ? 'b' : 'w';
    const changed = await db.prepare(
      'UPDATE rooms SET result = ? WHERE id = ? AND history = ? AND result IS NULL'
    ).bind(result,id,row.history).run();
    if (!changed.meta.changes) fail(409,'Партия изменилась. Обновите список');
    return Response.json({ok:true});
  }
  if (action === 'review') {
    if (!state.result) fail(403,'Партия ещё идёт');
    if (!Number.isInteger(input.ply) || input.ply < 0 || input.ply > history.length) fail(400,'Ход не найден');
    const snapshot = position(row.game,history.slice(0,input.ply));
    return Response.json({board:snapshot.board,taken:snapshot.taken,lastMove:history[input.ply-1] ?? null});
  }
  if (action === 'rematch') {
    if (!state.result || !ready) fail(403,'Реванш доступен после партии');
    await db.prepare('UPDATE rooms SET offer = ? WHERE id = ? AND offer IS NULL').bind(user,id).run();
    row = await db.prepare('SELECT * FROM rooms WHERE id = ?').bind(id).first();
    if (row.offer !== user) {
      await db.prepare('INSERT OR IGNORE INTO rooms (id,game,white,black,previous,clock,white_ms,black_ms,started_ms) VALUES (?,?,?,?,?,?,?,?,?)')
        .bind(roomId(),row.game,row.black,row.white,id,row.clock,clocks[row.clock],clocks[row.clock],row.clock === 'none' ? null : now).run();
    }
  }
  if (action === 'move') {
    if (input.version !== history.length) fail(409,'Позиция уже изменилась');
    if (!ready || state.turn !== side || state.result) fail(403,'Ход сейчас недоступен');
    const move = state.moves.find(m => m.from === input.from && m.to === input.to && m.promotion === input.promotion);
    if (!move) fail(400,'Недопустимый ход');
    history.push({from:move.from,to:move.to,promotion:move.promotion});
    state = position(row.game,history);
    const pass = state.turn !== side;
    const elapsed = row.started_ms === null ? 0 : Math.max(0,now-row.started_ms);
    let whiteMs = row.white_ms;
    let blackMs = row.black_ms;
    if (row.clock === 'rapid') {
      if (side === 'w') whiteMs -= elapsed - (pass ? 3000 : 0);
      else blackMs -= elapsed - (pass ? 3000 : 0);
    }
    if (row.clock === 'daily' && !pass) {
      if (side === 'w') whiteMs -= elapsed;
      else blackMs -= elapsed;
    } else if (row.clock === 'daily') {
      whiteMs = blackMs = clocks.daily;
    }
    const updated = await db.prepare(
      'UPDATE rooms SET history = ?, result = ?, turn = ?, white_ms = ?, black_ms = ?, started_ms = ? WHERE id = ? AND history = ? AND result IS NULL'
    ).bind(JSON.stringify(history),state.result,state.turn,whiteMs,blackMs,row.started_ms === null ? null : now,id,row.history).run();
    if (!updated.meta.changes) fail(409,'Позиция уже изменилась');
    row = {...row,white_ms:whiteMs,black_ms:blackMs,started_ms:row.started_ms === null ? null : now};
    if (pass && !state.result) {
      ctx.waitUntil(notifyTurn(env,side === 'w' ? row.black : row.white,id).catch(console.error));
    }
  }
  let score = null;
  if (ready) {
    const opponent = side === 'w' ? row.black : row.white;
    score = await db.prepare(
      "SELECT count(CASE WHEN result = 'draw' THEN 1 END) AS draws, "+
      "count(CASE WHEN (white = ?1 AND result = 'w') OR (black = ?1 AND result = 'b') THEN 1 END) AS wins, "+
      "count(CASE WHEN (white = ?1 AND result = 'b') OR (black = ?1 AND result = 'w') THEN 1 END) AS losses "+
      "FROM rooms WHERE result IS NOT NULL AND ((white = ?1 AND black = ?2) OR (white = ?2 AND black = ?1))"
    ).bind(user,opponent).first();
  }
  const rematch = state.result && ready
    ? await db.prepare('SELECT id FROM rooms WHERE previous = ?').bind(id).first()
    : null;
  return Response.json({...state,id,game:row.game,side,ready,score,rematch:rematch?.id ?? null,
    offer:row.offer === user ? 'sent' : row.offer !== null ? 'received' : null,
    clock:{mode:row.clock,w:row.white_ms,b:row.black_ms,started:row.started_ms,now:Date.now()},lastMove:history.at(-1) ?? null,version:history.length,
    moves:ready && !state.result && state.turn === side ? state.moves : [],
    invite:'https://t.me/'+env.BOT_USERNAME+'?startapp='+id},{headers:{'Cache-Control':'no-store'}});
}

export default {
  async fetch(request,env,ctx) {
    const url = new URL(request.url);
    try {
      if (url.pathname === '/telegram' && request.method === 'POST') return await webhook(request,env,url.origin);
      if (url.pathname.startsWith('/api/')) return await room(request,env,url.pathname,ctx);
      fail(404,'Запрос не найден');
    } catch (error) {
      if (!error.status) console.error(error);
      return Response.json({error:error.status ? error.message : 'Ошибка сервера'},{status:error.status ?? 500});
    }
  }
};
