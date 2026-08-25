/**
 * Sessão assinada (`06` §4).
 *
 * JWT HS256 escopado a **uma** sala. Não há refresh: o token expira com a sala
 * (`ROOM_MAX_LIFE`) e, expirado, o jogador refaz o join.
 *
 * Escopar à sala é o que torna aceitável passar o token na query string do
 * WebSocket, onde proxies podem registrá-lo: o pior caso de vazamento é uma
 * sala, por algumas horas, e não uma identidade permanente.
 *
 * Implementado sobre `node:crypto` de propósito — uma biblioteca de JWT traria
 * um zoológico de algoritmos que este projeto não usa, e cada um deles é uma
 * superfície de `alg: none` esperando acontecer. Aqui só existe HS256.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import { LIMITS } from '@fdp/protocol';

export interface SessionClaims {
  playerId: string;
  roomCode: string;
  /** Emissão, em segundos (convenção de JWT). */
  iat: number;
  /** Expiração, em segundos. */
  exp: number;
}

export type VerifyFailure = 'MALFORMED' | 'BAD_SIGNATURE' | 'EXPIRED' | 'WRONG_ROOM';

export type VerifyResult =
  | { ok: true; claims: SessionClaims }
  | { ok: false; reason: VerifyFailure };

export interface SessionSigner {
  /** `now` em ms; o token carrega segundos. */
  sign(playerId: string, roomCode: string, now: number): string;
  /** `roomCode` presente confina o token àquela sala (ERR-003, CA-008). */
  verify(token: string, now: number, roomCode?: string): VerifyResult;
}

const HEADER = b64url(Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));

function b64url(buffer: Buffer): string {
  return buffer.toString('base64url');
}

/**
 * O segredo é obrigatório em produção. Em desenvolvimento aceita-se um efêmero,
 * mas ele **precisa** ser efêmero de verdade: um segredo padrão versionado é
 * pior que nenhum, porque parece configurado.
 */
export function createSigner(secret: string): SessionSigner {
  if (secret.length < 32) {
    throw new Error('segredo de sessão precisa de ao menos 32 caracteres');
  }

  const signature = (payload: string): string =>
    b64url(createHmac('sha256', secret).update(`${HEADER}.${payload}`).digest());

  return {
    sign(playerId, roomCode, now) {
      const seconds = Math.floor(now / 1000);
      const claims: SessionClaims = {
        playerId,
        roomCode: roomCode.toUpperCase(),
        iat: seconds,
        exp: seconds + Math.floor(LIMITS.roomMaxLifeMs / 1000),
      };
      const payload = b64url(Buffer.from(JSON.stringify(claims)));
      return `${HEADER}.${payload}.${signature(payload)}`;
    },

    verify(token, now, roomCode) {
      const parts = token.split('.');
      if (parts.length !== 3) return { ok: false, reason: 'MALFORMED' };
      const [header, payload, mac] = parts as [string, string, string];
      if (header !== HEADER) return { ok: false, reason: 'MALFORMED' };

      // Comparação em tempo constante: a diferença de tempo entre "errou no
      // primeiro byte" e "errou no último" é um oráculo para forjar a assinatura.
      const expected = Buffer.from(signature(payload));
      const received = Buffer.from(mac);
      if (expected.length !== received.length || !timingSafeEqual(expected, received)) {
        return { ok: false, reason: 'BAD_SIGNATURE' };
      }

      let claims: SessionClaims;
      try {
        claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as SessionClaims;
      } catch {
        return { ok: false, reason: 'MALFORMED' };
      }
      if (typeof claims?.playerId !== 'string' || typeof claims?.roomCode !== 'string') {
        return { ok: false, reason: 'MALFORMED' };
      }
      if (typeof claims.exp !== 'number' || claims.exp * 1000 <= now) {
        return { ok: false, reason: 'EXPIRED' };
      }
      if (roomCode !== undefined && claims.roomCode !== roomCode.toUpperCase()) {
        return { ok: false, reason: 'WRONG_ROOM' };
      }

      return { ok: true, claims };
    },
  };
}
