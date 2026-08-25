/**
 * Limites e proteção (`05` §7, `06` RNF-003).
 *
 * Duas estruturas puras, com relógio injetado: dá para testar uma hora de
 * limite em microssegundos, e nenhuma delas conhece HTTP nem WebSocket.
 */

export interface RateDecision {
  allowed: boolean;
  /** Quanto esperar até caber de novo. Vai em `params.retryAfterMs` (ERR-009). */
  retryAfterMs: number;
}

export interface RateLimiter {
  /** Consome uma permissão se houver. Chamar **é** tentar. */
  check(key: string, now: number): RateDecision;
  forget(key: string): void;
  /** Descarta janelas vencidas. Sem isso, IP de passagem vira vazamento. */
  prune(now: number): void;
  readonly size: number;
}

export interface RateLimitOptions {
  limit: number;
  windowMs: number;
}

/**
 * Janela deslizante por registro de timestamps.
 *
 * Com limites desta ordem (20 por conexão, 60 por hora por IP) o vetor por
 * chave é minúsculo, e a precisão vale mais que a economia: janela fixa
 * deixaria passar o dobro do limite na virada — exatamente o instante em que
 * um cliente em retry cego bate.
 */
export function createRateLimiter({ limit, windowMs }: RateLimitOptions): RateLimiter {
  const hits = new Map<string, number[]>();

  const live = (key: string, now: number): number[] => {
    const cutoff = now - windowMs;
    const kept = (hits.get(key) ?? []).filter((at) => at > cutoff);
    if (kept.length === 0) hits.delete(key);
    else hits.set(key, kept);
    return kept;
  };

  return {
    check(key, now) {
      const kept = live(key, now);
      if (kept.length >= limit) {
        // O primeiro da janela é o que libera a próxima vaga.
        const oldest = kept[0]!;
        return { allowed: false, retryAfterMs: Math.max(1, oldest + windowMs - now) };
      }
      kept.push(now);
      hits.set(key, kept);
      return { allowed: true, retryAfterMs: 0 };
    },

    forget(key) {
      hits.delete(key);
    },

    prune(now) {
      for (const key of [...hits.keys()]) live(key, now);
    },

    get size() {
      return hits.size;
    },
  };
}

export interface IdempotencyCache<T> {
  /** Resposta já dada para este `id`, se ainda dentro da janela. */
  recall(id: string, now: number): T | undefined;
  remember(id: string, value: T, now: number): void;
  prune(now: number): void;
  readonly size: number;
}

/**
 * RNF-013: comando reenviado com o mesmo `id` dentro da janela devolve o `ack`
 * original **sem reexecutar**.
 *
 * É o que torna seguro o cliente reenviar após reconectar sem saber se o
 * comando chegou. Sem isto, uma carta jogada pode ser jogada duas vezes — e o
 * reenvio cego é justamente o comportamento de quem está em rede ruim.
 */
export function createIdempotencyCache<T>(windowMs: number): IdempotencyCache<T> {
  const seen = new Map<string, { value: T; expiresAt: number }>();

  return {
    recall(id, now) {
      const entry = seen.get(id);
      if (!entry) return undefined;
      if (entry.expiresAt <= now) {
        seen.delete(id);
        return undefined;
      }
      return entry.value;
    },

    remember(id, value, now) {
      seen.set(id, { value, expiresAt: now + windowMs });
    },

    prune(now) {
      for (const [id, entry] of seen) if (entry.expiresAt <= now) seen.delete(id);
    },

    get size() {
      return seen.size;
    },
  };
}
