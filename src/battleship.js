const sizes = [4,3,3,2,2,2,1,1,1,1];
const other = side => side === 'w' ? 'b' : 'w';
const cellOK = n => Number.isInteger(n) && n >= 0 && n < 100;
const requireRule = (ok,message) => { if (!ok) throw new Error(message); };
const adjacent = (a,b) => Math.abs(a%10-b%10) <= 1 && Math.abs(Math.floor(a/10)-Math.floor(b/10)) <= 1;

export function validateFleet(fleet) {
  requireRule(Array.isArray(fleet) && fleet.length === 10,'Нужны десять кораблей');
  requireRule(JSON.stringify(fleet.map(s=>Array.isArray(s)?s.length:0).sort((a,b)=>b-a)) === JSON.stringify(sizes),'Неверный состав флота');
  const occupied = [];
  for (const ship of fleet) {
    requireRule(ship.every(cellOK) && new Set(ship).size === ship.length,'Корабль за границей поля');
    const sorted = [...ship].sort((a,b)=>a-b);
    const horizontal = sorted.every(n=>Math.floor(n/10) === Math.floor(sorted[0]/10));
    requireRule(sorted.every((n,i)=>!i || n-sorted[i-1] === (horizontal ? 1 : 10)),'Корабль должен быть прямым');
    requireRule(!ship.some(n=>occupied.some(old=>adjacent(n,old))),'Корабли соприкасаются');
    occupied.push(...ship);
  }
  return true;
}

export function autoFleet() {
  for (;;) {
    const fleet = [];
    for (const size of sizes) {
      const options = [];
      for (let cell=0;cell<100;cell++) for (const step of [1,10]) {
        const ship = Array.from({length:size},(_,i)=>cell+i*step);
        if (!ship.every(cellOK) || (step===1 && Math.floor(ship.at(-1)/10)!==Math.floor(cell/10))) continue;
        if (ship.some(n=>fleet.flat().some(old=>adjacent(n,old)))) continue;
        options.push(ship);
      }
      if (!options.length) break;
      fleet.push(options[Math.floor(Math.random()*options.length)]);
    }
    if (fleet.length===10) return fleet;
  }
}

export function createBattle(mode='classic',turnRule='until-miss') {
  requireRule(['until-miss','alternating'].includes(turnRule),'Выберите очередь выстрелов');
  requireRule(['classic','arsenal'].includes(mode),'Неизвестный режим');
  const player = () => ({fleet:null,mine:null,bombs:[],spentBombs:[],shots:[],scans:[],blocked:false,stock:{plane:1,torpedo:1,scan:2}});
  return {mode,turnRule,bombRules:1,phase:'setup',turn:Math.random()<.5?'w':'b',players:{w:player(),b:player()},result:null,version:0};
}

function surroundingWater(fleet,shots) {
  const sunk=(fleet??[]).filter(ship=>ship.every(cell=>shots.includes(cell))).flat();
  return Array.from({length:100},(_,cell)=>cell).filter(cell=>!sunk.includes(cell)&&sunk.some(deck=>adjacent(cell,deck)));
}

export function autoBombs(fleet) {
  const cells=Array.from({length:100},(_,cell)=>cell).filter(cell=>!fleet.flat().includes(cell));
  const bombs=[];
  while(bombs.length<3)bombs.push(cells.splice(Math.floor(Math.random()*cells.length),1)[0]);
  return bombs;
}

