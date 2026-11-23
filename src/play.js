import { position } from './games.js';
import { draughts } from './draughts.js';
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
  let state, success;
  if (game === 'chess') {
    const fen = chessTasks[day%chessTasks.length];
    state = position(game,[],fen);
    success = move => position(game,[move],fen).result === state.turn;
  } else {
    const [from,victim] = draughtsTasks[day%draughtsTasks.length];
    const board = Array(64).fill(null);
    board[from] = 'wp';
    board[victim] = 'bp';
    state = draughts({board,turn:'w',chain:null,taken:[]});
    success = move => move.victim === victim;
  }
  const move = state.moves.find(m => m.from === input?.from && m.to === input?.to && m.promotion === input?.promotion);
  return {id:'puzzle',game,board:state.board,side:state.turn,turn:state.turn,ready:true,
    moves:state.moves,version:0,task:game === 'chess' ? 'Поставьте мат в один ход' : 'Возьмите шашку соперника',
    solved:input ? Boolean(move && success(move)) : null};
}

export async function notifyTurn(env, user, id) {
  if (!await env.DB.prepare('SELECT 1 FROM notifications WHERE user_id = ?').bind(user).first()) return;
  await fetch('https://api.telegram.org/bot'+env.BOT_TOKEN+'/sendMessage',{
    method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({chat_id:user,text:'Твой ход в «Доске».',
      reply_markup:{inline_keyboard:[[{text:'Открыть партию',url:'https://t.me/'+env.BOT_USERNAME+'?startapp='+id}]]}})
  });
}
