/**
 * A implementação de Redis contra **a mesma** suíte de contrato (`11` §4).
 *
 * Roda quando há `REDIS_URL`; sem ele, é pulado com aviso em vez de dar falso
 * verde. No CI o serviço está sempre de pé, então esta suíte é obrigatória lá —
 * é onde a promessa "o que a memória passa, o Redis passa" é de fato cobrada.
 *
 *   docker run --rm -p 6379:6379 redis:7-alpine
 *   REDIS_URL=redis://127.0.0.1:6379 npm test
 */

import { Redis } from 'ioredis';
import { beforeAll, describe, it } from 'vitest';
import { createRedisStore } from '../src/redis.js';
import { describeRoomStoreContract, type StoreHarness } from './contract.js';

const url = process.env.REDIS_URL;

if (!url) {
  describe.skip('RoomStore (Redis)', () => {
    it('precisa de REDIS_URL para rodar', () => {});
  });
} else {
  const harness: StoreHarness = {
    name: 'Redis',
    create<T>() {
      return createRedisStore<T>({ url });
    },
    // O TTL é do servidor: não há relógio para adiantar, só espera real. Daí a
    // sonda curta — o contrato é o mesmo, o custo é de segundos.
    async advance(ms) {
      await new Promise((resolve) => setTimeout(resolve, ms));
    },
    ttlProbeSeconds: 2,
  };

  beforeAll(async () => {
    const redis = new Redis(url);
    await redis.flushdb();
    await redis.quit();
  });

  describeRoomStoreContract(harness);
}
