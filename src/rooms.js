import { randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { position } from './games.js';
import { fail } from './telegram.js';

export function rooms(path) {
  const db = new DatabaseSync(path);
  db.exec("CREATE TABLE IF NOT EXISTS rooms (id TEXT PRIMARY KEY, game TEXT NOT NULL, white INTEGER NOT NULL, black INTEGER, history TEXT NOT NULL DEFAULT '[]')");
  const read = db.prepare('SELECT * FROM rooms WHERE id = ?');
  const get = id => read.get(id) ?? fail(404,'Комната не найдена');
  const side = (room,user) => room.white === user ? 'w' : room.black === user ? 'b' : fail(403,'Комната занята');
  function view(room,user) {
    const color = side(room,user);
    const history = JSON.parse(room.history);
    const state = position(room.game,history);
    const ready = room.black !== null;
    return {...state,id:room.id,game:room.game,side:color,ready,version:history.length,
      moves:ready && color === state.turn ? state.moves : []};
  }
  return {
    close: () => db.close(),
    create(game,user) {
      if (!['chess','draughts'].includes(game)) fail(400,'Выберите игру');
      const id = randomBytes(12).toString('hex');
      db.prepare('INSERT INTO rooms (id,game,white) VALUES (?,?,?)').run(id,game,user);
      return view(get(id),user);
    },
    join(id,user) {
      db.prepare('UPDATE rooms SET black = ? WHERE id = ? AND white != ? AND black IS NULL').run(user,id,user);
      return view(get(id),user);
    },
    read(id,user) { return view(get(id),user); },
    move(id,user,input) {
      const room = get(id);
      const state = view(room,user);
      if (input.version !== state.version) fail(409,'Позиция уже изменилась');
      if (!state.ready || state.turn !== state.side || state.result) fail(403,'Ход сейчас недоступен');
      const move = state.moves.find(m => m.from === input.from && m.to === input.to && m.promotion === input.promotion);
      if (!move) fail(400,'Недопустимый ход');
      const history = JSON.parse(room.history);
      history.push({from:move.from,to:move.to,promotion:move.promotion});
      const changed = db.prepare('UPDATE rooms SET history = ? WHERE id = ? AND history = ?')
        .run(JSON.stringify(history),id,room.history).changes;
      if (!changed) fail(409,'Позиция уже изменилась');
      return view(get(id),user);
    }
  };
}
