/**
 * Bootstrap: Hono + ws + desligamento gracioso (`11` §6).
 *
 * Um processo, todas as conexões de uma sala na mesma memória (`11` §1). O
 * Redis é durabilidade, não fonte da verdade: a sala vive aqui e é gravada
 * atrás, para que um deploy não vire queda seca (RNF-061, RNF-065).
 */

import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { serve } from '@hono/node-server';
import { createMemoryStore, type RoomStore } from '@fdp/store';
import { createHub, CLOSE_CODES } from './hub.js';
import { createHttpApp } from './http.js';
import { createPersistence } from './persistence.js';
import { createSigner } from './session.js';
import { attachWebSocket } from './ws.js';

const PORT = Number(process.env.PORT ?? 3000);
const REDIS_URL = process.env.REDIS_URL;
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN;
const TRUST_PROXY = process.env.TRUST_PROXY === '1';
const VERSION = process.env.FDP_VERSION ?? 'dev';
const PRODUCTION = process.env.NODE_ENV === 'production';

/** Ritmo do relógio de sala (`03` §2.1) e da gravação write-behind. */
const TICK_MS = 250;
const PERSIST_MS = 1_000;

/**
 * Segredo de sessão. Em produção é obrigatório; em desenvolvimento aceita-se um
 * efêmero — mas efêmero de verdade, gerado a cada subida. Um segredo padrão
 * versionado seria pior que nenhum, porque pareceria configurado.
 */
function sessionSecret(): string {
  const configured = process.env.FDP_SESSION_SECRET;
  if (configured) return configured;
  if (PRODUCTION) {
    console.error('FDP_SESSION_SECRET é obrigatório em produção (RNF-075)');
    process.exit(1);
  }
  console.warn('FDP_SESSION_SECRET ausente: usando segredo efêmero de desenvolvimento.');
  console.warn('As sessões morrem a cada reinício do servidor.');
  return randomBytes(32).toString('hex');
}

async function main(): Promise<void> {
  const store: RoomStore<unknown> = REDIS_URL
    ? (await import('@fdp/store/redis')).createRedisStore({ url: REDIS_URL })
    : createMemoryStore();

  if (!REDIS_URL) {
    console.warn('REDIS_URL ausente: store em memória. As salas morrem com o processo.');
  }

  const persistence = createPersistence({
    store,
    // Falha de gravação não derruba partida: o estado vivo está na memória e a
    // próxima volta do ciclo tenta de novo. Perder durabilidade é ruim; perder
    // a partida em curso por causa disso seria pior.
    onError: (error) => console.error('falha ao persistir sala:', error),
  });

  const hub = createHub({
    persistence,
    randomSeed: () => randomBytes(16).toString('hex'), // RJ-144
  });

  // RNF-061 / CA-046: as salas vivas voltam antes de aceitar conexão.
  const restored = await persistence.load();
  for (const room of restored) hub.adopt(room);
  if (restored.length > 0) console.log(`recarregadas ${restored.length} sala(s) do store`);

  // Um assinante só: em desenvolvimento o segredo é gerado na subida, e dois
  // assinantes seriam dois segredos — o token emitido no HTTP não validaria no
  // WebSocket, e o sintoma seria "não consigo conectar" sem causa aparente.
  const signer = createSigner(sessionSecret());

  const app = createHttpApp({
    hub,
    signer,
    clientPath: fileURLToPath(new URL('../../app/index.html', import.meta.url)),
    allowedOrigin: ALLOWED_ORIGIN,
    trustProxy: TRUST_PROXY,
    version: VERSION,
  });

  const server = serve({ fetch: app.fetch, port: PORT }, (info) => {
    console.log(`FDP em http://localhost:${info.port}`);
  });

  const ws = attachWebSocket(server, {
    hub,
    signer,
    allowedOrigin: ALLOWED_ORIGIN,
    onSuspicion: (event) =>
      console.warn(`suspeita ${event.code} sala=${event.roomCode} jogador=${event.playerId}`),
  });

  const clock = setInterval(() => hub.advance(Date.now()), TICK_MS);
  const writer = setInterval(() => void persistence.flush(), PERSIST_MS);

  /**
   * RNF-065. A ordem importa: fechar os sockets primeiro faz cada cliente
   * começar a reconectar dentro de `TRANSPORT_GRACE`, e a janela de deploy cabe
   * nela sem que a mesa pause. Gravar antes de sair é o que faz a sala voltar
   * do mesmo `stateVersion` (CA-046).
   */
  let leaving = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (leaving) return;
    leaving = true;
    console.log(`${signal}: fechando sockets e persistindo salas`);

    clearInterval(clock);
    clearInterval(writer);
    hub.closeAll(CLOSE_CODES.SERVER_RESTART);
    ws.close();

    await persistence.flush();
    await store.close().catch(() => {});
    server.close(() => process.exit(0));

    // Rede pendurada não pode segurar um deploy indefinidamente.
    setTimeout(() => process.exit(0), 5_000).unref();
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

void main();
