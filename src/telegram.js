import { createHmac, timingSafeEqual } from 'node:crypto';

export function fail(status, message) {
  throw Object.assign(new Error(message), {status});
}

export function verifyLaunch(raw, token) {
  const data = new URLSearchParams(raw);
  const hash = data.get('hash') ?? '';
  data.delete('hash');
  data.sort();
  const secret = createHmac('sha256','WebAppData').update(token).digest();
  const signed = createHmac('sha256',secret).update([...data].map(pair => pair.join('=')).join('\n')).digest();
  if (!/^[a-f0-9]{64}$/.test(hash) || !timingSafeEqual(signed,Buffer.from(hash,'hex'))) {
    fail(401,'Откройте игру из Telegram');
  }
  const age = Math.floor(Date.now()/1000)-Number(data.get('auth_date'));
  if (!Number.isInteger(age) || age < -60 || age >= 86400) fail(401,'Откройте игру заново');
  let id;
  try { id = JSON.parse(data.get('user'))?.id; } catch { fail(401,'Нет данных игрока'); }
  if (!Number.isSafeInteger(id) || id <= 0) fail(401,'Нет данных игрока');
  return id;
}
