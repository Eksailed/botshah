import { createHmac, timingSafeEqual } from 'node:crypto';

const sign = (token, data) => createHmac('sha256',token).update('challenge:'+data).digest('base64url').slice(0,22);

export function challenge(token, owner, game, rules, id) {
  const data = [owner,game === 'chess' ? 'c' : rules === 'strict' ? 's' : 'd',id].join('.');
  return 'i_'+Buffer.from(data).toString('base64url')+'_'+sign(token,data);
}

export function readChallenge(token, payload) {
  const match = /^i_([\w-]+)_([\w-]{22})$/.exec(payload ?? '');
  if (!match) return null;
  const data = Buffer.from(match[1],'base64url').toString();
  if (!timingSafeEqual(Buffer.from(match[2]),Buffer.from(sign(token,data)))) return null;
  const parts = /^(\d+)\.([csd])\.([a-f0-9]{24})$/.exec(data);
  if (!parts || !Number.isSafeInteger(Number(parts[1])) || Number(parts[1]) <= 0) return null;
  return {owner:Number(parts[1]),game:parts[2] === 'c' ? 'chess' : 'draughts',
    rules:parts[2] === 's' ? 'strict' : 'huff',id:parts[3]};
}

export function computerMove(state, level) {
  const {moves,board} = state;
  if (level === 'easy') return moves[Math.floor(Math.random()*moves.length)];
  const values = {p:1,n:3,b:3,r:5,q:9,k:4};
  const weight = move => {
    if (move.from === move.to) return values[board[move.from]?.[1]] ?? 1;
    const target = board[move.victim ?? move.to];
    const capture = target && target[0] !== state.turn ? (values[target[1]] ?? 1)*10 : 0;
    const col = move.to%8;
    const row = move.to>>3;
    return capture+(move.promotion === 'q' ? 8 : 0)+4-(Math.abs(col-3.5)+Math.abs(row-3.5))/2;
  };
  const best = Math.max(...moves.map(weight));
  const choices = moves.filter(move => weight(move) === best);
  return choices[Math.floor(Math.random()*choices.length)];
}
