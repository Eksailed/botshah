import {battleshipAPI} from './battleship-api.js';
import { timingSafeEqual } from 'node:crypto';
import { challenge, readChallenge, computerMove } from './modes.js';
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
    const games = [['draughts','Русские шашки','huff'],['chess','Шахматы','huff'],['tictactoe','Крестики-нолики','huff'],['battleship','Морской бой','classic']];
    const search = query.query.trim().toLowerCase();
    const results = games.filter(([id,title]) => id.includes(search) || title.toLowerCase().includes(search))
      .map(([id,title,rules]) => ({
        type:'article',id:id+'-'+rules,title,description:'Общая партия для двоих',
        thumbnail_url:(env.APP_URL || origin).replace(/\/+$/,'')+'/inline-'+id+'.jpg',thumbnail_width:160,thumbnail_height:160,
        input_message_content:{message_text:title+' в «Доске»'},
        reply_markup:{inline_keyboard:[[{text:'Открыть партию',url:'https://t.me/'+env.BOT_USERNAME+'?startapp='+challenge(env.BOT_TOKEN,query.from.id,id,rules,roomId())}]]}
      }));
    const response = await fetch('https://api.telegram.org/bot'+env.BOT_TOKEN+'/answerInlineQuery',{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({inline_query_id:query.id,results,cache_time:0,is_personal:true})
    });
    if (!response.ok) fail(502,'Telegram не принял карточки');
  }
  if (message?.chat?.type === 'private' && /^\/start(?:@\w+)?(?:\s|$)/.test(message.text ?? '')) {
    const response = await fetch('https://api.telegram.org/bot'+env.BOT_TOKEN+'/sendMessage',{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({chat_id:message.chat.id,text:'Выберите игру и пригласите друга.',
        reply_markup:{inline_keyboard:[[{text:'Играть',web_app:{url:env.APP_URL || origin}}]]}})
    });
    if (!response.ok) fail(502,'Telegram не принял ответ');
  }
  return Response.json({ok:true});
}

