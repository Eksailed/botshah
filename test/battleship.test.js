import test from 'node:test';
import assert from 'node:assert/strict';
import {autoFleet,validateFleet,createBattle,act,playerView} from '../src/battleship.js';
test('Флот содержит 20 палуб и не касается соседей',()=>{
 for(let i=0;i<30;i++){const fleet=autoFleet();assert.equal(fleet.flat().length,20);assert.ok(validateFleet(fleet));}
 assert.throws(()=>validateFleet([[0,1,2,3],[4,5,6]]));
});
test('Попадание сохраняет очередь, промах передаёт, секреты скрыты',()=>{
 let game=createBattle('classic');
 game=act(game,'w',{kind:'place',fleet:autoFleet()});
 game=act(game,'b',{kind:'place',fleet:autoFleet()});
 const side=game.turn, enemy=side==='w'?'b':'w';
 const hit=game.players[enemy].fleet[0][0];
 game=act(game,side,{kind:'shot',cell:hit});
 assert.equal(game.turn,side);
 assert.throws(()=>act(game,side,{kind:'shot',cell:hit}));
 const miss=Array.from({length:100},(_,i)=>i).find(i=>!game.players[enemy].fleet.flat().includes(i));
 game=act(game,side,{kind:'shot',cell:miss});
 assert.equal(game.turn,enemy);
 assert.equal(playerView(game,side).enemyFleet,undefined);
 assert.equal(JSON.stringify(playerView(game,side)).includes('"players"'),false);
});
test('Арсенал расходуется один раз, сканер не открывает клетки',()=>{
 let game=createBattle('arsenal');
 const firstFleet=autoFleet();
 const firstMine=Array.from({length:100},(_,i)=>i).find(i=>!firstFleet.flat().includes(i));
 game=act(game,'w',{kind:'place',fleet:firstFleet,mine:firstMine});
 const fleet=autoFleet();const mine=Array.from({length:100},(_,i)=>i).find(i=>!fleet.flat().includes(i));
 game=act(game,'b',{kind:'place',fleet,mine});
 const side=game.turn;
 game=act(game,side,{kind:'scan',cell:0});
 assert.equal(game.players[side].stock.scan,1);
 assert.equal(game.players[side].shots.length,0);
 assert.notEqual(game.turn,side);
});

test('Самолёт, торпеда и мина соблюдают запас и очередность',()=>{
 let game=createBattle('arsenal');
 const fleetA=autoFleet(),fleetB=autoFleet();
 const mineA=Array.from({length:100},(_,i)=>i).find(i=>!fleetA.flat().includes(i));
 const mineB=Array.from({length:100},(_,i)=>i).find(i=>!fleetB.flat().includes(i));
 game=act(game,'w',{kind:'place',fleet:fleetA,mine:mineA});
 game=act(game,'b',{kind:'place',fleet:fleetB,mine:mineB});
 const side=game.turn,enemy=side==='w'?'b':'w';
 const mine=game.players[enemy].mine;
 game=act(game,side,{kind:'shot',cell:mine});
 assert.equal(game.players[side].blocked,true);assert.equal(game.turn,enemy);
 const otherMine=game.players[side].mine;
 game=act(game,enemy,{kind:'shot',cell:otherMine});
 assert.equal(game.turn,side);
 assert.throws(()=>act(game,side,{kind:'plane',cell:0,direction:'horizontal'}));
 const target=Array.from({length:100},(_,i)=>i).find(i=>i!==mine);
 game=act(game,side,{kind:'shot',cell:target});
 assert.equal(game.players[side].blocked,false);
 game.turn=side;
 const oldShots=game.players[side].shots.length;
 assert.throws(()=>act(game,side,{kind:'plane',cell:9,direction:'horizontal'}));
 assert.equal(game.players[side].stock.plane,1);
 game=act(game,side,{kind:'plane',cell:0,direction:'horizontal'});
 assert.equal(game.players[side].stock.plane,0);assert.equal(game.turn,enemy);
 assert.ok(game.players[side].shots.length>=oldShots);
 game.turn=side;
 const expected=Array.from({length:10},(_,i)=>i).find(n=>game.players[enemy].fleet.flat().includes(n)&&!game.players[side].shots.includes(n));
 game=act(game,side,{kind:'torpedo',cell:0,edge:'left'});
 if(expected!==undefined)assert.equal(game.lastAction.targets.at(-1),expected);
 assert.equal(game.players[side].stock.torpedo,0);
});

test('Сканирование соперника скрывает область, после конца флот открыт',()=>{
 let game=createBattle('arsenal');
 for(const side of ['w','b']){const fleet=autoFleet();const mine=Array.from({length:100},(_,i)=>i).find(i=>!fleet.flat().includes(i));game=act(game,side,{kind:'place',fleet,mine});}
 const side=game.turn,enemy=side==='w'?'b':'w';
 game=act(game,side,{kind:'scan',cell:0});
 assert.equal(playerView(game,enemy).lastAction.targets,undefined);
 game.result=side;assert.ok(playerView(game,side).enemyFleet);
});

test('Результат атаки различает попадание, потопление и промах',()=>{
 let game=createBattle();
 for(const side of ['w','b'])game=act(game,side,{kind:'place',fleet:autoFleet()});
 const side=game.turn,enemy=side==='w'?'b':'w';
 const single=game.players[enemy].fleet.find(ship=>ship.length===1)[0];
 game=act(game,side,{kind:'shot',cell:single});
 assert.equal(game.lastAction.hitCount,1);assert.equal(game.lastAction.sunkCount,1);
 const miss=Array.from({length:100},(_,i)=>i).find(cell=>!game.players[enemy].fleet.flat().includes(cell)&&!playerView(game,side).water.includes(cell));
 game=act(game,side,{kind:'shot',cell:miss});
 assert.equal(game.lastAction.hitCount,0);assert.equal(game.lastAction.sunkCount,0);
});

test('Вода вокруг потопленного корабля отмечается, включая углы и границы поля',()=>{
 let game=createBattle();
 for(const side of ['w','b'])game=act(game,side,{kind:'place',fleet:autoFleet()});
 const side=game.turn,enemy=side==='w'?'b':'w';
 const ship=game.players[enemy].fleet[0];
 for(const cell of ship)game=act(game,side,{kind:'shot',cell});
 const water=playerView(game,side).water;
 const expected=Array.from({length:100},(_,i)=>i).filter(cell=>!ship.includes(cell)&&ship.some(n=>Math.abs(cell%10-n%10)<=1&&Math.abs(Math.floor(cell/10)-Math.floor(n/10))<=1));
 assert.deepEqual([...water].sort((a,b)=>a-b),expected);
 assert.equal(game.turn,side);
 assert.throws(()=>act(game,side,{kind:'shot',cell:water[0]}));
 assert.ok(playerView(game,enemy).incomingWater.includes(water[0]));
 assert.ok(!water.some(cell=>game.players[enemy].fleet.flat().includes(cell)));
});

test('Раненый корабль скрывает окрестности, потопленный у угла отмечает только допустимые клетки',()=>{
 let game=createBattle();game.phase='battle';game.turn='w';
 game.players.w.fleet=[[99]];game.players.b.fleet=[[0,1]];
 game=act(game,'w',{kind:'shot',cell:0});assert.deepEqual(playerView(game,'w').water,[]);
 game=act(game,'w',{kind:'shot',cell:1});assert.deepEqual(playerView(game,'w').water,[2,10,11,12]);
 assert.deepEqual(game.players.w.shots,[0,1]);assert.equal(game.turn,'w');
});
