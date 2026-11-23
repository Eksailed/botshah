import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash, createHmac } from 'node:crypto';
import { rooms } from '../src/rooms.js';
import { verifyLaunch } from '../src/telegram.js';

test('Третий игрок, очередь, версия, повторный вход и перезапуск', () => {
  const dir = mkdtempSync(join(tmpdir(),'botshah-'));
  const path = join(dir,'rooms.db');
  let db = rooms(path);
  try {
    const {id} = db.create('chess',1);
    db.join(id,2);
    assert.throws(() => db.join(id,3), {status:403});
    assert.throws(() => db.move(id,2,{version:0,from:12,to:28}), {status:403});
    db.move(id,1,{version:0,from:52,to:36});
    assert.throws(() => db.move(id,2,{version:0,from:12,to:28}), {status:409});
    db.close();
    db = rooms(path);
    const state = db.join(id,1);
    assert.equal(state.side,'w');
    assert.equal(state.board[36],'wp');
    assert.equal(state.version,1);
  } finally {
    db.close();
    rmSync(dir,{recursive:true,force:true});
  }
});

test('Подпись и срок данных запуска Telegram', () => {
  const token = 'test-token';
  const sign = timestamp => {
    const data = new URLSearchParams({auth_date:String(timestamp),user:'{"id":42}'});
    const secret = createHmac('sha256','WebAppData').update(token).digest();
    data.set('hash',createHmac('sha256',secret).update([...data].map(pair => pair.join('=')).join('\n')).digest('hex'));
    return data;
  };
  const now = Math.floor(Date.now()/1000);
  const valid = sign(now);
  assert.equal(verifyLaunch(String(valid),token),42);
  valid.set('hash',createHash('sha256').update('different').digest('hex'));
  assert.throws(() => verifyLaunch(String(valid),token),{status:401});
  assert.throws(() => verifyLaunch(String(sign(now-86401)),token),{status:401});
});
