/**
 * `RoomStore` em Redis (`11` §4).
 *
 * O Redis aqui é **durabilidade, não fonte da verdade**: o estado vivo mora na
 * memória do processo, e este store existe para que a sala sobreviva a um
 * `systemctl restart` (RNF-061, CA-046). Por isso ele é write-behind e nunca
 * está no caminho crítico de uma jogada.
 *
 * Passa exatamente a mesma suíte de contrato da implementação em memória — o
 * que uma cumpre, a outra cumpre.
 */

import { Redis } from 'ioredis';
import {
  ABORT,
  type MessageHandler,
  type MutateOptions,
  type MutateOutcome,
  type Mutator,
  type PutOptions,
  type RoomStore,
  type Unsubscribe,
  type Versioned,
} from './types.js';

export interface RedisStoreOptions {
  url: string;
  /**
   * Contador global de versão. Fica **sem TTL** de propósito: se ele expirasse,
   * versões seriam reutilizadas e INV-02 cairia.
   */
  versionKey?: string;
}

export interface RedisStore<T> extends RoomStore<T> {
  /** Ver `MemoryStore.scheduleConflicts` — mesma razão, mesmo contrato. */
  scheduleConflicts(key: string, count: number): void;
}

/** Escreve incondicionalmente e devolve a versão nova. */
const PUT = `
local version = redis.call('INCR', KEYS[2])
redis.call('HSET', KEYS[1], 'v', version, 'd', ARGV[1])
redis.call('PEXPIRE', KEYS[1], ARGV[2])
return version
`;

/**
 * Escrita condicional: só grava se a versão observada ainda for a corrente.
 *
 * `-1` = chave sumiu (expirou entre a leitura e a escrita); `-2` = outra
 * instância escreveu antes. Os dois são resultados normais, não erros.
 */
const CAS = `
local current = redis.call('HGET', KEYS[1], 'v')
if current == false then return -1 end
if current ~= ARGV[1] then return -2 end
local version = redis.call('INCR', KEYS[2])
redis.call('HSET', KEYS[1], 'v', version, 'd', ARGV[2])
redis.call('PEXPIRE', KEYS[1], ARGV[3])
return version
`;

/** Simula outra instância escrevendo entre a leitura e a escrita. */
const BUMP = `
if redis.call('EXISTS', KEYS[1]) == 0 then return 0 end
redis.call('HSET', KEYS[1], 'v', redis.call('INCR', KEYS[2]))
return 1
`;

interface Scripted extends Redis {
  fdpPut(key: string, versionKey: string, data: string, ttlMs: string): Promise<number>;
  fdpCas(
    key: string,
    versionKey: string,
    observed: string,
    data: string,
    ttlMs: string,
  ): Promise<number>;
  fdpBump(key: string, versionKey: string): Promise<number>;
}

export function createRedisStore<T = unknown>(options: RedisStoreOptions): RedisStore<T> {
  const versionKey = options.versionKey ?? 'fdp:version';

  const redis = new Redis(options.url, { maxRetriesPerRequest: 3 }) as Scripted;
  redis.defineCommand('fdpPut', { numberOfKeys: 2, lua: PUT });
  redis.defineCommand('fdpCas', { numberOfKeys: 2, lua: CAS });
  redis.defineCommand('fdpBump', { numberOfKeys: 2, lua: BUMP });

  /**
   * Assinatura exige conexão dedicada: um cliente em modo `subscribe` não
   * aceita mais comandos comuns. É limitação do protocolo, não escolha.
   */
  let subscriber: Redis | null = null;
  const handlers = new Map<string, Set<MessageHandler>>();
  const pendingConflicts = new Map<string, number>();
  let closed = false;

  const assertOpen = (): void => {
    if (closed) throw new Error('RoomStore em Redis já foi fechado');
  };

  const ttlMs = (ttlSeconds: number): string => String(Math.max(1, Math.round(ttlSeconds * 1000)));

  const read = async (key: string): Promise<Versioned<T> | null> => {
    const fields = await redis.hmget(key, 'v', 'd');
    const version = fields[0];
    const data = fields[1];
    if (version == null || data == null) return null;
    return { value: JSON.parse(data) as T, version: Number(version) };
  };

  const ensureSubscriber = (): Redis => {
    if (subscriber) return subscriber;
    subscriber = redis.duplicate();
    subscriber.on('message', (channel: string, message: string) => {
      // Cópia antes de iterar: um handler pode cancelar a própria assinatura.
      for (const handler of [...(handlers.get(channel) ?? [])]) handler(message);
    });
    return subscriber;
  };

  return {
    scheduleConflicts(key, count) {
      pendingConflicts.set(key, count);
    },

    async get(key) {
      assertOpen();
      return read(key);
    },

    async put(key, value, put: PutOptions) {
      assertOpen();
      const data = JSON.stringify(value);
      const version = await redis.fdpPut(key, versionKey, data, ttlMs(put.ttlSeconds));
      return { value, version };
    },

    async mutate(
      key,
      mutator: Mutator<T>,
      mutate: MutateOptions,
    ): Promise<MutateOutcome<T>> {
      assertOpen();
      const maxAttempts = mutate.maxAttempts ?? 3;

      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        const current = await read(key);
        if (!current) return { ok: false, reason: 'NOT_FOUND' };

        const next = mutator(current.value);
        if (next === ABORT) return { ok: false, reason: 'ABORTED' };

        const remaining = pendingConflicts.get(key) ?? 0;
        if (remaining > 0) {
          pendingConflicts.set(key, remaining - 1);
          await redis.fdpBump(key, versionKey);
          continue;
        }

        const version = await redis.fdpCas(
          key,
          versionKey,
          String(current.version),
          JSON.stringify(next),
          ttlMs(mutate.ttlSeconds),
        );
        if (version === -1) return { ok: false, reason: 'NOT_FOUND' };
        if (version === -2) continue;

        return { ok: true, result: { value: next, version }, attempts: attempt };
      }

      return { ok: false, reason: 'CONFLICT', attempts: maxAttempts };
    },

    async delete(key) {
      assertOpen();
      pendingConflicts.delete(key);
      await redis.del(key);
    },

    async publish(channel, message) {
      assertOpen();
      await redis.publish(channel, message);
    },

    async subscribe(channel, handler): Promise<Unsubscribe> {
      assertOpen();
      const existing = handlers.get(channel);
      const set = existing ?? new Set<MessageHandler>();
      set.add(handler);
      handlers.set(channel, set);
      if (!existing) await ensureSubscriber().subscribe(channel);

      return async () => {
        const live = handlers.get(channel);
        if (!live) return;
        live.delete(handler);
        if (live.size > 0) return;
        handlers.delete(channel);
        if (!closed) await subscriber?.unsubscribe(channel);
      };
    },

    async close() {
      if (closed) return;
      closed = true;
      handlers.clear();
      await Promise.all([redis.quit(), subscriber?.quit()].filter(Boolean));
      subscriber = null;
    },
  };
}
