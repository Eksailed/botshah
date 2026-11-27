import { connectFour } from './connectfour.js';
import { Chess } from 'chess.js';
import { ticTacToe } from './tictactoe.js';
import { initial, draughts, step } from './draughts.js';

const square = i => 'abcdefgh'[i%8]+(8-(i>>3));
const index = s => (8-Number(s[1]))*8+'abcdefgh'.indexOf(s[0]);

export function position(game, history, fen, rules = 'huff') {
  if (game === 'big-tictactoe') return connectFour(history,true);
  if (game === 'connectfour') return connectFour(history);
  if (game === 'tictactoe') return ticTacToe(history);
  if (game === 'chess') {
    const chess = new Chess(fen);
    for (const {from,to,promotion} of history) chess.move({from:square(from),to:square(to),promotion});
    const turn = chess.turn();
    const result = chess.isCheckmate() ? (turn === 'w' ? 'b' : 'w') : chess.isDraw() ? 'draw' : null;
    return {turn,result,check:chess.isCheck(),fen:chess.fen(),board:chess.board().flat().map(p => p ? p.color+p.type : null),
      moves:result ? [] : chess.moves({verbose:true}).map(m => ({from:index(m.from),to:index(m.to),promotion:m.promotion}))};
  }
  const huff = rules !== 'strict';
  let state = initial();
  const seen = new Map();
  const count = () => {
    if (state.chain !== null || state.huff?.length) return 0;
    const key = JSON.stringify([state.turn,state.board]);
    const times = (seen.get(key) ?? 0)+1;
    seen.set(key,times);
    return times;
  };
  const replay = [];
  let repetitions = count();
  for (const move of history) {
    state = step(state, move, huff);
    replay.push({move,board:state.board,taken:state.taken});
    if (replay.length > 12) replay.shift();
    repetitions = count();
  }
  const current = {...draughts(state,huff),replay};
  if (!current.result && !current.huff?.length && (repetitions >= 3 || state.quiet >= 30)) {
    return {...current,result:'draw',moves:[]};
  }
  return current;
}
