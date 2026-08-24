/**
 * Contrato do RoomStore, verificado sobre a implementação em memória.
 *
 * Estes testes são o contrato que o Redis também precisará cumprir: quando a
 * implementação real chegar, ela roda a mesma suíte.
 */

import { describe, expect, it } from 'vitest';
import { ABORT, createMemoryStore, roomChannel, roomKey } from '../src/index.js';

const TTL = { ttlSeconds: 3600 };

/** Relógio controlável: TTL testável sem esperar tempo real. */
function fakeClock(start = 0): { now: () => number; advance: (ms: number) => void } {
  let current = start;
  return { now: () => current, advance: (ms) => { current += ms; } };
}

describe('RoomStore: leitura e escrita', () => {
  it('devolve null para chave inexistente', async () => {
    const store = createMemoryStore();
    expect(await store.get('room:NADA')).toBeNull();
  });

  it('INV-02: a versão cresce estritamente e nunca se repete', async () => {
    const store = createMemoryStore<number>();
    const versions: number[] = [];
    for (let i = 0; i < 20; i++) {
      versions.push((await store.put('k', i, TTL)).version);
    }
    expect(new Set(versions).size).toBe(20);
    for (let i = 1; i < versions.length; i++) {
      expect(versions[i]!).toBeGreaterThan(versions[i - 1]!);
    }
  });

  it('normaliza a chave da sala para maiúsculas', () => {
    expect(roomKey('k7qmp')).toBe('room:K7QMP');
    expect(roomChannel('k7qmp')).toBe('room:K7QMP:events');
  });
});

describe('RoomStore: TTL', () => {
  it('a chave expira e some da leitura', async () => {
    const clock = fakeClock();
    const store = createMemoryStore<string>(clock.now);
    await store.put('k', 'v', { ttlSeconds: 60 });

    clock.advance(59_000);
    expect(await store.get('k')).not.toBeNull();

    clock.advance(2_000);
    expect(await store.get('k')).toBeNull();
  });

  it('cada escrita renova o TTL', async () => {
    const clock = fakeClock();
    const store = createMemoryStore<string>(clock.now);
    await store.put('k', 'v1', { ttlSeconds: 60 });

    clock.advance(50_000);
    await store.put('k', 'v2', { ttlSeconds: 60 });

    clock.advance(50_000); // 100s no total, mas só 50s desde a última escrita
    expect((await store.get('k'))?.value).toBe('v2');
  });

  it('mutar chave expirada devolve NOT_FOUND, não recria', async () => {
    const clock = fakeClock();
    const store = createMemoryStore<number>(clock.now);
    await store.put('k', 1, { ttlSeconds: 10 });
    clock.advance(11_000);

    const result = await store.mutate('k', (n) => n + 1, TTL);
    expect(result).toEqual({ ok: false, reason: 'NOT_FOUND' });
    expect(await store.get('k')).toBeNull();
  });
});

describe('RoomStore: mutação atômica (11 §5)', () => {
  it('aplica a mutação e devolve a nova versão', async () => {
    const store = createMemoryStore<{ n: number }>();
    const initial = await store.put('k', { n: 1 }, TTL);

    const result = await store.mutate('k', (cur) => ({ n: cur.n + 1 }), TTL);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.result.value).toEqual({ n: 2 });
    expect(result.result.version).toBeGreaterThan(initial.version);
    expect(result.attempts).toBe(1);
  });

  it('ABORT deixa o estado exatamente como estava', async () => {
    const store = createMemoryStore<number>();
    const initial = await store.put('k', 7, TTL);

    const result = await store.mutate('k', () => ABORT, TTL);
    expect(result).toEqual({ ok: false, reason: 'ABORTED' });

    const after = await store.get('k');
    expect(after).toEqual(initial); // mesmo valor E mesma versão
  });

  it('reexecuta a mutação sobre o estado fresco após conflito', async () => {
    const store = createMemoryStore<number>();
    await store.put('k', 0, TTL);
    store.scheduleConflicts('k', 2);

    let leituras = 0;
    const result = await store.mutate('k', (cur) => { leituras++; return cur + 1; }, TTL);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.attempts).toBe(3);
    // A mutação rodou 3 vezes, mas só a última foi gravada: incrementou uma vez.
    expect(leituras).toBe(3);
    expect(result.result.value).toBe(1);
  });

  it('desiste com CONFLICT após esgotar as tentativas', async () => {
    const store = createMemoryStore<number>();
    await store.put('k', 0, TTL);
    store.scheduleConflicts('k', 99);

    const result = await store.mutate('k', (n) => n + 1, { ...TTL, maxAttempts: 3 });
    expect(result).toEqual({ ok: false, reason: 'CONFLICT', attempts: 3 });
    expect((await store.get('k'))?.value).toBe(0); // estado intacto
  });

  it('mutações concorrentes não perdem escrita', async () => {
    const store = createMemoryStore<number>();
    await store.put('contador', 0, TTL);

    await Promise.all(
      Array.from({ length: 50 }, () => store.mutate('contador', (n) => n + 1, TTL)),
    );

    expect((await store.get('contador'))?.value).toBe(50);
  });
});

describe('RoomStore: pub/sub (11 §3.1)', () => {
  it('entrega a mensagem a todos os assinantes do canal', async () => {
    const store = createMemoryStore();
    const recebidas: string[] = [];
    await store.subscribe('sala:A', (m) => recebidas.push(`1:${m}`));
    await store.subscribe('sala:A', (m) => recebidas.push(`2:${m}`));
    await store.subscribe('sala:B', (m) => recebidas.push(`3:${m}`));

    await store.publish('sala:A', 'jogada');
    expect(recebidas).toEqual(['1:jogada', '2:jogada']);
  });

  it('publicar em canal sem assinante não quebra', async () => {
    const store = createMemoryStore();
    await expect(store.publish('vazio', 'x')).resolves.toBeUndefined();
  });

  it('cancelar a assinatura para a entrega', async () => {
    const store = createMemoryStore();
    const recebidas: string[] = [];
    const unsubscribe = await store.subscribe('c', (m) => recebidas.push(m));

    await store.publish('c', 'antes');
    await unsubscribe();
    await store.publish('c', 'depois');

    expect(recebidas).toEqual(['antes']);
  });

  it('um handler pode cancelar a própria assinatura durante a entrega', async () => {
    const store = createMemoryStore();
    const recebidas: string[] = [];
    const unsubscribe = await store.subscribe('c', (m) => {
      recebidas.push(m);
      void unsubscribe();
    });
    await store.subscribe('c', (m) => recebidas.push(`outro:${m}`));

    await expect(store.publish('c', 'x')).resolves.toBeUndefined();
    expect(recebidas).toEqual(['x', 'outro:x']);
  });
});

describe('RoomStore: ciclo de vida', () => {
  it('operar depois de fechar é erro explícito, não silêncio', async () => {
    const store = createMemoryStore<number>();
    await store.put('k', 1, TTL);
    await store.close();

    await expect(store.get('k')).rejects.toThrow(/fechado/);
    await expect(store.publish('c', 'm')).rejects.toThrow(/fechado/);
  });
});
