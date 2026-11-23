import test from 'node:test';
import assert from 'node:assert/strict';
import { position } from '../src/games.js';
import { draughts, step } from '../src/draughts.js';

test('Начальная шахматная позиция', () => assert.equal(position('chess', []).moves.length, 20));
test('Превращение пешки', () => {
  assert.equal(position('chess', [], '7k/P7/8/8/8/8/8/7K w - - 0 1').moves.filter(m => m.from === 8).length, 4);
});
test('Обязательное взятие и серия взятий', () => {
  const board = Array(64).fill(null);
  Object.assign(board, {41:'wp', 34:'bp', 20:'bp', 47:'wp'});
  const state = {board, turn:'w', chain:null, taken:[]};
  assert.deepEqual(draughts(state).moves.map(m => [m.from,m.to]), [[41,27]]);
  const mid = step(state, {from:41,to:27});
  assert.equal(mid.turn,'w');
  assert.equal(step(mid,{from:27,to:13}).turn,'b');
});
