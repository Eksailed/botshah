import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {battleshipAPI} from '../src/battleship-api.js';
import {autoFleet} from '../src/battleship.js';
function fixture(){
 const sql=new DatabaseSync(':memory:');
 sql.exec("CREATE TABLE rooms(id TEXT PRIMARY KEY,game TEXT,white INTEGER,black INTEGER,history TEXT DEFAULT '[]')");
 for(const file of readdirSync('migrations').sort()) sql.exec(readFileSync('migrations/'+file,'utf8'));
 const wrap=(query,args=[])=>({bind(...params){return wrap(query,params)},async first(){return sql.prepare(query).get(...args)??null},async all(){return {results:sql.prepare(query).all(...args)}},run(){return {meta:sql.prepare(query).run(...args)}}});
 const env={DB:{prepare:wrap,async batch(statements){sql.exec('BEGIN');try{const out=[];for(const s of statements)out.push(s.run());sql.exec('COMMIT');return out}catch(e){sql.exec('ROLLBACK');throw e}}},BOT_USERNAME:'TestBot'};
 const call=async(user,input={},id,action,method='POST')=>(await battleshipAPI(new Request('https://example.com',{method}),env,user,input,id,action)).json();
 return {sql,call};
}
test('Две сессии играют до победы, повтор хода и реванша безопасен',async()=>{
 const {call,sql}=fixture();try{
 let a=await call(11,{mode:'classic'}),id=a.id;
 await call(22,{},id,'join');
 await assert.rejects(call(33,{},id,'join'),{status:403});
 const fleetA=autoFleet(),fleetB=autoFleet();
 a=await call(11,{kind:'place',fleet:fleetA,version:a.version},id,'move');
 let b=await call(22,{},id,undefined,'GET');
 b=await call(22,{kind:'place',fleet:fleetB,version:b.version},id,'move');
 a=await call(11,{},id,undefined,'GET');
 assert.equal(a.enemyFleet,undefined);assert.equal(b.enemyFleet,undefined);
 const winner=a.turn,user=winner==='w'?11:22,targets=winner==='w'?fleetB.flat():fleetA.flat();
 let current=await call(user,{},id,undefined,'GET');
 const firstVersion=current.version;
 current=await call(user,{kind:'shot',cell:targets[0],version:current.version},id,'move');
 await assert.rejects(call(user,{kind:'shot',cell:targets[1],version:firstVersion},id,'move'),{status:409});
 for(const cell of targets.slice(1))current=await call(user,{kind:'shot',cell,version:current.version},id,'move');
 assert.equal(current.result,winner);assert.equal(sql.prepare('SELECT result FROM rooms WHERE id=?').get(id).result,winner);
 const x=await call(11,{},id,'rematch'),y=await call(22,{},id,'rematch');assert.equal(x.rematch,y.rematch);
 const fresh=await call(11,{},x.rematch,undefined,'GET');assert.equal(fresh.phase,'setup');assert.equal(fresh.fleet,null);
 }finally{sql.close()}
});
test('Передача телефона скрывает флот до подтверждения и не доверяет стороне клиента',async()=>{
 const {call,sql}=fixture();try{
 let a=await call(11,{training:'local',mode:'classic'});const id=a.id;
 assert.equal(a.handoff,true);assert.equal(a.fleet,undefined);
 await assert.rejects(call(11,{kind:'place',fleet:autoFleet(),version:a.version},id,'move'),{status:403});
 a=await call(11,{version:a.version},id,'handoff');assert.equal(a.side,'w');
 a=await call(11,{kind:'place',fleet:autoFleet(),version:a.version,side:'b'},id,'move');assert.equal(a.side,'b');assert.equal(a.handoff,true);assert.equal(a.fleet,undefined);
 a=await call(11,{version:a.version},id,'handoff');assert.equal(a.fleet,null);
 a=await call(11,{kind:'place',fleet:autoFleet(),version:a.version},id,'move');
 if(a.handoff)a=await call(11,{version:a.version},id,'handoff');
 assert.equal(a.phase,'battle');assert.ok(a.fleet);assert.equal(a.enemyFleet,undefined);
 }finally{sql.close()}
});
test('Компьютер совершает допустимые ходы и партия сохраняется',async()=>{
 const {call,sql}=fixture();try{
 let a=await call(11,{training:'normal',mode:'arsenal'});const id=a.id;
 const fleet=autoFleet(),mine=Array.from({length:100},(_,i)=>i).find(i=>!fleet.flat().includes(i));
 a=await call(11,{kind:'place',fleet,mine,version:a.version},id,'move');
 for(let i=0;i<220&&!a.result;i++){
  if(a.turn==='b')a=await call(11,{version:a.version},id,'computer');
  else{const cell=Array.from({length:100},(_,i)=>i).find(i=>!a.shots.some(s=>s.cell===i)&&!a.water.includes(i));a=await call(11,{kind:'shot',cell,version:a.version},id,'move');}
 }
 assert.ok(a.result);assert.equal((await call(11,{},id,undefined,'GET')).result,a.result);
 }finally{sql.close()}
});

test('Одновременные атаки изменяют версию только один раз',async()=>{
 const {call,sql}=fixture();
 try {
  let a=await call(11,{mode:'classic'}),id=a.id;
  await call(22,{},id,'join');
  const first=autoFleet(),second=autoFleet();
  a=await call(11,{kind:'place',fleet:first,version:a.version},id,'move');
  await call(22,{kind:'place',fleet:second,version:a.version},id,'move');
  a=await call(11,{},id,undefined,'GET');
  const user=a.turn==='w'?11:22,targets=a.turn==='w'?second.flat():first.flat();
  const results=await Promise.allSettled(targets.slice(0,2).map(cell=>call(user,{kind:'shot',cell,version:a.version},id,'move')));
  assert.equal(results.filter(result=>result.status==='fulfilled').length,1);
  assert.equal(results.find(result=>result.status==='rejected').reason.status,409);
  const current=await call(user,{},id,undefined,'GET');
  assert.equal(current.version,a.version+1);assert.equal(current.shots.length,1);
 }finally{sql.close()}
});
test('Арсенал временно отключён в новых и ранее созданных партиях',async()=>{
 const {call,sql}=fixture();try {
  let a=await call(11,{mode:'arsenal'});assert.equal(a.mode,'classic');
  const stored=sql.prepare('SELECT state FROM battleship_states WHERE room_id=?').get(a.id);
  const legacy=JSON.parse(stored.state);legacy.mode='arsenal';legacy.players.w.mine=99;legacy.players.w.blocked=true;legacy.players.w.scans=[{cell:0,count:2}];
  sql.prepare('UPDATE battleship_states SET state=? WHERE room_id=?').run(JSON.stringify(legacy),a.id);
  a=await call(11,{},a.id,undefined,'GET');assert.equal(a.mode,'classic');assert.equal(a.mine,null);assert.equal(a.blocked,false);assert.deepEqual(a.scans,[]);
 }finally{sql.close()}
});
