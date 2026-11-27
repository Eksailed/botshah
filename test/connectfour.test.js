import test from 'node:test';
import assert from 'node:assert/strict';
import {connectFour,bestConnectFourMove} from '../src/connectfour.js';

function play(columns) {
  const history = [];
  for (const column of columns) {
    const move = connectFour(history).moves.find(item => item.to % 7 === column);
    assert.ok(move);
    history.push(move);
  }
  return connectFour(history);
}

test('Фишки падают вниз, проход через занятые клетки невозможен', () => {
  assert.deepEqual(play([0,0,0,0,0,0]).moves.map(move => move.to),[36,37,38,39,40,41]);
  assert.throws(() => connectFour([{from:0,to:0}]));
});

test('Четыре фишки выигрывают по горизонтали, вертикали и обеим диагоналям', () => {
  for (const columns of [[0,0,1,1,2,2,3],[0,1,0,1,0,1,0],[0,1,1,2,4,2,2,3,4,3,5,3,3],[6,5,5,4,2,4,4,3,2,3,1,3,3]]) {
    const state = play(columns);
    assert.equal(state.result,'w');
    assert.equal(state.winningCells.length,4);
    assert.deepEqual(state.moves,[]);
  }
});

test('Компьютер завершает свою линию или блокирует победный ход соперника', () => {
  assert.equal(bestConnectFourMove(play([0,6,1,6,2,5])).to,38);
  assert.equal(bestConnectFourMove(play([0,6,1,6,2])).to,38);
});

test('В больших крестиках-ноликах четыре знака не завершают партию, а пять побеждают', () => {
  const history = [0,10,1,11,2,12,3].map(to=>({from:to,to}));
  assert.equal(connectFour(history,true).result,null);
  assert.equal(bestConnectFourMove(connectFour(history,true),true).to,4);
  history.push({from:20,to:20},{from:4,to:4});
  const result = connectFour(history,true);
  assert.equal(result.result,'w');
  assert.deepEqual(result.winningCells,[0,1,2,3,4]);
});
