/**
 * `RoomStore` em memória — desenvolvimento local e testes (`11` §7).
 *
 * Não é um mock de conveniência: é a implementação que permite testar toda a
 * camada de sala sem Redis e sem rede. Por isso ela reproduz de verdade o que
 * o provedor real faz de observável — TTL, versionamento e conflito de CAS.
 */

import {
  ABORT,
  type Clock,
  type MessageHandler,
  type MutateOptions,
  type MutateOutcome,
  type Mutator,
  type PutOptions,
  type RoomStore,
  type Unsubscribe,
  type Versioned,
} from './types.js';

interface Entry {
  value: unknown;
  version: number;
  expiresAt: number;
}

export interface MemoryStore<T> extends RoomStore<T> {
  /**
   * Faz as próximas `count` mutações desta chave colidirem por versão.
   *
   * Existe para exercitar o caminho de retry de `11` §5 em teste. Sem isso ele
   * só roda em produção, sob concorrência real — o pior lugar possível para
   * descobrir que ele está errado.
   */
  scheduleConflicts(key: string, count: number): void;
}

export function createMemoryStore<T = unknown>(clock: Clock = Date.now): MemoryStore<T> {
  const entries = new Map<string, Entry>();
  const channels = new Map<string, Set<MessageHandler>>();
  const pendingConflicts = new Map<string, number>();
  let nextVersion = 1;
  let closed = false;

  const assertOpen = (): void => {
    if (closed) throw new Error('RoomStore em memória já foi fechado');
  };

  /** TTL preguiçoso: expira na leitura, como o Redis faz. */
  const live = (key: string): Entry | null => {
    const entry = entries.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= clock()) {
      entries.delete(key);
      return null;
    }
    return entry;
  };

  const write = (key: string, value: T, ttlSeconds: number): Versioned<T> => {
    const version = nextVersion++;
    entries.set(key, { value, version, expiresAt: clock() + ttlSeconds * 1000 });
    return { value, version };
  };

  return {
    scheduleConflicts(key, count) {
      pendingConflicts.set(key, count);
    },

    async get(key) {
      assertOpen();
      const entry = live(key);
      return entry ? { value: entry.value as T, version: entry.version } : null;
    },

    async put(key, value, options: PutOptions) {
      assertOpen();
      return write(key, value, options.ttlSeconds);
    },

    async mutate(
      key,
      mutator: Mutator<T>,
      options: MutateOptions,
    ): Promise<MutateOutcome<T>> {
      assertOpen();
      const maxAttempts = options.maxAttempts ?? 3;

      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        const entry = live(key);
        if (!entry) return { ok: false, reason: 'NOT_FOUND' };

        const observedVersion = entry.version;
        const next = mutator(entry.value as T);
        if (next === ABORT) return { ok: false, reason: 'ABORTED' };

        // Simula outra instância escrevendo entre a leitura e a gravação.
        const remaining = pendingConflicts.get(key) ?? 0;
        if (remaining > 0) {
          pendingConflicts.set(key, remaining - 1);
          entries.set(key, { ...entry, version: nextVersion++ });
          continue;
        }

        const current = live(key);
        if (!current || current.version !== observedVersion) continue;

        return {
          ok: true,
          result: write(key, next, options.ttlSeconds),
          attempts: attempt,
        };
      }

      return { ok: false, reason: 'CONFLICT', attempts: maxAttempts };
    },

    async delete(key) {
      assertOpen();
      entries.delete(key);
      pendingConflicts.delete(key);
    },

    async publish(channel, message) {
      assertOpen();
      // Cópia antes de iterar: um handler pode cancelar a própria assinatura.
      for (const handler of [...(channels.get(channel) ?? [])]) handler(message);
    },

    async subscribe(channel, handler): Promise<Unsubscribe> {
      assertOpen();
      const handlers = channels.get(channel) ?? new Set<MessageHandler>();
      handlers.add(handler);
      channels.set(channel, handlers);

      return async () => {
        handlers.delete(handler);
        if (handlers.size === 0) channels.delete(channel);
      };
    },

    async close() {
      closed = true;
      entries.clear();
      channels.clear();
      pendingConflicts.clear();
    },
  };
}
