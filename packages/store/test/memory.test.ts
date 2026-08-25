/**
 * A implementação em memória contra a suíte de contrato, mais o que só ela tem:
 * relógio injetável e chaves normalizadas.
 */

import { describe, expect, it } from 'vitest';
import { createMemoryStore, roomChannel, roomKey } from '../src/index.js';
import { describeRoomStoreContract, type StoreHarness } from './contract.js';

/** Relógio controlável: TTL testável sem esperar tempo real (RNF-100). */
let now = 0;

const harness: StoreHarness = {
  name: 'memória',
  create<T>() {
    now = 0;
    return createMemoryStore<T>(() => now);
  },
  async advance(ms) {
    now += ms;
  },
  ttlProbeSeconds: 60,
};

describeRoomStoreContract(harness);

describe('RoomStore em memória: específico', () => {
  it('normaliza a chave da sala para maiúsculas', () => {
    expect(roomKey('k7qmp')).toBe('room:K7QMP');
    expect(roomChannel('k7qmp')).toBe('room:K7QMP:events');
  });

  it('o relógio injetado é o único tempo que o store enxerga', async () => {
    let clock = 1_000_000;
    const store = createMemoryStore<string>(() => clock);
    await store.put('k', 'v', { ttlSeconds: 1 });

    // Tempo real passa; o do store, não.
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(await store.get('k')).not.toBeNull();

    clock += 2000;
    expect(await store.get('k')).toBeNull();
    await store.close();
  });
});
