const columns = 7;
const rows = 6;
const other = side => side === 'w' ? 'b' : 'w';

function landing(board,column) {
  for (let row=rows-1; row>=0; row--) {
    const cell = row*columns+column;
    if (!board[cell]) return cell;
  }
  return -1;
}

function lineAt(board,cell,columns = 7,rows = 6) {
  const side = board[cell], row = Math.floor(cell/columns), column = cell%columns;
  for (const [dy,dx] of [[0,1],[1,0],[1,1],[1,-1]]) {
    const line = [cell];
    for (const sign of [-1,1]) {
      for (let r=row+dy*sign,c=column+dx*sign; r>=0 && r<rows && c>=0 && c<columns; r+=dy*sign,c+=dx*sign) {
        const next = r*columns+c;
        if (board[next] !== side) break;
        if (sign < 0) line.unshift(next);
        else line.push(next);
      }
    }
    if (line.length >= (columns === 10 ? 5 : 4)) return line;
  }
  return [];
}

export function connectFour(history,freePlacement = false) {
  const columns = freePlacement ? 10 : 7;
  const rows = freePlacement ? 10 : 6;
  const board = Array(rows*columns).fill(null);
  let turn = 'w', winningCells = [];
  for (const {from,to} of history) {
    if (winningCells.length || !Number.isInteger(to) || to<0 || to>=board.length ||
        from!==to || (freePlacement ? board[to] : landing(board,to%columns)!==to)) throw new Error('Недопустимый ход в игре «Четыре в ряд»');
    board[to] = turn;
    winningCells = lineAt(board,to,columns,rows);
    turn = other(turn);
  }
  const result = winningCells.length ? other(turn) : board.every(Boolean) ? 'draw' : null;
  const moves = result ? [] : freePlacement
    ? board.flatMap((piece,to) => piece ? [] : [{from:to,to}])
    : Array.from({length:columns},(_,column)=>landing(board,column))
    .filter(to=>to>=0).map(to=>({from:to,to}));
  return {board,turn,result,moves,winningCells};
}

export function bestConnectFourMove({board,turn,moves},freePlacement = false) {
  const columns = freePlacement ? 10 : 7;
  const rows = freePlacement ? 10 : 6;
  const distance = cell => Math.abs(cell%columns-(columns-1)/2) +
    (freePlacement ? Math.abs(Math.floor(cell/columns)-(rows-1)/2) : 0);
  const wins = (move,side) => {
    const trial = [...board];
    trial[move.to] = side;
    return lineAt(trial,move.to,columns,rows).length > 0;
  };
  const center = [...moves].sort((a,b)=>distance(a.to)-distance(b.to));
  return center.find(move=>wins(move,turn)) ?? center.find(move=>wins(move,other(turn))) ?? center[0];
}
