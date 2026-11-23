import { setTimeout as delay } from 'node:timers/promises';

export async function runBot(token,url) {
  async function call(method,data) {
    const response = await fetch('https://api.telegram.org/bot'+token+'/'+method,{
      method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data),
      signal:AbortSignal.timeout(40000)
    });
    const payload = await response.json();
    if (!payload.ok) throw new Error(method+': Telegram вернул '+payload.error_code);
    return payload.result;
  }

  let offset = 0;
  for (;;) {
    try {
      const updates = await call('getUpdates',{offset,timeout:25,allowed_updates:['message']});
      for (const {update_id,message} of updates) {
        if (message?.chat.type === 'private' && /^\/start(?:@\w+)?(?:\s|$)/.test(message.text ?? '')) {
          await call('sendMessage',{chat_id:message.chat.id,text:'Выберите шахматы или шашки и пригласите друга.',
            reply_markup:{inline_keyboard:[[{text:'Играть',web_app:{url}}]]}});
        }
        offset = update_id+1;
      }
    } catch (error) {
      console.error('Связь с Telegram: '+error.message);
      await delay(3000);
    }
  }
}
