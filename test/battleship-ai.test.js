import test from 'node:test';
import assert from 'node:assert/strict';
import {createBattle,autoFleet,act,playerView} from '../src/battleship.js';
import {navalComputerMove} from '../src/battleship-ai.js';
function battle(){let state=createBattle('arsenal');for(const side of ['w','b']){const fleet=autoFleet();const mine=Array.from({length:100},(_,i)=>i).find(n=>!fleet.flat().includes(n));state=act(state,side,{kind:'place',fleet,mine});}return state;}
test('Компьютер применяет весь арсенал и завершает партию допустимыми действиями',()=>{
 let state=battle();const kinds=new Set();
 for(let i=0;i<250&&!state.result;i++){
  const side=state.turn;
  const move=navalComputerMove(playerView(state,side),'normal');
  kinds.add(move.kind);state=act(state,side,move);
 }
 assert.ok(state.result);for(const kind of ['shot','scan','plane','torpedo'])assert.ok(kinds.has(kind),kind);
});
test('Блокировка и классика запрещают усиления, одинаковые сведения дают одинаковое решение',()=>{
 const state=battle(),view=playerView(state,state.turn);
 view.blocked=true;assert.equal(navalComputerMove(view,'normal').kind,'shot');
 view.blocked=false;view.mode='classic';assert.equal(navalComputerMove(view,'normal').kind,'shot');
 assert.deepEqual(navalComputerMove(view,'normal'),navalComputerMove(structuredClone(view),'normal'));
});
