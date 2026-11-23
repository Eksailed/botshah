import { createServer } from 'node:http';
import { readFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { rooms } from './rooms.js';
import { fail, verifyLaunch } from './telegram.js';
import { runBot } from './bot.js';

const assets = new Map([
  ['/',['index.html','text/html']],
  ['/app.js',['app.js','text/javascript']],
  ['/style.css',['style.css','text/css']],
  ['/club-art.png',['club-art.png','image/png']],
  ['/fonts/lora.ttf',['fonts/lora.ttf','font/ttf']],
  ['/fonts/golostext.ttf',['fonts/golostext.ttf','font/ttf']]
]);

export function application({token, username, store}) {
  return createServer(async (req,res) => {
    const json = (status,data) => {
      res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});
      res.end(JSON.stringify(data));
    };
    try {
      const path = new URL(req.url,'http://localhost').pathname;
      if (req.method === 'GET' && assets.has(path)) {
        const [file,type] = assets.get(path);
        const content = readFileSync(new URL('../public/'+file,import.meta.url));
        res.writeHead(200,{'Content-Type':type.startsWith('text/') ? type+'; charset=utf-8' : type});
        return res.end(content);
      }
      if (!path.startsWith('/api/')) fail(404,'Страница не найдена');
      const user = verifyLaunch(req.headers['x-telegram-init-data'],token);
      const match = /^\/api\/rooms\/([a-f0-9]{24})(?:\/(join|move))?$/.exec(path);
      let input = {};
      if (req.method === 'POST') {
        let body = '';
        for await (const chunk of req) {
          body += chunk;
          if (body.length > 4096) {
            json(413,{error:'Слишком большой запрос'});
            return;
          }
        }
        try { input = body ? JSON.parse(body) : {}; } catch { fail(400,'Некорректный запрос'); }
        if (!input || typeof input !== 'object' || Array.isArray(input)) fail(400,'Некорректный запрос');
      }
      let state;
      if (path === '/api/rooms' && req.method === 'POST') state = store.create(input.game,user);
      else if (match && req.method === 'GET' && !match[2]) state = store.read(match[1],user);
      else if (match?.[2] === 'join' && req.method === 'POST') state = store.join(match[1],user);
      else if (match?.[2] === 'move' && req.method === 'POST') state = store.move(match[1],user,input);
      else fail(404,'Запрос не найден');
      json(200,{...state,invite:'https://t.me/'+username+'?startapp='+state.id});
    } catch (error) {
      if (!error.status) console.error(error);
      json(error.status ?? 500,{error:error.status ? error.message : 'Ошибка сервера'});
    }
  });
}

if (import.meta.main) {
  const {BOT_TOKEN:token,BOT_USERNAME:username,APP_URL:url,PORT:port='3000',DATABASE_FILE:path='data/rooms.sqlite'} = process.env;
  if (!token || !/^[A-Za-z0-9_]+$/.test(username ?? '') || !url || new URL(url).protocol !== 'https:') {
    throw new Error('Укажите BOT_TOKEN, BOT_USERNAME и HTTPS адрес APP_URL в .env');
  }
  mkdirSync(dirname(path),{recursive:true});
  application({token,username,store:rooms(path)}).listen(Number(port),() => console.log('Mini App запущено на порту '+port));
  await runBot(token,url);
}
