import { position } from './games.js';
import { draughts, step } from './draughts.js';
import { fail } from './telegram.js';

export const clocks = {none:null, rapid:300000, daily:86400000};
export const roomId = () => crypto.randomUUID().replaceAll('-','').slice(0,24);
const chessTasks = [
  '7k/5K2/R7/8/8/8/8/8 w - - 0 1',
  '8/8/8/8/8/r7/5k2/7K b - - 0 1'
];
const draughtsTasks = [[42,35],[44,35],[40,33]];
export function puzzle(game, input, date = new Date()) {
  const day = Math.floor((date.getTime()+10800000)/86400000);
  if (game !== 'chess' && game !== 'draughts') fail(400,'Выберите игру');
  let state, solve;
  if (game === 'chess') {
    const fen = chessTasks[day%chessTasks.length];
    state = position(game,[],fen);
    solve = move => {
      const next = position(game,[move],fen);
      return next.result === state.turn ? next : null;
    };
  } else {
    const [from,victim] = draughtsTasks[day%draughtsTasks.length];
    const board = Array(64).fill(null);
    board[from] = 'wp';
    board[victim] = 'bp';
    state = draughts({board,turn:'w',chain:null,taken:[]});
    solve = move => move.victim === victim ? step(state,move) : null;
  }
  const move = state.moves.find(m => m.from === input?.from && m.to === input?.to && m.promotion === input?.promotion);
  const final = move ? solve(move) : null;
  const solved = input ? Boolean(final) : null;
  return {id:'puzzle',game,board:final?.board ?? state.board,taken:final?.taken,
    side:state.turn,turn:final?.turn ?? state.turn,ready:true,
    moves:final ? [] : state.moves,version:final ? 1 : 0,
    lastMove:final ? move : null,
    mateSquare:final && game === 'chess' ? final.board.indexOf(final.turn+'k') : null,
    task:game === 'chess' ? 'Поставьте мат в один ход' : 'Возьмите шашку соперника',solved};
}

export async function notifyTurn(env, user, id) {
  if (!await env.DB.prepare('SELECT 1 FROM notifications WHERE user_id = ?').bind(user).first()) return;
  await fetch('https://api.telegram.org/bot'+env.BOT_TOKEN+'/sendMessage',{
    method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({chat_id:user,text:'Твой ход в «Доске».',
      reply_markup:{inline_keyboard:[[{text:'Открыть партию',url:'https://t.me/'+env.BOT_USERNAME+'?startapp='+id}]]}})
  });
}