function resolveBombs(game,original,shooter,kind,targets) {
  if(game.bombRules!==1)return [];
  const pending=[],explosions=[];
  const alreadySunk={};
  for(const owner of ['w','b']){
    const old=original.players[other(owner)].shots;
    alreadySunk[owner]=new Set(game.players[owner].fleet.filter(ship=>ship.every(cell=>old.includes(cell))).map(ship=>ship.join('-')));
  }
  function activate(owner,cell) {
    const player=game.players[owner],index=(player.bombs??[]).indexOf(cell);
    if(index===-1)return;
    player.bombs.splice(index,1);
    player.spentBombs??=[];player.spentBombs.push(cell);
    pending.push({owner,cell});
  }
  function activateNearSunk(owner) {
    const player=game.players[owner],shots=game.players[other(owner)].shots;
    for(const ship of player.fleet){
      const key=ship.join('-');
      if(alreadySunk[owner].has(key)||!ship.every(cell=>shots.includes(cell)))continue;
      alreadySunk[owner].add(key);
      for(const cell of [...(player.bombs??[])])if(ship.some(deck=>adjacent(cell,deck)))activate(owner,cell);
    }
  }
  const victim=other(shooter);
  if(kind==='shot')for(const cell of targets)activate(victim,cell);
  activateNearSunk(victim);
  for(let index=0;index<pending.length;index++){
    const {owner,cell}=pending[index],target=other(owner);
    const shots=game.players[owner].shots,fleet=game.players[target].fleet;
    const area=[cell,cell-10,cell+10,cell-1,cell+1].filter(candidate=>cellOK(candidate)&&Math.abs(candidate%10-cell%10)+Math.abs(Math.floor(candidate/10)-Math.floor(cell/10))=== (candidate===cell?0:1));
    const sunkBefore=fleet.filter(ship=>ship.every(deck=>shots.includes(deck)));
    const hitCells=area.filter(candidate=>fleet.flat().includes(candidate));
    const newHits=hitCells.filter(candidate=>!shots.includes(candidate));
    // Вода после ответного взрыва остаётся доступной для прямого выстрела в ловушку.
    shots.push(...newHits);
    const sunkShips=fleet.filter(ship=>ship.every(deck=>shots.includes(deck))&&!sunkBefore.includes(ship));
    explosions.push({owner,cell,side:owner,targets:area,hitCells,hitCount:newHits.length,sunkShips});
    activateNearSunk(target);
  }
  return explosions;
}

