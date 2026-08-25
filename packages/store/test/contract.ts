/**
 * Contrato do `RoomStore` — uma suíte, todas as implementações (`11` §4).
 *
 * O que a versão em memória passa, a de Redis precisa passar. Manter isto como
 * suíte parametrizada, e não como dois arquivos parecidos, é o que impede as
 * duas implementações de divergirem em silêncio: uma diferença de comportamento
 * vira teste vermelho, não um bug que só aparece em produção.
 *
 * A única coisa que o arnês abstrai é a passagem do tempo. Em memória o relógio
 * é injetado e anda de graça; no Redis o TTL é do servidor e só resta esperar —
 * daí o `ttlProbeSeconds`, que mantém a espera real curta.
 */

import { describe, expect, it } from 'vitest';
import { ABORT, roomChannel, roomKey, type RoomStore } from '../src/index.js';

/** Implementação testável: o gancho de conflito existe nas duas. */
export interface TestableStore<T> extends RoomStore<T> {
  scheduleConflicts(key: string, count: number): void;
}

export interface StoreHarness {
  name: string;
  create<T>(): TestableStore<T>;
  /** Avança o tempo observável pelo store — relógio falso ou espera real. */
  advance(ms: number): Promise<void>;
  /** TTL usado nos testes de expiração, em segundos. */
  ttlProbeSeconds: number;
}

const TTL = { ttlSeconds: 3600 };

