import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { once } from 'node:events';
import { application } from '../src/server.js';
import { rooms } from '../src/rooms.js';

test('Два игрока получают одну позицию через API в обеих играх', async () => {
  const token = 'test-token';
  const store = rooms(':memory:');
  const server = application({token,username:'example_bot',store});
  server.listen(0,'127.0.0.1');
  await once(server,'listening');
  const base = 'http://127.0.0.1:'+server.address().port;
  const secret = createHmac('sha256','WebAppData').update(token).digest();
  function request(path,id,body) {
    const data = new URLSearchParams({auth_date:String(Math.floor(Date.now()/1000)),user:JSON.stringify({id})});
    data.set('hash',createHmac('sha256',secret).update([...data].map(pair => pair.join('=')).join('\n')).digest('hex'));
    return fetch(base+path,{method:body === undefined ? 'GET' : 'POST',
      headers:{'X-Telegram-Init-Data':String(data)},body:JSON.stringify(body)});
  }
  try {
    const page = await fetch(base+'/');
    assert.match(await page.text(),/Игровая доска/);
    assert.equal((await fetch(base+'/app.js')).status,200);
    assert.equal((await fetch(base+'/api/rooms',{method:'POST'})).status,401);
    for (const game of ['chess','draughts']) {
      const created = await (await request('/api/rooms',1,{game})).json();
      const path = '/api/rooms/'+created.id;
      assert.equal(new URL(created.invite).searchParams.get('startapp'),created.id);
      const joined = await (await request(path+'/join',2,{})).json();
      assert.equal(joined.side,'b');
      assert.equal((await request(path+'/join',3,{})).status,403);
      const white = await (await request(path,1)).json();
      const move = white.moves[0];
      const played = await request(path+'/move',1,{...move,version:0});
      assert.equal(played.status,200);
      const black = await (await request(path,2)).json();
      assert.equal(black.version,1);
      assert.equal(black.turn,'b');
      assert.deepEqual(black.board,(await played.json()).board);
    }
  } finally {
    await new Promise(resolve => server.close(resolve));
    store.close();
  }
});
