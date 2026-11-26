// На вход поступает только то представление поля, которое доступно игроку.
export function navalComputerMove(view, level) {
  const fired = new Set(view.shots.map(shot => shot.cell));
  const sunk = new Set(view.sunk.flat());
  const hits = view.shots.filter(shot => shot.hit && !sunk.has(shot.cell));
  const adjacent = cell => hits.some(hit => Math.abs(hit.cell-cell) === 10 ||
    Math.floor(hit.cell/10) === Math.floor(cell/10) && Math.abs(hit.cell-cell) === 1);
  const inside = (cell,scan) => cell%10 >= scan.cell%10 && cell%10 < scan.cell%10+3 &&
    Math.floor(cell/10) >= Math.floor(scan.cell/10) && Math.floor(cell/10) < Math.floor(scan.cell/10)+3;
  function score(cell) {
    if (fired.has(cell)) return 0;
    if (level === 'easy') return 1;
    if (view.scans.some(scan => scan.count === 0 && inside(cell,scan))) return .01;
    return 1 + (adjacent(cell) ? 12 : 0) +
      view.scans.filter(scan => inside(cell,scan)).reduce((sum,scan) => sum+scan.count,0);
  }
  function best(options) {
    if (level === 'easy') return options[Math.floor(Math.random()*options.length)];
    return options.reduce((chosen,option) => option.score > chosen.score ? option : chosen);
  }
  const available = Array.from({length:100}, (_,i) => i).filter(cell => !fired.has(cell));
  if (!available.length) throw new Error('Нет доступных целей');
  const arsenal = view.mode === 'arsenal' && !view.blocked;
  if (arsenal && view.stock.scan && (view.scans.length === 0 || fired.size >= 20 && view.scans.length === 1)) {
    const options=[];
    for (let row=0;row<8;row++) for (let col=0;col<8;col++) {
      const cell=row*10+col;
      if (view.scans.some(scan => scan.cell === cell)) continue;
      const cells=Array.from({length:9},(_,i)=>cell+Math.floor(i/3)*10+i%3);
      options.push({kind:'scan',cell,score:cells.reduce((sum,n)=>sum+score(n),0)});
    }
    return best(options);
  }
  if (arsenal && view.stock.plane && fired.size >= 3) {
    const options=[];
    for (let cell=0;cell<100;cell++) for (const direction of ['horizontal','vertical']) {
      if (direction === 'horizontal' ? cell%10>7 : cell>79) continue;
      const step=direction === 'horizontal' ? 1 : 10;
      options.push({kind:'plane',cell,direction,score:score(cell)+score(cell+step)+score(cell+2*step)});
    }
    return best(options);
  }
  if (arsenal && view.stock.torpedo && fired.size >= 6) {
    const options=[];
    for (let line=0;line<10;line++) for (const edge of ['top','bottom','left','right']) {
      const vertical=edge==='top'||edge==='bottom', reverse=edge==='bottom'||edge==='right';
      const cell=vertical?(reverse?90:0)+line:line*10+(reverse?9:0);
      const cells=Array.from({length:10},(_,i)=>cell+i*(vertical?10:1)*(reverse?-1:1));
      options.push({kind:'torpedo',cell,edge,score:cells.reduce((sum,n,i)=>sum+score(n)/(i+1),0)});
    }
    return best(options);
  }
  return best(available.map(cell=>({kind:'shot',cell,score:score(cell)})));
}
