/**
 * Persistência write-behind (`11` §4). Base de CA-046 e RNF-061.
 */

import { describe, expect, it } from 'vitest';
import { type Avatar, type Command } from '@fdp/protocol';
import { applyCommand, createRoom, join, type Room, type RoomCtx } from '@fdp/room';
import { createMemoryStore, roomKey } from '@fdp/store';
import { createPersistence } from '../src/persistence.js';

const AVATAR: Avatar = { emoji: '🦊', color: 'amber' };

function ctxAt(now: number): RoomCtx {
  let counter = 0;
  return { now, randomSeed: () => 'seed-fixa', newId: () => `id-${++counter}` };
}

/** Sala de 4 jogadores com partida em andamento — o caso que importa salvar. */
function salaEmPartida(): Room {
  let room = createRoom('K7QMP', { playerId: 'p1', nickname: 'Ana', avatar: AVATAR }, ctxAt(0));
  for (let i = 2; i <= 4; i++) {
    const result = join(room, { playerId: `p${i}`, nickname: `J${i}`, avatar: AVATAR }, ctxAt(i));
    if (!result.ok) throw new Error(result.code);
    room = result.room;
  }
  const start: Command = { type: 'host:startMatch', payload: {} };
  const started = applyCommand(room, 'p1', start, ctxAt(100));
  if (!started.ok) throw new Error(started.code);
  return started.room;
}

describe('persistência: agendar e gravar', () => {
  it('não faz I/O ao agendar — a mutação de sala não espera o store (11 §5)', async () => {
    const store = createMemoryStore();
    const persistence = createPersistence({ store });
    const room = salaEmPartida();

    persistence.schedule(room);
    expect(await store.get(roomKey(room.code))).toBeNull(); // ainda nada gravado

    await persistence.flush();
    expect(await store.get(roomKey(room.code))).not.toBeNull();
  });

  it('só o último estado é gravado: escrever os intermediários é história morta', async () => {
    const store = createMemoryStore();
    const persistence = createPersistence({ store });
    const room = salaEmPartida();

    persistence.schedule({ ...room, stateVersion: 10 });
    persistence.schedule({ ...room, stateVersion: 11 });
    persistence.schedule({ ...room, stateVersion: 12 });
    await persistence.flush();

    const saved = (await store.get(roomKey(room.code)))?.value as Room;
    expect(saved.stateVersion).toBe(12);
  });

  it('flush sem nada sujo não escreve', async () => {
    const store = createMemoryStore();
    const persistence = createPersistence({ store });

    await persistence.flush();
    expect(await store.get('rooms:live')).toBeNull();
  });

  it('falha de gravação é reportada, não propagada — partida não cai por isso', async () => {
    const store = createMemoryStore();
    const erros: unknown[] = [];
    const persistence = createPersistence({ store, onError: (e) => erros.push(e) });

    await store.close(); // store fora do ar
    persistence.schedule(salaEmPartida());

    await expect(persistence.flush()).resolves.toBeUndefined();
    expect(erros).toHaveLength(1);
  });
});

describe('CA-046: a sala volta do store depois de um reinício', () => {
  it('estado completo sobrevive à ida e volta, com o mesmo stateVersion', async () => {
    const store = createMemoryStore();
    const original = salaEmPartida();

    const antes = createPersistence({ store });
    antes.schedule(original);
    await antes.flush();

    // Processo novo, store igual.
    const depois = createPersistence({ store });
    const [recarregada] = await depois.load();

    expect(recarregada).toEqual(original);
    expect(recarregada?.stateVersion).toBe(original.stateVersion);
    // A mão de cada jogador continua lá: reiniciar não redistribui cartas.
    expect(recarregada?.match?.hidden).toEqual(original.match?.hidden);
  });

  it('a sala atravessa JSON sem perder nada', () => {
    // O store em memória guarda a referência do objeto, então a ida e volta
    // acima **não** prova serialização — este teste prova. É o que quebra no
    // dia em que alguém puser um `Map`, um `Set` ou um campo opcional
    // `undefined` dentro de `Room`: em Redis eles sumiriam calados, e a sala
    // voltaria de um reinício com um buraco no meio.
    const original = salaEmPartida();
    expect(JSON.parse(JSON.stringify(original))).toEqual(original);
  });

  it('recarrega várias salas de uma vez', async () => {
    const store = createMemoryStore();
    const persistence = createPersistence({ store });

    const a = salaEmPartida();
    const b = { ...salaEmPartida(), code: 'ZZZZZ' };
    persistence.schedule(a);
    persistence.schedule(b);
    await persistence.flush();

    const codes = (await createPersistence({ store }).load()).map((r) => r.code).sort();
    expect(codes).toEqual(['K7QMP', 'ZZZZZ']);
  });

  it('sala esquecida não volta: encerrar é definitivo', async () => {
    const store = createMemoryStore();
    const persistence = createPersistence({ store });

    const room = salaEmPartida();
    persistence.schedule(room);
    await persistence.flush();

    persistence.forget(room.code);
    await persistence.flush();

    expect(await store.get(roomKey(room.code))).toBeNull();
    expect(await createPersistence({ store }).load()).toEqual([]);
  });

  it('sala que expirou no store some da carga sem derrubar as outras', async () => {
    let now = 0;
    const store = createMemoryStore(() => now);
    const persistence = createPersistence({ store, ttlSeconds: 10 });

    persistence.schedule(salaEmPartida());
    await persistence.flush();

    // O TTL do store implementa ROOM_MAX_LIFE: expirou, não volta.
    now += 11_000;
    expect(await createPersistence({ store }).load()).toEqual([]);
  });

  it('carga sem índice devolve vazio em vez de explodir', async () => {
    const store = createMemoryStore();
    expect(await createPersistence({ store }).load()).toEqual([]);
  });
});
