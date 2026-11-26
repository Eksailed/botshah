import test from 'node:test';
import assert from 'node:assert/strict';
import {createBattle,act,autoFleet,playerView} from '../src/battleship.js';
function battle(w,b,wBombs=[],bBombs=[]) {
 const game=createBattle();game.phase='battle';game.turn='w';
 game.players.w.fleet=w;game.players.b.fleet=b;
 game.players.w.bombs=wBombs;game.players.b.bombs=bBombs;
 return game;
}
test('Можно поставить от нуля до трёх бомб только на пустые уникальные клетки',()=>{
 const fleet=autoFleet();const empty=Array.from({length:100},(_,i)=>i).filter(i=>!fleet.flat().includes(i));
 for(const bombs of [[],empty.slice(0,3)])assert.deepEqual(act(createBattle(),'w',{kind:'place',fleet,bombs}).players.w.bombs,bombs);
 for(const bombs of [[fleet[0][0]],[empty[0],empty[0]],empty.slice(0,4),[-1]])assert.throws(()=>act(createBattle(),'w',{kind:'place',fleet,bombs}));
});
test('Прямой выстрел в ловушку отражается крестом на поле стрелявшего',()=>{
 const game=act(battle([[22,23],[99]],[[77]],[],[22]),'w',{kind:'shot',cell:22});
 assert.equal(game.lastAction.bombExplosions.length,1);
 assert.deepEqual(game.lastAction.bombExplosions[0].targets,[22,12,32,21,23]);
 assert.deepEqual(game.players.b.shots.sort((a,b)=>a-b),[22,23]);
 assert.deepEqual(game.players.b.bombs,[]);assert.equal(game.turn,'b');
 assert.equal(playerView(game,'w').enemyBombs,undefined);
});
test('Ответный взрыв сам по себе не активирует задетую бомбу',()=>{
 const game=act(battle([[23,24],[99]],[[77]],[12],[22]),'w',{kind:'shot',cell:22});
 assert.equal(game.lastAction.bombExplosions.length,1);assert.deepEqual(game.players.w.bombs,[12]);
 assert.equal(game.players.b.shots.includes(12),false);
});
test('Потопление корабля создаёт цепочку соседних бомб с однократным расходом',()=>{
 const game=act(battle([[24],[46],[99]],[[22],[35],[57]],[25,47],[23,36]),'w',{kind:'shot',cell:22});
 assert.equal(game.lastAction.bombExplosions.length,4);assert.equal(game.result,'w');
 assert.deepEqual(game.players.w.bombs,[]);assert.deepEqual(game.players.b.bombs,[]);
});
test('При взаимном уничтожении флотов выигрывает инициатор выстрела',()=>{
 const game=act(battle([[24]],[[22],[35]],[25],[23]),'w',{kind:'shot',cell:22});
 assert.equal(game.result,'w');assert.equal(game.lastAction.bombExplosions.length,2);
});
test('Взрыв в углу обрезается по границе, старые партии играются без ловушек',()=>{
 let game=act(battle([[99]],[[77]],[],[0]),'w',{kind:'shot',cell:0});
 assert.deepEqual(game.lastAction.bombExplosions[0].targets,[0,10,1]);
 const old=battle([[99]],[[77]],[],[0]);delete old.bombRules;
 game=act(old,'w',{kind:'shot',cell:0});assert.deepEqual(game.lastAction.bombExplosions,[]);
});
