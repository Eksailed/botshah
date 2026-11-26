const lines = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];
const other = side => side === 'w' ? 'b' : 'w';
const winningCells = board => lines.find(([a,b,c]) => board[a] && board[a] === board[b] && board[b] === board[c]);

export function ticTacToe(history) {
  const board = Array(9).fill(null);
  let turn = 'w';
  for (const move of history) {
    if (move.from !== move.to || !Number.isInteger(move.to) || move.to < 0 || move.to >= 9 || board[move.to] || winningCells(board)) {
      throw new Error('Недопустимый ход в крестиках-ноликах');
    }
    board[move.to] = turn;
    turn = other(turn);
  }
  const line = winningCells(board);
  const result = line ? board[line[0]] : board.every(Boolean) ? 'draw' : null;
  const moves = result ? [] : board.flatMap((piece,to) => piece ? [] : [{from:to,to}]);
  return {board,turn,result,moves,winningCells:line ?? []};
}

export function bestTicTacToeMove({board,turn,moves}) {
  const trial = [...board];
  const cache = new Map();
  function value(side) {
    const line = winningCells(trial);
    if (line) return trial[line[0]] === side ? 1 : -1;
    if (trial.every(Boolean)) return 0;
    const key = side+trial.map(piece => piece ?? '-').join('');
    if (cache.has(key)) return cache.get(key);
    let best = -1;
    for (let i=0; i<trial.length; i++) {
      if (trial[i]) continue;
      trial[i] = side;
      best = Math.max(best,-value(other(side)));
      trial[i] = null;
      if (best === 1) break;
    }
    cache.set(key,best);
    return best;
  }
  let chosen = moves[0];
  let best = -2;
  for (const move of moves) {
    trial[move.to] = turn;
    const score = -value(other(turn));
    trial[move.to] = null;
    if (score > best) { best = score; chosen = move; }
    if (score === 1) break;
  }
  return chosen;
}