export function act(original,side,action) {
  requireRule(side==='w'||side==='b','Неизвестный игрок');
  const game=structuredClone(original), player=game.players[side], enemy=game.players[other(side)];
  requireRule(!game.result,'Партия закончилась');
  if(action.kind==='place') {
    requireRule(game.phase==='setup' && !player.fleet,'Расстановка закрыта');
    validateFleet(action.fleet);
    if(game.mode==='arsenal') requireRule(cellOK(action.mine) && !action.fleet.flat().includes(action.mine),'Выберите пустую клетку для мины');
    const bombs=action.bombs??[];
    requireRule(Array.isArray(bombs)&&bombs.length<=3&&bombs.every(cellOK)&&new Set(bombs).size===bombs.length,'Разместите от нуля до трёх бомб в разных клетках');
    requireRule(game.bombRules===1||bombs.length===0,'В этой партии бомбы недоступны');
    requireRule(!bombs.some(cell=>action.fleet.flat().includes(cell)),'Бомбу нельзя ставить на корабль');
    player.bombs=[...bombs];player.spentBombs=[];
    player.fleet=action.fleet.map(s=>[...s]);
    player.mine=game.mode==='arsenal'?action.mine:null;
    if(enemy.fleet)game.phase='battle';
  } else {
    requireRule(game.phase==='battle' && game.turn===side,'Дождитесь своего хода');
    const kind=action.kind, origin=action.cell;
    requireRule(cellOK(origin),'Выберите клетку');
    const special=kind!=='shot';
    requireRule(['shot','plane','torpedo','scan'].includes(kind),'Неизвестное действие');
    requireRule(!special || (game.mode==='arsenal' && !player.blocked && player.stock[kind]>0),'Усиление недоступно');
    let targets=[origin];
    if(kind==='plane'||kind==='scan') {
      const width=kind==='scan'||action.direction!=='vertical'?3:1;
      const height=kind==='scan'||action.direction==='vertical'?3:1;
      requireRule(origin%10+width<=10 && Math.floor(origin/10)+height<=10,'Область выходит за край');
      targets=Array.from({length:height},(_,r)=>Array.from({length:width},(_,c)=>origin+r*10+c)).flat();
    }
    if(kind==='torpedo') {
      requireRule(['top','bottom','left','right'].includes(action.edge),'Выберите край');
      const vertical=['top','bottom'].includes(action.edge), reverse=['bottom','right'].includes(action.edge);
      requireRule(vertical ? Math.floor(origin/10)===(reverse?9:0) : origin%10===(reverse?9:0),'Начните торпеду от края');
      targets=[];
      for(let i=0;i<10;i++){
        const n=origin+i*(vertical?10:1)*(reverse?-1:1);
        targets.push(n);
        if((n===enemy.mine && !player.shots.includes(n)) || (enemy.fleet.flat().includes(n)&&!player.shots.includes(n))) break;
      }
    }
    const sunkBefore=enemy.fleet.filter(ship=>ship.every(cell=>player.shots.includes(cell))).length;
    let hit=false,mine=false,hitCount=0;
    if(kind==='scan') {
      player.scans.push({cell:origin,count:targets.filter(n=>enemy.fleet.flat().includes(n)&&!player.shots.includes(n)).length,version:game.version+1});
    } else {
      if(!special) requireRule(!player.shots.includes(origin)&&!surroundingWater(enemy.fleet,player.shots).includes(origin),'Эта клетка уже отмечена');
      for(const n of targets) {
        if(player.shots.includes(n))continue;
        player.shots.push(n);
        const damaged=enemy.fleet.flat().includes(n);
        if(damaged)hitCount++;
        hit ||= damaged;
        mine ||= n===enemy.mine;
      }
    }
    if(special)player.stock[kind]--;
    player.blocked=mine;
    if(!special&&!mine)player.blocked=false;
    const bombExplosions=resolveBombs(game,original,side,kind,targets);
    if(enemy.fleet.flat().every(n=>player.shots.includes(n)))game.result=side;
    else if(player.fleet.flat().every(n=>enemy.shots.includes(n)))game.result=other(side);
    if(game.result)game.phase='finished';
    else if(game.turnRule==='alternating'||special||!hit||mine)game.turn=other(side);
    const sunkAfter=enemy.fleet.filter(ship=>ship.every(cell=>player.shots.includes(cell))).length;
    const sunkShips=enemy.fleet.filter(ship=>ship.every(cell=>player.shots.includes(cell))&&!ship.every(cell=>original.players[side].shots.includes(cell)));
    game.lastAction={side,kind,targets,version:game.version+1,hitCount,sunkCount:sunkAfter-sunkBefore,sunkShips,mineTriggered:mine,bombExplosions};
    if (kind === 'shot') {
      const prior = game.battleLog ?? (original.lastAction?.kind === 'shot' ? [original.lastAction] : []);
      game.battleLog = [...prior, game.lastAction].slice(-20);
    }
  }
  game.version++;
  return game;
}

export function playerView(game,side) {
  const player=game.players[side],enemy=game.players[other(side)];
  const sunk=(enemy.fleet??[]).filter(ship=>ship.every(n=>player.shots.includes(n)));
  return {phase:game.phase,mode:game.mode,turnRule:game.turnRule??'until-miss',turn:game.turn,result:game.result,version:game.version,
    bombsEnabled:game.bombRules===1,bombs:game.bombRules===1?(player.bombs??[]):[],spentBombs:game.bombRules===1?(player.spentBombs??[]):[],enemySpentBombs:game.bombRules===1?(enemy.spentBombs??[]):[],
    placed:Boolean(player.fleet),opponentReady:Boolean(enemy.fleet),fleet:player.fleet,mine:player.mine,
    incoming:enemy.shots,shots:player.shots.map(cell=>({cell,hit:enemy.fleet?.flat().includes(cell)??false})),
    water:surroundingWater(enemy.fleet,player.shots),incomingWater:surroundingWater(player.fleet,enemy.shots),
    battleLog:game.battleLog ?? (game.lastAction?.kind === 'shot' ? [game.lastAction] : []),
    sunk,scans:player.scans,stock:player.stock,blocked:player.blocked,
    ...(game.result?{enemyFleet:enemy.fleet}:{}),lastAction:game.lastAction?.kind === 'scan' && game.lastAction.side !== side ? {side:game.lastAction.side,kind:'scan'} : game.lastAction};
}
