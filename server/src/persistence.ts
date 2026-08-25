/**
 * Persistência write-behind das salas (`11` §4, RNF-061).
 *
 * O estado vivo mora na memória do processo; o store é **durabilidade**, não
 * fonte da verdade em tempo de jogo. Por isso nada aqui entra no caminho
 * crítico de uma jogada: `schedule` só marca a sala como suja e volta na hora,
 * e a gravação acontece depois, em lote.
 *
 * Isso preserva a regra vinculante de `11` §5 — mutação de sala não contém
 * `await` — sem abrir mão de sobreviver a um `systemctl restart` (CA-046).
 */

import { LIMITS } from '@fdp/protocol';
import type { Room } from '@fdp/room';
import { roomKey, type RoomStore } from '@fdp/store';

/**
 * Índice das salas vivas.
 *
 * O `RoomStore` tem seis métodos e nenhum deles varre chaves — de propósito,
 * para não vazar detalhe de provedor. Então o índice é um registro comum,
 * reescrito a cada ciclo de gravação com TTL renovado. Uma sala que expirou
 * some do índice na volta seguinte, e uma que sumiu do store é simplesmente
 * ignorada na carga.
 */
const INDEX_KEY = 'rooms:live';

export interface Persistence {
  /** Marca a sala como suja. Não bloqueia, não faz I/O. */
  schedule(room: Room): void;
  /** Esquece a sala e apaga do store. Sala encerrada não volta num reinício. */
  forget(code: string): void;
  /** Grava tudo que está sujo. Chamado pelo ciclo e pelo `SIGTERM`. */
  flush(): Promise<void>;
  /** Recarrega as salas vivas. Uma vez, na subida. */
  load(): Promise<Room[]>;
}

export interface PersistenceOptions {
  store: RoomStore<unknown>;
  /** Vida máxima da sala; o TTL do store implementa `ROOM_MAX_LIFE`. */
  ttlSeconds?: number;
  /** Reportar falha de gravação sem derrubar o processo. */
  onError?: (error: unknown) => void;
}

export function createPersistence({
  store,
  ttlSeconds = Math.floor(LIMITS.roomMaxLifeMs / 1000),
  onError = () => {},
}: PersistenceOptions): Persistence {
  const dirty = new Map<string, Room>();
  const doomed = new Set<string>();
  /** Códigos que já foram gravados e ainda não morreram — a base do índice. */
  const known = new Set<string>();
  let running: Promise<void> | null = null;

  const write = async (): Promise<void> => {
    const pending = [...dirty.values()];
    const removing = [...doomed];
    dirty.clear();
    doomed.clear();
    if (pending.length === 0 && removing.length === 0) return;

    try {
      await Promise.all([
        ...pending.map((room) => store.put(roomKey(room.code), room, { ttlSeconds })),
        ...removing.map((code) => store.delete(roomKey(code))),
      ]);
      await store.put(INDEX_KEY, [...known], { ttlSeconds });
    } catch (error) {
      onError(error);
    }
  };

  return {
    schedule(room) {
      known.add(room.code);
      doomed.delete(room.code);
      // Só o último estado importa: gravar os intermediários seria escrever
      // história que ninguém vai ler.
      dirty.set(room.code, room);
    },

    forget(code) {
      known.delete(code);
      dirty.delete(code);
      doomed.add(code);
    },

    /** Serializa os ciclos: dois flushes concorrentes embaralhariam a ordem. */
    async flush() {
      running = (running ?? Promise.resolve()).then(write, write);
      await running;
    },

    async load() {
      const index = await store.get(INDEX_KEY);
      const codes = Array.isArray(index?.value) ? (index.value as string[]) : [];

      const found = await Promise.all(
        codes.map(async (code) => (await store.get(roomKey(code)))?.value as Room | undefined),
      );

      const rooms = found.filter((room): room is Room => room !== undefined);
      // Sala que expirou no store não volta, mas o índice precisa refletir isso
      // na próxima gravação — senão a carga seguinte tenta de novo para sempre.
      for (const room of rooms) known.add(room.code);
      return rooms;
    },
  };
}