/** Pub/sub em Redis atravessa a rede; em memória, não. Isto serve às duas. */
async function waitUntil(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('condição não ocorreu a tempo');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

export function describeRoomStoreContract(harness: StoreHarness): void {
  const probe = harness.ttlProbeSeconds;
  const probeMs = probe * 1000;

  describe(`RoomStore (${harness.name}): leitura e escrita`, () => {
    it('devolve null para chave inexistente', async () => {
      const store = harness.create<string>();
      try {
        expect(await store.get(roomKey('NADA'))).toBeNull();
      } finally {
        await store.close();
      }
    });

    it('INV-02: a versão cresce estritamente e nunca se repete', async () => {
      const store = harness.create<number>();
      try {
        const versions: number[] = [];
        for (let i = 0; i < 20; i++) {
          versions.push((await store.put(roomKey('V'), i, TTL)).version);
        }
        expect(new Set(versions).size).toBe(20);
        for (let i = 1; i < versions.length; i++) {
          expect(versions[i]!).toBeGreaterThan(versions[i - 1]!);
        }
      } finally {
        await store.close();
      }
    });

    it('a leitura devolve o valor gravado, com estrutura preservada', async () => {
      const store = harness.create<{ code: string; players: string[] }>();
      try {
        const value = { code: 'K7QMP', players: ['ana', 'beto'] };
        const written = await store.put(roomKey('K7QMP'), value, TTL);
        const read = await store.get(roomKey('K7QMP'));
        expect(read).toEqual({ value, version: written.version });
      } finally {
        await store.close();
      }
    });

    it('delete remove a chave', async () => {
      const store = harness.create<number>();
      try {
        await store.put(roomKey('DEL'), 1, TTL);
        await store.delete(roomKey('DEL'));
        expect(await store.get(roomKey('DEL'))).toBeNull();
      } finally {
        await store.close();
      }
    });
  });

  describe(`RoomStore (${harness.name}): TTL`, () => {
    it('a chave expira e some da leitura', async () => {
      const store = harness.create<string>();
      try {
        await store.put(roomKey('TTL'), 'v', { ttlSeconds: probe });

        await harness.advance(probeMs * 0.4);
        expect(await store.get(roomKey('TTL'))).not.toBeNull();

        await harness.advance(probeMs * 0.8);
        expect(await store.get(roomKey('TTL'))).toBeNull();
      } finally {
        await store.close();
      }
    });

    it('cada escrita renova o TTL', async () => {
      const store = harness.create<string>();
      try {
        await store.put(roomKey('REN'), 'v1', { ttlSeconds: probe });

        await harness.advance(probeMs * 0.6);
        await store.put(roomKey('REN'), 'v2', { ttlSeconds: probe });

        // 1,2 × TTL no total, mas só 0,6 desde a última escrita.
        await harness.advance(probeMs * 0.6);
        expect((await store.get(roomKey('REN')))?.value).toBe('v2');
      } finally {
        await store.close();
      }
    });

    it('mutar chave expirada devolve NOT_FOUND, não recria', async () => {
      const store = harness.create<number>();
      try {
        await store.put(roomKey('EXP'), 1, { ttlSeconds: probe });
        await harness.advance(probeMs * 1.3);

        const result = await store.mutate(roomKey('EXP'), (n) => n + 1, TTL);
        expect(result).toEqual({ ok: false, reason: 'NOT_FOUND' });
        expect(await store.get(roomKey('EXP'))).toBeNull();
      } finally {
        await store.close();
      }
    });
  });

  describe(`RoomStore (${harness.name}): mutação atômica (11 §5)`, () => {
    it('aplica a mutação e devolve a nova versão', async () => {
      const store = harness.create<{ n: number }>();
      try {
        const initial = await store.put(roomKey('MUT'), { n: 1 }, TTL);

        const result = await store.mutate(roomKey('MUT'), (cur) => ({ n: cur.n + 1 }), TTL);
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.result.value).toEqual({ n: 2 });
        expect(result.result.version).toBeGreaterThan(initial.version);
        expect(result.attempts).toBe(1);
      } finally {
        await store.close();
      }
    });

    it('mutar chave inexistente devolve NOT_FOUND', async () => {
      const store = harness.create<number>();
      try {
        expect(await store.mutate(roomKey('SUMIU'), (n) => n + 1, TTL)).toEqual({
          ok: false,
          reason: 'NOT_FOUND',
        });
      } finally {
        await store.close();
      }
    });

    it('ABORT deixa o estado exatamente como estava', async () => {
      const store = harness.create<number>();
      try {
        const initial = await store.put(roomKey('AB'), 7, TTL);

        const result = await store.mutate(roomKey('AB'), () => ABORT, TTL);
        expect(result).toEqual({ ok: false, reason: 'ABORTED' });

        const after = await store.get(roomKey('AB'));
        expect(after).toEqual(initial); // mesmo valor E mesma versão
      } finally {
        await store.close();
      }
    });

    it('reexecuta a mutação sobre o estado fresco após conflito', async () => {
      const store = harness.create<number>();
      try {
        await store.put(roomKey('CONF'), 0, TTL);
        store.scheduleConflicts(roomKey('CONF'), 2);

        let leituras = 0;
        const result = await store.mutate(
          roomKey('CONF'),
          (cur) => { leituras++; return cur + 1; },
          TTL,
        );

        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.attempts).toBe(3);
        // A mutação rodou 3 vezes, mas só a última foi gravada: incrementou uma vez.
        expect(leituras).toBe(3);
        expect(result.result.value).toBe(1);
      } finally {
        await store.close();
      }
    });

    it('desiste com CONFLICT após esgotar as tentativas', async () => {
      const store = harness.create<number>();
      try {
        await store.put(roomKey('GIVE'), 0, TTL);
        store.scheduleConflicts(roomKey('GIVE'), 99);

        const result = await store.mutate(roomKey('GIVE'), (n) => n + 1, {
          ...TTL,
          maxAttempts: 3,
        });
        expect(result).toEqual({ ok: false, reason: 'CONFLICT', attempts: 3 });
        expect((await store.get(roomKey('GIVE')))?.value).toBe(0); // estado intacto
      } finally {
        await store.close();
      }
    });

    it('mutações concorrentes não perdem escrita', async () => {
      const store = harness.create<number>();
      try {
        await store.put(roomKey('CNT'), 0, TTL);

        // Em memória não há `await` no meio da mutação e o laço de eventos
        // serializa tudo sem conflito algum. No Redis cada tentativa atravessa
        // a rede, e o CAS resolve uma escrita por rodada — daí o teto alto de
        // tentativas: o que se afirma aqui é que nenhuma escrita se perde, não
        // que ela caiba em três tentativas.
        const concorrentes = 25;
        await Promise.all(
          Array.from({ length: concorrentes }, () =>
            store.mutate(roomKey('CNT'), (n) => n + 1, { ...TTL, maxAttempts: 200 }),
          ),
        );

        expect((await store.get(roomKey('CNT')))?.value).toBe(concorrentes);
      } finally {
        await store.close();
      }
    });
  });

  describe(`RoomStore (${harness.name}): pub/sub (11 §3.1)`, () => {
    it('entrega a mensagem a todos os assinantes do canal', async () => {
      const store = harness.create();
      try {
        const recebidas: string[] = [];
        await store.subscribe(roomChannel('A'), (m) => recebidas.push(`1:${m}`));
        await store.subscribe(roomChannel('A'), (m) => recebidas.push(`2:${m}`));
        await store.subscribe(roomChannel('B'), (m) => recebidas.push(`3:${m}`));

        await store.publish(roomChannel('A'), 'jogada');
        await waitUntil(() => recebidas.length === 2);
        expect(recebidas.sort()).toEqual(['1:jogada', '2:jogada']);
      } finally {
        await store.close();
      }
    });

    it('publicar em canal sem assinante não quebra', async () => {
      const store = harness.create();
      try {
        await expect(store.publish(roomChannel('VAZIO'), 'x')).resolves.toBeUndefined();
      } finally {
        await store.close();
      }
    });

    it('cancelar a assinatura para a entrega', async () => {
      const store = harness.create();
      try {
        const recebidas: string[] = [];
        const unsubscribe = await store.subscribe(roomChannel('C'), (m) => recebidas.push(m));

        await store.publish(roomChannel('C'), 'antes');
        await waitUntil(() => recebidas.length === 1);

        await unsubscribe();
        await store.publish(roomChannel('C'), 'depois');
        await new Promise((resolve) => setTimeout(resolve, 50));

        expect(recebidas).toEqual(['antes']);
      } finally {
        await store.close();
      }
    });

    it('um handler pode cancelar a própria assinatura durante a entrega', async () => {
      const store = harness.create();
      try {
        const recebidas: string[] = [];
        const unsubscribe = await store.subscribe(roomChannel('D'), (m) => {
          recebidas.push(m);
          void unsubscribe();
        });
        await store.subscribe(roomChannel('D'), (m) => recebidas.push(`outro:${m}`));

        await store.publish(roomChannel('D'), 'x');
        await waitUntil(() => recebidas.length === 2);
        expect(recebidas.sort()).toEqual(['outro:x', 'x']);
      } finally {
        await store.close();
      }
    });
  });

  describe(`RoomStore (${harness.name}): ciclo de vida`, () => {
    it('operar depois de fechar é erro explícito, não silêncio', async () => {
      const store = harness.create<number>();
      await store.put(roomKey('FIM'), 1, TTL);
      await store.close();

      await expect(store.get(roomKey('FIM'))).rejects.toThrow(/fechado/);
      await expect(store.publish(roomChannel('FIM'), 'm')).rejects.toThrow(/fechado/);
    });

    it('fechar duas vezes não quebra', async () => {
      const store = harness.create<number>();
      await store.close();
      await expect(store.close()).resolves.toBeUndefined();
    });
  });
}

export { roomChannel, roomKey };
