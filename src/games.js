import { Chess } from 'chess.js';
import { initial, draughts, step } from './draughts.js';

const square = i => 'abcdefgh'[i%8]+(8-(i>>3));
const index = s => (8-Number(s[1]))*8+'abcdefgh'.indexOf(s[0]);

export function position(game, history, fen) {
  if (game === 'chess') {
    const chess = new Chess(fen);
    for (const {from,to,promotion} of history) chess.move({from:square(from),to:square(to),promotion});
    const turn = chess.turn();
    const result = chess.isCheckmate() ? (turn === 'w' ? 'b' : 'w') : chess.isDraw() ? 'draw' : null;
    return {turn,result,board:chess.board().flat().map(p => p ? p.color+p.type : null),
      moves:result ? [] : chess.moves({verbose:true}).map(m => ({from:index(m.from),to:index(m.to),promotion:m.promotion}))};
  }
  let state = initial();
  const seen = new Map();
  const count = () => {
    if (state.chain !== null) return 0;
    const key = JSON.stringify([state.turn,state.board]);
    const times = (seen.get(key) ?? 0)+1;
    seen.set(key,times);
    return times;
  };
  let repetitions = count();
  for (const move of history) {
    state = step(state, move);
    repetitions = count();
  }
  const current = draughts(state);
  if (!current.result && (repetitions >= 3 || state.quiet >= 30)) {
    return {...current,result:'draw',moves:[]};
  }
  return current;
}
