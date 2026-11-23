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
const seriesTasks = {
  mate:['7k/5K2/R7/8/8/8/8/8 w - - 0 1','k7/2K5/7R/8/8/8/8/8 w - - 0 1','8/8/8/8/8/r7/5k2/7K b - - 0 1'],
  chain:[[41,34,20],[46,37,19],[42,35,21]],
  crown:[[17,10],[19,12],[21,14]],
  queen:['7k/q7/8/8/8/8/8/R6K w - - 0 1','7k/8/8/3q4/8/8/6B1/7K w - - 0 1','7k/8/8/2q5/8/3N4/8/7K w - - 0 1'],
  kingCapture:[[56,35],[62,35],[49,35]]
};
export function puzzle(game, input, date = new Date(), series, hintLevel = 0) {
  const day = Math.floor((date.getTime()+10800000)/86400000);
  if (game !== 'chess' && game !== 'draughts') fail(400,'Выберите игру');
  const kind = series?.kind;
  const batch = kind && Object.hasOwn(seriesTasks,kind) ? seriesTasks[kind] : null;
  const index = series?.index ?? 0;
  const past = series?.history ?? [];
  if (series && (!batch || (['mate','queen'].includes(kind)) !== (game === 'chess') || !Number.isInteger(index) ||
    index < 0 || index >= batch.length || !Array.isArray(past) || past.length > 8)) fail(400,'Задача не найдена');
  let state, nextPosition, goal;
  if (game === 'chess') {
    const fen = batch?.[index] ?? chessTasks[day%chessTasks.length];
    state = position(game,[],fen);
    nextPosition = (_,move) => position(game,[move],fen);
    goal = kind === 'queen' ? next => !next.board.includes('bq') : next => next.result === state.turn;
  } else {
    const [from,...victims] = batch?.[index] ?? draughtsTasks[day%draughtsTasks.length];
    const board = Array(64).fill(null);
    board[from] = kind === 'kingCapture' ? 'wk' : 'wp';
    for (const victim of victims) board[victim] = 'bp';
    state = draughts({board,turn:'w',chain:null,taken:[]});
    for (const move of past) {
      if (!move || !state.moves.some(m => m.from === move.from && m.to === move.to)) fail(400,'Ход не найден');
      const next = step(state,move);
      if (next.chain === null) fail(400,'Серия взятий закончилась');
      state = draughts(next);
    }
    nextPosition = (current,move) => step(current,move);
    goal = next => next.chain === null && (kind === 'crown' ? next.board.includes('wk') : !next.board.includes('bp'));
  }
  const findSolution = current => {
    for (const candidate of current.moves) {
      const after = nextPosition(current,candidate);
      if (goal(after) || (game === 'draughts' && after.chain !== null && findSolution(draughts(after)))) return candidate;
    }
    return null;
  };
  const suggestion = hintLevel ? findSolution(state) : null;
  const hint = suggestion ? {
    from:suggestion.from,
    ...(hintLevel === 2 ? {to:suggestion.to} : {}),
    text:hintLevel === 1 ? 'Начните выделенной фигурой.' : kind === 'queen' ? 'Ход на выделенную клетку берёт ферзя.'
      : game === 'chess' ? 'Этот ход ставит мат.' : kind === 'crown' ? 'Взятие выводит шашку на последнюю линию — она станет дамкой.'
      : kind === 'chain' ? 'После этого прыжка проверьте, можно ли продолжить взятие той же шашкой.'
      : kind === 'kingCapture' ? 'Дамка перепрыгивает через шашку и приземляется за ней.'
      : 'Перепрыгните через шашку соперника на выделенную клетку.'
  } : null;
  const move = state.moves.find(m => m.from === input?.from && m.to === input?.to && m.promotion === input?.promotion);
  const next = move ? nextPosition(state,move) : null;
  const solved = Boolean(next && goal(next));
  const continuing = Boolean(next && game === 'draughts' && next.chain !== null);
  const advanced = solved || continuing;
  const shown = advanced ? next : state;
  const history = continuing ? [...past,{from:move.from,to:move.to}] : past;
  const task = kind === 'chain' ? 'Возьмите все шашки за один ход' : kind === 'crown' ? 'Превратите шашку в дамку'
    : kind === 'queen' ? 'Возьмите ферзя соперника' : kind === 'kingCapture' ? 'Возьмите шашку дамкой'
    : game === 'chess' ? 'Поставьте мат в один ход' : 'Возьмите шашку соперника';
  return {id:'puzzle',game,board:shown.board,taken:shown.taken,chain:shown.chain,
    side:state.turn,turn:shown.turn,ready:true,
    moves:solved ? [] : continuing ? draughts(shown).moves : state.moves,
    version:past.length+Number(advanced),lastMove:advanced ? move : null,
    mateSquare:solved && game === 'chess' && kind !== 'queen' ? shown.board.indexOf(shown.turn+'k') : null,
    series:batch ? {kind,index,total:batch.length,history} : null,
    task,hint,solved:input && !continuing ? solved : null};
}

export async function notifyTurn(env, user, id) {
  if (!await env.DB.prepare('SELECT 1 FROM notifications WHERE user_id = ?').bind(user).first()) return;
  await fetch('https://api.telegram.org/bot'+env.BOT_TOKEN+'/sendMessage',{
    method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({chat_id:user,text:'Твой ход в «Доске».',
      reply_markup:{inline_keyboard:[[{text:'Открыть партию',url:'https://t.me/'+env.BOT_USERNAME+'?startapp='+id}]]}})
  });
}
