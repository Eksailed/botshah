const diagonals = [[1,1],[1,-1],[-1,1],[-1,-1]];
const index = (r,c) => r >= 0 && r < 8 && c >= 0 && c < 8 ? r*8+c : -1;

export function initial() {
  return {turn:'w', chain:null, taken:[], quiet:0, board:Array.from({length:64}, (_,i) => {
    const row = i >> 3;
    return (row+i)%2 ? row < 3 ? 'bp' : row > 4 ? 'wp' : null : null;
  })};
}

export function draughts(state) {
  const {board,turn,chain,taken} = state;
  const captures = [], quiet = [];
  for (const [from,piece] of board.entries()) {
    if (piece?.[0] !== turn || (chain !== null && from !== chain)) continue;
    const king = piece[1] === 'k';
    for (const [dr,dc] of diagonals) {
      let victim = null;
      for (let distance = 1; distance < 8; distance++) {
        const to = index((from >> 3)+dr*distance, from%8+dc*distance);
        if (to < 0) break;
        if (board[to]) {
          if (victim !== null || taken.includes(to) || board[to][0] === turn || (!king && distance !== 1)) break;
          victim = to;
        } else {
          if (victim !== null) captures.push({from,to,victim});
          else {
            if (king || dr === (turn === 'w' ? -1 : 1)) quiet.push({from,to});
            if (!king) break;
          }
          if (!king) break;
        }
      }
    }
  }
  const moves = captures.length ? captures : chain === null ? quiet : [];
  return {...state,moves,result:moves.length ? null : turn === 'w' ? 'b' : 'w'};
}

export function step(state, move) {
  const legal = draughts(state).moves.find(m => m.from === move.from && m.to === move.to);
  if (!legal) throw new Error('Недопустимый ход');
  const {from,to,victim} = legal;
  const board = [...state.board];
  const piece = board[from];
  board[to] = (to >> 3) === (state.turn === 'w' ? 0 : 7) ? state.turn+'k' : piece;
  board[from] = null;
  const taken = victim === undefined ? [] : [...state.taken,victim];
  const next = {board,turn:state.turn,chain:to,taken,quiet:piece[1] === 'k' && !taken.length ? (state.quiet ?? 0)+1 : 0};
  if (taken.length && draughts(next).moves.length) return next;
  for (const square of taken) board[square] = null;
  return {...next,turn:state.turn === 'w' ? 'b' : 'w',chain:null,taken:[]};
}
