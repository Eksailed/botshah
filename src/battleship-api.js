import { navalComputerMove } from './battleship-ai.js';
import { createBattle, autoFleet, act, playerView } from './battleship.js';
import { roomId } from './play.js';
import { fail } from './telegram.js';

const opposite = side => side === 'w' ? 'b' : 'w';
function freshState(training,turnRule='until-miss') {
  let state = createBattle('classic',turnRule);
  if (training === 'local') Object.assign(state,{localSide:'w',localReady:false});
  if (training && training !== 'local') {
    const fleet = autoFleet();
    const mine = Array.from({length:100}, (_,i) => i).find(cell => !fleet.flat().includes(cell));
    state = act(state,'b',{kind:'place',fleet,mine});
  }
  return state;
}
export async function battleshipAPI(request, env, user, input, id, action) {
  const db = env.DB, post = request.method === 'POST';
  if (!id) {
    const training = input.training ?? null;
    if (![null,'local','easy','normal'].includes(training)) fail(400,'Выберите соперника');
    if (!['classic','arsenal'].includes(input.mode ?? 'classic')) fail(400,'Выберите правила');
    if (input.clock && input.clock !== 'none') fail(400,'Морской бой идёт без часов');
    id = roomId();
    if(!['until-miss','alternating'].includes(input.turnRule??'until-miss'))fail(400,'Выберите очередь выстрелов');
    const state = freshState(training,input.turnRule);
    await db.batch([
      db.prepare("INSERT INTO rooms(id,game,white,black,training,clock,rules,turn,updated_at) VALUES (?,'battleship',?,?,?,'none','huff',?,?)").bind(id,user,training ? 0 : null,training,state.turn,Date.now()),
      db.prepare('INSERT INTO battleship_states(room_id,version,state) VALUES (?,?,?)').bind(id,state.version,JSON.stringify(state))
    ]);
  }
  let row = await db.prepare('SELECT * FROM rooms WHERE id=?').bind(id).first();
  if (!row || row.game !== 'battleship') fail(404,'Партия не найдена');
  if (action === 'join' && post) {
    await db.prepare('UPDATE rooms SET black=? WHERE id=? AND white!=? AND black IS NULL AND result IS NULL').bind(user,id,user).run();
    row = await db.prepare('SELECT * FROM rooms WHERE id=?').bind(id).first();
  }
  const ownerSide = row.white === user ? 'w' : row.black === user ? 'b' : fail(403,'Комната занята');
  let stored = await db.prepare('SELECT * FROM battleship_states WHERE room_id=?').bind(id).first();
  if (!stored) {
    const initial = freshState(row.training);
    await db.prepare('INSERT OR IGNORE INTO battleship_states(room_id,version,state) VALUES (?,?,?)').bind(id,initial.version,JSON.stringify(initial)).run();
    stored = await db.prepare('SELECT * FROM battleship_states WHERE room_id=?').bind(id).first();
  }
  let state = JSON.parse(stored.state);
  // Старые партии продолжаются с уже сделанными выстрелами по классическим правилам.
  if(state.mode === 'arsenal') {
    state.mode='classic';
    for(const player of Object.values(state.players)) {
      player.mine=null;player.blocked=false;player.scans=[];
      player.stock={plane:0,torpedo:0,scan:0};
    }
    if(state.lastAction && state.lastAction.kind !== 'shot')state.lastAction=null;
  }
  const local = row.training === 'local';
  const side = local ? state.localSide : ownerSide;
  if (state.result === 'cancelled') fail(410,'Партия отозвана');
  if (action && !['join','move','computer','close','handoff','suspend','rematch'].includes(action)) fail(400,'Это действие недоступно в морском бою');
  if (action && !post) fail(405,'Используйте POST');
  if (action === 'rematch') {
    if (!state.result || row.black === null) fail(403,'Сначала закончите партию');
    const nextId = roomId(), next = freshState(row.training,state.turnRule);
    await db.batch([
      db.prepare("INSERT OR IGNORE INTO rooms(id,game,white,black,training,clock,rules,turn,previous,updated_at) VALUES (?,'battleship',?,?,?,'none','huff',?,?,?)").bind(nextId,row.white,row.black,row.training,next.turn,id,Date.now()),
      db.prepare('INSERT OR IGNORE INTO battleship_states(room_id,version,state) SELECT id,?,? FROM rooms WHERE id=?').bind(next.version,JSON.stringify(next),nextId)
    ]);
    const rematch = await db.prepare('SELECT id FROM rooms WHERE previous=?').bind(id).first();
    return Response.json({rematch:rematch.id});
  }
  if (post && ['move','computer','close','handoff','suspend'].includes(action)) {
    if (input.version !== stored.version) fail(409,'Позиция изменилась. Обновите поле');
    try {
      if (action === 'handoff' || action === 'suspend') {
        if (!local || state.result) fail(403,'Передача сейчас недоступна');
        state.localReady = action === 'handoff';
        state.version++;
      } else if (action === 'close') {
        if (state.result) fail(409,'Партия завершена');
        const required = state.phase === 'setup' || local ? 'withdraw' : 'resign';
        if (input.intent !== required) fail(409,'Обновите список партий');
        state.result = required === 'withdraw' ? 'cancelled' : opposite(ownerSide);
        state.phase = 'finished';state.version++;
      } else if (action === 'computer') {
        if (!row.training || local || state.turn !== 'b' || state.phase !== 'battle') fail(403,'Сейчас ход игрока');
        state = act(state,'b',navalComputerMove(playerView(state,'b'),row.training));
      } else {
        if (local && !state.localReady) fail(403,'Подтвердите передачу телефона');
        if (row.black === null && input.kind !== 'place') fail(403,'Ждём соперника');
        state = act(state,side,input);
        if (local && !state.result) {
          const nextSide = !state.players.w.fleet ? 'w' : !state.players.b.fleet ? 'b' : state.turn;
          if (nextSide !== side) { state.localSide = nextSide;state.localReady = false; }
        }
      }
    } catch (error) { if (error.status) throw error;fail(400,error.message); }
    const serialized = JSON.stringify(state);
    const result = await db.batch([
      db.prepare('UPDATE battleship_states SET state=?,version=? WHERE room_id=? AND version=?').bind(serialized,state.version,id,stored.version),
      db.prepare('UPDATE rooms SET result=?,result_reason=?,turn=?,updated_at=? WHERE id=? AND EXISTS(SELECT 1 FROM battleship_states WHERE room_id=? AND version=? AND state=?)').bind(state.result,state.result ? action === 'close' ? input.intent : 'fleet' : null,state.turn,Date.now(),id,id,state.version,serialized)
    ]);
    if (!result[0].meta.changes) fail(409,'Позиция изменилась. Обновите поле');
  }
  const currentSide = local ? state.localSide : ownerSide;
  const locked = local && !state.localReady && !state.result;
  const view = locked ? {phase:state.phase,mode:state.mode,turnRule:state.turnRule,turn:state.turn,result:null,version:state.version,handoff:true} : playerView(state,currentSide);
  const opponentId = ownerSide === 'w' ? row.black : row.white;
  const opponent = !row.training && opponentId ? await db.prepare('SELECT name FROM players WHERE id=?').bind(opponentId).first() : null;
  const score = !row.training && row.black !== null ? await db.prepare("SELECT count(CASE WHEN result=CASE WHEN white=?1 THEN 'w' ELSE 'b' END THEN 1 END) AS wins, count(CASE WHEN result=CASE WHEN white=?1 THEN 'b' ELSE 'w' END THEN 1 END) AS losses FROM rooms WHERE game='battleship' AND training IS NULL AND result IN ('w','b') AND ((white=?1 AND black=?2) OR (white=?2 AND black=?1))").bind(user,opponentId).first() : null;
  return Response.json({...view,id,game:'battleship',side:currentSide,training:row.training,ready:row.black !== null,opponent:opponent?.name,score,invite:'https://t.me/'+env.BOT_USERNAME+'?startapp='+id},{headers:{'Cache-Control':'no-store'}});
}