async function room(request, env, path, ctx) {
  const user = verifyLaunch(request.headers.get('X-Telegram-Init-Data') ?? '',env.BOT_TOKEN);
  const db = env.DB;
  const post = request.method === 'POST';
  const input = post ? await body(request) : {};
  const profile = JSON.parse(new URLSearchParams(request.headers.get('X-Telegram-Init-Data')).get('user'));
  if (post && typeof profile.first_name === 'string') {
    const name = [profile.first_name,profile.last_name].filter(value => typeof value === 'string').join(' ').slice(0,100);
    if (name) ctx.waitUntil(db.prepare('INSERT INTO players (id,name) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET name = excluded.name WHERE name != excluded.name')
      .bind(user,name).run().catch(console.error));
  }
  if (post && path === '/api/rooms/challenge') {
    const invite = readChallenge(env.BOT_TOKEN,input.payload);
    if (!invite) fail(404,'Вызов не найден');
    await db.prepare("INSERT OR IGNORE INTO rooms (id,game,white,rules,updated_at) VALUES (?,?,?,?,?)")
      .bind(invite.id,invite.game,invite.owner,invite.rules,Date.now()).run();
    path = '/api/rooms/'+invite.id+'/join';
  }
  const naval = new RegExp('^/api/rooms/([a-f0-9]{24})(?:/(join|move|computer|close|handoff|suspend|rematch|review|undo|draw))?$').exec(path);
  if (post && path === '/api/rooms' && input.game === 'battleship') return battleshipAPI(request,env,user,input);
  if (naval) {
    const kind = await db.prepare('SELECT game FROM rooms WHERE id=?').bind(naval[1]).first();
    if(kind?.game === 'battleship') return battleshipAPI(request,env,user,input,naval[1],naval[2]);
  }
  const match = /^\/api\/rooms\/([a-f0-9]{24})(?:\/(join|move|rematch|review|close|draw|computer|undo))?$/.exec(path);
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
  if (path === '/api/rooms/progress' && request.method === 'GET') {
    const {results} = await db.prepare('SELECT topic,task_index FROM training_progress WHERE user_id = ? ORDER BY task_index')
      .bind(user).all();
    const progress = Object.create(null);
    for (const {topic,task_index} of results) (progress[topic] ??= []).push(task_index);
    return Response.json({progress},{headers:{'Cache-Control':'no-store'}});
  }
  if (path === '/api/rooms/puzzle' && post) {
    const level = input.hint === 1 || input.hint === 2 ? input.hint : 0;
    const task = puzzle(input.game,level ? null : input.move,undefined,input.series,level);
    if (task.solved && task.series) {
      await db.prepare('INSERT OR IGNORE INTO training_progress (user_id,topic,task_index,solved_at) VALUES (?,?,?,?)')
        .bind(user,task.series.kind,task.series.index,Date.now()).run();
    }
    return Response.json(task,{headers:{'Cache-Control':'no-store'}});
  }
  if (path === '/api/rooms' && request.method === 'GET') {
    const {results} = await db.prepare(
      "SELECT id,game,black IS NOT NULL AS ready, history != '[]' AS started, training, white = ?1 AS isWhite, turn, (SELECT version FROM battleship_states WHERE room_id=rooms.id) AS navalVersion, CASE WHEN turn IS NULL THEN history END AS legacy "+
      "FROM rooms WHERE (white = ?1 OR black = ?1) AND result IS NULL ORDER BY rowid DESC"
    ).bind(user).all();
    return Response.json({rooms:results.map(({id,game,ready,started,training,isWhite,turn,legacy,navalVersion}) => ({
      id,game,ready,started:game==='battleship'?navalVersion>1:started,training,version:navalVersion,yourTurn:training !== 'local' && (turn ?? (game === 'battleship' ? null : position(game,JSON.parse(legacy)).turn)) === (isWhite ? 'w' : 'b')
    })).sort((a,b) => Number(b.ready && b.yourTurn)-Number(a.ready && a.yourTurn))},{headers:{'Cache-Control':'no-store'}});
  }
  if (path === '/api/rooms/opponents') {
    const pairs = "WITH meetings AS (SELECT id,game,result,result_reason,updated_at,white = ?1 AS is_white, "+
      "CASE WHEN white = ?1 THEN black ELSE white END AS opponent FROM rooms "+
      "WHERE (white = ?1 OR black = ?1) AND black IS NOT NULL AND training IS NULL AND result IN ('w','b','draw')) ";
    const score = "sum(CASE WHEN result = CASE WHEN is_white THEN 'w' ELSE 'b' END THEN 1 ELSE 0 END) AS wins, "+
      "sum(CASE WHEN result = CASE WHEN is_white THEN 'b' ELSE 'w' END THEN 1 ELSE 0 END) AS losses, "+
      "sum(CASE WHEN result = 'draw' THEN 1 ELSE 0 END) AS draws ";
    if (request.method === 'GET') {
      const {results} = await db.prepare(pairs+
        "SELECT opponent AS id,COALESCE(p.name,'Соперник') AS name,"+score+
        "FROM meetings LEFT JOIN players p ON p.id = opponent GROUP BY opponent ORDER BY max(updated_at) DESC,max(meetings.id) DESC")
        .bind(user).all();
      return Response.json({opponents:results},{headers:{'Cache-Control':'no-store'}});
    }
    if (post) {
      const {opponent,game = 'all'} = input;
      if (!Number.isSafeInteger(opponent) || opponent <= 0 || !['all','chess','draughts','tictactoe','battleship'].includes(game)) fail(400,'Выберите соперника');
      const {results:groups} = await db.prepare(pairs+"SELECT game,"+score+"FROM meetings WHERE opponent = ?2 GROUP BY game")
        .bind(user,opponent).all();
      if (!groups.length) fail(404,'Нет завершённых встреч с этим соперником');
      const {results:rooms} = await db.prepare(pairs+
        "SELECT id,game,result,result_reason AS reason,updated_at AS date,is_white AS isWhite "+
        "FROM meetings WHERE opponent = ?2 AND (?3 = 'all' OR game = ?3) ORDER BY updated_at DESC,id DESC LIMIT 30")
        .bind(user,opponent,game).all();
      const player = await db.prepare('SELECT name FROM players WHERE id = ?').bind(opponent).first();
      return Response.json({name:player?.name ?? 'Соперник',groups,rooms,shareUrl:'https://t.me/'+env.BOT_USERNAME},{headers:{'Cache-Control':'no-store'}});
    }
  }
  if (path === '/api/rooms/archive' && request.method === 'GET') {
    const {results} = await db.prepare(
      "SELECT r.id,r.game,r.result,r.result_reason AS reason,r.updated_at AS date,r.white = ?1 AS isWhite,r.training,p.name AS opponent "+
      "FROM rooms r LEFT JOIN players p ON p.id = CASE WHEN r.white = ?1 THEN r.black ELSE r.white END "+
      "WHERE (r.white = ?1 OR r.black = ?1) AND r.result IN ('w','b','draw') "+
      "ORDER BY r.updated_at DESC,r.rowid DESC LIMIT 50"
    ).bind(user).all();
    return Response.json({rooms:results},{headers:{'Cache-Control':'no-store'}});
  }
  let id = match?.[1];
  const action = match?.[2];
  if (post && path === '/api/rooms') {
    if (!['chess','draughts','tictactoe'].includes(input.game)) fail(400,'Выберите игру');
    const clock = input.clock ?? 'none';
    if (!Object.hasOwn(clocks,clock)) fail(400,'Выберите контроль времени');
    const rules = 'huff';
    const training = input.training ?? null;
    if (training !== null && !['easy','normal','local'].includes(training)) fail(400,'Выберите сложность');
    if (training && clock !== 'none') fail(400,'Этот режим идёт без часов');
    id = roomId();
    await db.prepare('INSERT INTO rooms (id,game,white,clock,white_ms,black_ms,rules,training,black,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)')
      .bind(id,input.game,user,clock,clocks[clock],clocks[clock],rules,training,training ? 0 : null,Date.now()).run();
  } else if (post && action === 'join') {
    await db.prepare("UPDATE rooms SET black = ?, started_ms = CASE WHEN clock != 'none' THEN ? END WHERE id = ? AND white != ? AND black IS NULL AND result IS NULL")
      .bind(user,Date.now(),id,user).run();
  } else if (!(match && ((post && ['move','rematch','review','close','draw','computer','undo'].includes(action)) || (request.method === 'GET' && !action)))) {
    fail(404,'Запрос не найден');
  }

  let row = await db.prepare('SELECT * FROM rooms WHERE id = ?').bind(id).first();
  if (!row) fail(404,'Комната не найдена');
  const side = row.white === user ? 'w' : row.black === user ? 'b' : fail(403,'Комната занята');
  if (row.result === 'cancelled') fail(410,'Партия отозвана');
  const history = JSON.parse(row.history);
  const evaluate = moves => position(row.game,moves,undefined,row.rules);
  let state = evaluate(history);
  const ready = row.black !== null;
  const now = Date.now();
  const remaining = state.turn === 'w' ? row.white_ms : row.black_ms;
  if (ready && !row.result && row.started_ms !== null && now-row.started_ms >= remaining) {
    const winner = state.turn === 'w' ? 'b' : 'w';
    await db.prepare("UPDATE rooms SET result = ?, result_reason = 'timeout', updated_at = ?, white_ms = CASE WHEN ? = 'w' THEN 0 ELSE white_ms END, black_ms = CASE WHEN ? = 'b' THEN 0 ELSE black_ms END WHERE id = ? AND result IS NULL AND history = ? AND started_ms = ?")
      .bind(winner,now,state.turn,state.turn,id,row.history,row.started_ms).run();
    row = await db.prepare('SELECT * FROM rooms WHERE id = ?').bind(id).first();
    if (row.history !== JSON.stringify(history)) fail(409,'Позиция уже изменилась');
  }
  state.result = row.result ?? state.result;
  let reason = row.result_reason;
  if (action === 'draw') {
    if (!ready || row.training || state.result) fail(403,'Ничья сейчас недоступна');
    let changed;
    if (input.intent === 'offer') {
      changed = await db.prepare('UPDATE rooms SET draw_offer = ? WHERE id = ? AND result IS NULL AND draw_offer IS NULL')
        .bind(user,id).run();
    } else if (input.intent === 'accept' || input.intent === 'decline') {
      const opponent = side === 'w' ? row.black : row.white;
      if (input.intent === 'accept') {
        changed = await db.prepare("UPDATE rooms SET result = 'draw',result_reason = 'agreement',updated_at = ?,draw_offer = NULL WHERE id = ? AND result IS NULL AND draw_offer = ?")
          .bind(now,id,opponent).run();
      } else {
        changed = await db.prepare('UPDATE rooms SET draw_offer = NULL WHERE id = ? AND result IS NULL AND draw_offer = ?')
          .bind(id,opponent).run();
      }
    } else fail(400,'Неизвестное действие');
    if (!changed.meta.changes) fail(409,'Предложение уже изменилось');
    row = await db.prepare('SELECT * FROM rooms WHERE id = ?').bind(id).first();
    state.result = row.result ?? state.result;
    reason = row.result_reason;
  }
  if (action === 'undo') {
    if (!row.training || row.training === 'local') fail(403,'Отмена доступна только в тренировке');
    if (input.version !== history.length || !history.length) fail(409,'Нет хода для отмены');
    let index = history.length-1;
    while (index > 0 && evaluate(history.slice(0,index)).turn !== 'w') index--;
    while (index > 0) {
      const snapshot = evaluate(history.slice(0,index));
      if (snapshot.chain == null && !snapshot.huff?.length) break;
      index--;
    }
    history.length = index;
    state = evaluate(history);
    const changed = await db.prepare('UPDATE rooms SET history = ?, result = NULL, result_reason = NULL, turn = ?, updated_at = ? WHERE id = ? AND history = ?')
      .bind(JSON.stringify(history),state.turn,now,id,row.history).run();
    if (!changed.meta.changes) fail(409,'Позиция уже изменилась');
    reason = null;
  }
  if (action === 'close') {
    if (state.result) fail(409,'Партия уже завершена');
    const required = history.length && row.training !== 'local' ? 'resign' : 'withdraw';
    if (input.intent !== required) fail(409,'Партия изменилась. Обновите список');
    const result = required === 'withdraw' ? 'cancelled' : side === 'w' ? 'b' : 'w';
    const changed = await db.prepare(
      'UPDATE rooms SET result = ?, result_reason = ?, updated_at = ? WHERE id = ? AND history = ? AND result IS NULL'
    ).bind(result,required,now,id,row.history).run();
    if (!changed.meta.changes) fail(409,'Партия изменилась. Обновите список');
    return Response.json({ok:true});
  }
  if (action === 'review') {
    if (!state.result) fail(403,'Партия ещё идёт');
    if (!Number.isInteger(input.ply) || input.ply < 0 || input.ply > history.length) fail(400,'Ход не найден');
    const snapshot = evaluate(history.slice(0,input.ply));
    return Response.json({board:snapshot.board,taken:snapshot.taken,winningCells:snapshot.winningCells,lastMove:history[input.ply-1] ?? null});
  }
  if (action === 'rematch') {
    if (!state.result || !ready || row.training) fail(403,'Реванш доступен после партии');
    await db.prepare('UPDATE rooms SET offer = ? WHERE id = ? AND offer IS NULL').bind(user,id).run();
    row = await db.prepare('SELECT * FROM rooms WHERE id = ?').bind(id).first();
    if (row.offer !== user) {
      await db.prepare('INSERT OR IGNORE INTO rooms (id,game,white,black,previous,clock,white_ms,black_ms,started_ms,rules,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
        .bind(roomId(),row.game,row.black,row.white,id,row.clock,clocks[row.clock],clocks[row.clock],row.clock === 'none' ? null : now,row.rules,now).run();
    }
  }
  if (action === 'move' || action === 'computer') {
    const bot = action === 'computer';
    if (input.version !== history.length) fail(409,'Позиция уже изменилась');
    const actor = bot ? 'b' : row.training === 'local' ? state.turn : side;
    if (bot && !['easy','normal'].includes(row.training)) fail(403,'Это не тренировка');
    if (!ready || state.turn !== actor || state.result) fail(403,'Ход сейчас недоступен');
    const move = bot ? computerMove(state,row.training,row.game,row.rules) : state.moves.find(m => m.from === input.from && m.to === input.to && m.promotion === input.promotion);
    if (!move) fail(400,'Недопустимый ход');
    history.push({from:move.from,to:move.to,promotion:move.promotion});
    state = evaluate(history);
    const pass = state.turn !== actor;
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
    reason = state.result ? state.result === 'draw' ? 'rules' : row.game === 'chess' ? 'mate' : row.game === 'tictactoe' ? 'three' : 'blocked' : null;
    const updated = await db.prepare(
      'UPDATE rooms SET history = ?, result = ?, result_reason = ?, updated_at = ?, turn = ?, white_ms = ?, black_ms = ?, started_ms = ? WHERE id = ? AND history = ? AND result IS NULL'
    ).bind(JSON.stringify(history),state.result,reason,now,state.turn,whiteMs,blackMs,row.started_ms === null ? null : now,id,row.history).run();
    if (!updated.meta.changes) fail(409,'Позиция уже изменилась');
    row = {...row,white_ms:whiteMs,black_ms:blackMs,started_ms:row.started_ms === null ? null : now};
    if (pass && !state.result && !row.training) {
      ctx.waitUntil(notifyTurn(env,side === 'w' ? row.black : row.white,id).catch(console.error));
    }
  }
  let score = null;
  let opponent = null;
  if (ready && !row.training) {
    const opponentId = side === 'w' ? row.black : row.white;
    const player = await db.prepare('SELECT name FROM players WHERE id = ?').bind(opponentId).first();
    opponent = {id:opponentId,name:player?.name ?? 'Соперник'};
    score = await db.prepare(
      "SELECT count(CASE WHEN result = 'draw' THEN 1 END) AS draws, "+
      "count(CASE WHEN (white = ?1 AND result = 'w') OR (black = ?1 AND result = 'b') THEN 1 END) AS wins, "+
      "count(CASE WHEN (white = ?1 AND result = 'b') OR (black = ?1 AND result = 'w') THEN 1 END) AS losses "+
      "FROM rooms WHERE game = ?3 AND training IS NULL AND result IN ('w','b','draw') AND ((white = ?1 AND black = ?2) OR (white = ?2 AND black = ?1))"
    ).bind(user,opponentId,row.game).first();
  }
  const rematch = state.result && ready && !row.training
    ? await db.prepare('SELECT id FROM rooms WHERE previous = ?').bind(id).first()
    : null;
  return Response.json({...state,id,game:row.game,side:row.training === 'local' ? state.turn : side,ready,score,opponent,training:row.training,rules:row.rules,reason,
    drawOffer:row.draw_offer === user ? 'sent' : row.draw_offer !== null ? 'received' : null,rematch:rematch?.id ?? null,
    offer:row.offer === user ? 'sent' : row.offer !== null ? 'received' : null,
    clock:{mode:row.clock,w:row.white_ms,b:row.black_ms,started:row.started_ms,now:Date.now()},lastMove:history.at(-1) ?? null,version:history.length,
    moves:ready && !state.result && (state.turn === side || row.training === 'local') ? state.moves : [],
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
