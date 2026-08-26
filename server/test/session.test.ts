/**
 * Sessão assinada (`06` §4, RNF-075). Cobre a base de CA-007 e CA-008.
 */

import { describe, expect, it } from 'vitest';
import { LIMITS } from '@fdp/protocol';
import { createSigner } from '../src/session.js';

const SECRET = 'a'.repeat(32);
const OUTRO = 'b'.repeat(32);
const T0 = 1_700_000_000_000;

describe('sessão: assinatura', () => {
  it('recusa segredo curto demais em vez de aceitar em silêncio', () => {
    expect(() => createSigner('curto')).toThrow(/32 caracteres/);
  });

  it('assina e verifica, devolvendo o mesmo jogador e a mesma sala', () => {
    const signer = createSigner(SECRET);
    const token = signer.sign('jogador-1', 'k7qmp', T0);

    const result = signer.verify(token, T0 + 1000);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.claims.playerId).toBe('jogador-1');
    expect(result.claims.roomCode).toBe('K7QMP'); // normalizado
  });

  it('o token não carrega nada além das claims declaradas', () => {
    const signer = createSigner(SECRET);
    const token = signer.sign('jogador-1', 'K7QMP', T0);
    const claims = JSON.parse(Buffer.from(token.split('.')[1]!, 'base64url').toString('utf8'));

    // `tipo` entrou em 26/08/2026 e não é enfeite: é o que impede um token de
    // sala de ser apresentado como token de CONTA, já que os dois são HS256
    // com o mesmo segredo e a assinatura de um confere no outro.
    expect(Object.keys(claims).sort()).toEqual(['exp', 'iat', 'playerId', 'roomCode', 'tipo']);
    expect(claims.tipo).toBe('sala');
  });

  it('expira junto com a sala (ROOM_MAX_LIFE)', () => {
    const signer = createSigner(SECRET);
    const token = signer.sign('jogador-1', 'K7QMP', T0);

    expect(signer.verify(token, T0 + LIMITS.roomMaxLifeMs - 1000).ok).toBe(true);
    expect(signer.verify(token, T0 + LIMITS.roomMaxLifeMs + 1000)).toEqual({
      ok: false,
      reason: 'EXPIRED',
    });
  });
});

describe('sessão: o que não passa', () => {
  it('token assinado com outro segredo é recusado', () => {
    const token = createSigner(OUTRO).sign('jogador-1', 'K7QMP', T0);
    expect(createSigner(SECRET).verify(token, T0)).toEqual({ ok: false, reason: 'BAD_SIGNATURE' });
  });

  it('payload adulterado invalida a assinatura', () => {
    const signer = createSigner(SECRET);
    const [header, , mac] = signer.sign('jogador-1', 'K7QMP', T0).split('.');

    const forjado = Buffer.from(
      JSON.stringify({ playerId: 'jogador-2', roomCode: 'K7QMP', iat: 0, exp: 9e9 }),
    ).toString('base64url');

    expect(signer.verify(`${header}.${forjado}.${mac}`, T0)).toEqual({
      ok: false,
      reason: 'BAD_SIGNATURE',
    });
  });

  it('`alg: none` não existe: trocar o header derruba o token', () => {
    const signer = createSigner(SECRET);
    const [, payload, mac] = signer.sign('jogador-1', 'K7QMP', T0).split('.');
    const none = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');

    expect(signer.verify(`${none}.${payload}.${mac}`, T0)).toEqual({
      ok: false,
      reason: 'MALFORMED',
    });
    expect(signer.verify(`${none}.${payload}.`, T0)).toEqual({ ok: false, reason: 'MALFORMED' });
  });

  it('CA-008: token de outra sala é recusado quando a sala é exigida', () => {
    const signer = createSigner(SECRET);
    const token = signer.sign('jogador-1', 'K7QMP', T0);

    expect(signer.verify(token, T0, 'ZZZZZ')).toEqual({ ok: false, reason: 'WRONG_ROOM' });
    expect(signer.verify(token, T0, 'k7qmp').ok).toBe(true);
  });

  it('lixo no lugar do token não quebra nada', () => {
    const signer = createSigner(SECRET);
    for (const lixo of ['', 'a', 'a.b', 'a.b.c.d', '....']) {
      expect(signer.verify(lixo, T0).ok).toBe(false);
    }
  });
});
