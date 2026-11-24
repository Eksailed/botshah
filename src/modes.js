import { createHmac, timingSafeEqual } from 'node:crypto';
import { Chess } from 'chess.js';
import { draughts, step } from './draughts.js';

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

const values = {p:1,n:3,b:3,r:5,q:9,k:4};
const chessSquare = index => 'abcdefgh'[index%8]+(8-(index>>3));

export function computerMove(state, level, game, rules) {
  const {moves,board} = state;
  if (!moves.length) return undefined;
  if (level === 'easy') return moves[Math.floor(Math.random()*moves.length)];
  const material = piece => piece ? (values[piece[1]] ?? 0) : 0;
  const weight = move => {
    const target = board[move.victim ?? move.to];
    const capture = target && target[0] !== state.turn ? material(target) : 0;
    const center = 4-(Math.abs(move.to%8-3.5)+Math.abs((move.to>>3)-3.5))/2;
    return capture*10+(move.promotion === 'q' ? 8 : 0)+center;
  };
  const candidates = moves.map(move => ({move,weight:weight(move)}))
    .sort((a,b) => b.weight-a.weight).slice(0,8);
  const chess = game === 'chess' ? new Chess(state.fen) : null;
  const huff = rules !== 'strict';
  let best = -Infinity;
  let chosen = candidates[0].move;
  for (const {move,weight:base} of candidates) {
    let score = base;
    if (chess) {
      const to = chessSquare(move.to);
      chess.move({from:chessSquare(move.from),to,promotion:move.promotion});
      if (chess.isCheckmate()) return move;
      if (chess.isAttacked(to,chess.turn())) {
        const piece = material(board[move.from]);
        const defended = chess.isAttacked(to,state.turn);
        score -= piece*(defended ? 6 : 13);
      }
      if (chess.isCheck()) score += 2;
      chess.undo();
    } else {
      const after = draughts(step(state,move,huff),huff);
      if (after.result === state.turn) return move;
      if (after.turn !== state.turn) {
        const danger = after.moves.reduce((worst,reply) => {
          const square = reply.from === reply.to ? reply.from : reply.victim;
          return Math.max(worst,material(after.board[square]));
        },0);
        score -= danger*12;
      } else if (after.chain !== null) {
        score += 4;
      }
    }
    if (score > best) {
      best = score;
      chosen = move;
    }
  }
  return chosen;
}
