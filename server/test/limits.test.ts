/**
 * Limites de `05` §7 e `06` RNF-003. Base de CA-124 e CA-045.
 */

import { describe, expect, it } from 'vitest';
import { createIdempotencyCache, createRateLimiter } from '../src/limits.js';

describe('CA-124: rate limit por janela deslizante', () => {
  it('deixa passar até o limite e barra o excedente com retryAfterMs', () => {
    const limiter = createRateLimiter({ limit: 20, windowMs: 10_000 });

    for (let i = 0; i < 20; i++) {
      expect(limiter.check('conexão', 1000 + i).allowed).toBe(true);
    }

    const barrado = limiter.check('conexão', 1100);
    expect(barrado.allowed).toBe(false);
    // A primeira permissão foi em 1000; a vaga volta em 11000.
    expect(barrado.retryAfterMs).toBe(9900);
  });

  it('a janela desliza: passado o prazo da mais antiga, cabe outra', () => {
    const limiter = createRateLimiter({ limit: 2, windowMs: 1000 });
    expect(limiter.check('k', 0).allowed).toBe(true);
    expect(limiter.check('k', 500).allowed).toBe(true);
    expect(limiter.check('k', 900).allowed).toBe(false);

    // 1001 já não conta o hit de 0.
    expect(limiter.check('k', 1001).allowed).toBe(true);
  });

  it('barrar não consome permissão — o cliente em retry cego não se afunda', () => {
    const limiter = createRateLimiter({ limit: 1, windowMs: 1000 });
    limiter.check('k', 0);
    for (let i = 0; i < 50; i++) limiter.check('k', 100 + i);

    // A vaga continua vencendo em 1000, e não empurrada para frente.
    expect(limiter.check('k', 1001).allowed).toBe(true);
  });

  it('chaves são independentes', () => {
    const limiter = createRateLimiter({ limit: 1, windowMs: 1000 });
    expect(limiter.check('a', 0).allowed).toBe(true);
    expect(limiter.check('b', 0).allowed).toBe(true);
    expect(limiter.check('a', 0).allowed).toBe(false);
  });

  it('prune descarta janelas vencidas: IP de passagem não vira vazamento', () => {
    const limiter = createRateLimiter({ limit: 10, windowMs: 1000 });
    for (let i = 0; i < 500; i++) limiter.check(`ip-${i}`, 0);
    expect(limiter.size).toBe(500);

    limiter.prune(2000);
    expect(limiter.size).toBe(0);
  });
});

describe('CA-045 / RNF-013: idempotência por id de comando', () => {
  it('devolve a resposta original dentro da janela', () => {
    const cache = createIdempotencyCache<string>(30_000);
    cache.remember('cmd-1', 'ack-original', 1000);

    expect(cache.recall('cmd-1', 1000 + 5_000)).toBe('ack-original');
  });

  it('esquece depois da janela', () => {
    const cache = createIdempotencyCache<string>(30_000);
    cache.remember('cmd-1', 'ack', 1000);

    expect(cache.recall('cmd-1', 1000 + 30_001)).toBeUndefined();
  });

  it('id nunca visto não inventa resposta', () => {
    const cache = createIdempotencyCache<string>(30_000);
    expect(cache.recall('cmd-desconhecido', 0)).toBeUndefined();
  });

  it('prune limpa o que venceu e mantém o que não', () => {
    const cache = createIdempotencyCache<string>(1000);
    cache.remember('velho', 'a', 0);
    cache.remember('novo', 'b', 900);

    cache.prune(1500);
    expect(cache.size).toBe(1);
    expect(cache.recall('novo', 1500)).toBe('b');
  });
});
