/**
 * WebSocket de `05`, contra um servidor de verdade.
 *
 * Cobre CA-008, CA-044, CA-045, CA-124, CA-126 e o handshake de `05` §2. É
 * integração de propósito: o que se quer provar aqui — ordem das validações,
 * quem recebe o quê, quando o socket fecha — não sobrevive a um mock.
 */

import { randomBytes } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { serve } from '@hono/node-server';
import WebSocket from 'ws';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CLOSE_CODES, LIMITS, PROTOCOL_VERSION } from '@fdp/protocol';
import { createMemoryStore } from '@fdp/store';
import { createHttpApp } from '../src/http.js';
import { createHub, type Hub } from '../src/hub.js';
import { createPersistence } from '../src/persistence.js';
import { createSigner } from '../src/session.js';
import { attachWebSocket } from '../src/ws.js';

const SECRET = 'segredo-de-teste-com-32-caracteres!';
const CLIENT = fileURLToPath(new URL('../../app/index.html', import.meta.url));

interface Frame {
  type: string;
  stateVersion: number;
  payload: Record<string, unknown>;
}

let hub: Hub;
let server: ReturnType<typeof serve>;
let ws: { close(): void };
let base: string;
const abertos: Client[] = [];

interface Client {
  frames: Frame[];
  waitFor(type: string, timeoutMs?: number): Promise<Frame>;
  quiet(ms: number): Promise<void>;
  send(type: string, payload: unknown, id?: string): string;
  raw(text: string): void;
  closed: Promise<{ code: number }>;
  close(): void;
}

async function connect(code: string, token: string): Promise<Client> {
  const socket = new WebSocket(`${base}/api/rooms/${code}/ws?token=${encodeURIComponent(token)}`);
  const frames: Frame[] = [];
  socket.on('message', (data) => frames.push(JSON.parse(data.toString()) as Frame));

  const closed = new Promise<{ code: number }>((resolve) =>
    socket.on('close', (closeCode) => resolve({ code: closeCode })),
  );

  await new Promise<void>((resolve, reject) => {
    socket.on('open', () => resolve());
    socket.on('error', reject);
  });

  const client: Client = {
    frames,
    async waitFor(type, timeoutMs = 2000) {
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        const found = frames.find((f) => f.type === type);
        if (found) return found;
        if (Date.now() > deadline) {
          throw new Error(`não chegou "${type}"; chegaram: ${frames.map((f) => f.type).join(', ')}`);
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    },
    async quiet(ms) {
      await new Promise((resolve) => setTimeout(resolve, ms));
    },
    send(type, payload, id = randomBytes(8).toString('hex')) {
      socket.send(JSON.stringify({ v: PROTOCOL_VERSION, id, type, ts: Date.now(), payload }));
      return id;
    },
    raw(text) {
      socket.send(text);
    },
    closed,
    close: () => socket.close(),
  };
  abertos.push(client);
  return client;
}

async function criarSala(nickname = 'Ana'): Promise<{ code: string; token: string; playerId: string }> {
  const response = await fetch(`${base.replace('ws://', 'http://')}/api/rooms`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ nickname }),
  });
  const body = (await response.json()) as Record<string, string>;
  return { code: body.roomCode!, token: body.sessionToken!, playerId: body.playerId! };
}

async function entrar(code: string, nickname: string): Promise<{ token: string; playerId: string }> {
  const response = await fetch(`${base.replace('ws://', 'http://')}/api/rooms/${code}/join`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ nickname }),
  });
  const body = (await response.json()) as Record<string, string>;
  return { token: body.sessionToken!, playerId: body.playerId! };
}

beforeEach(async () => {
  hub = createHub({
    persistence: createPersistence({ store: createMemoryStore() }),
    randomSeed: () => randomBytes(16).toString('hex'),
  });
  const signer = createSigner(SECRET);
  const app = createHttpApp({ hub, signer, clientPath: CLIENT });

  server = serve({ fetch: app.fetch, port: 0 });
  await new Promise((resolve) => setTimeout(resolve, 20));
  const port = (server.address() as AddressInfo).port;
  base = `ws://127.0.0.1:${port}`;
  ws = attachWebSocket(server, { hub, signer });
});

afterEach(async () => {
  for (const client of abertos.splice(0)) client.close();
  ws.close();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('05 §2: handshake', () => {
  it('a primeira mensagem é sempre o snapshot', async () => {
    const sala = await criarSala();
    const client = await connect(sala.code, sala.token);

    const snapshot = await client.waitFor('room:snapshot');
    expect(client.frames[0]!.type).toBe('room:snapshot');
    expect(snapshot.stateVersion).toBeGreaterThan(0);
  });

  it('todo quadro do servidor carrega v, id, ts e stateVersion', async () => {
    const sala = await criarSala();
    const client = await connect(sala.code, sala.token);
    const snapshot = (await client.waitFor('room:snapshot')) as unknown as Record<string, unknown>;

    expect(snapshot.v).toBe(PROTOCOL_VERSION);
    expect(typeof snapshot.id).toBe('string');
    expect(typeof snapshot.ts).toBe('number');
    expect(typeof snapshot.stateVersion).toBe('number');
  });
});

describe('CA-008: token inválido', () => {
  it('token de outra sala recebe ERR-003 e o socket é fechado', async () => {
    const primeira = await criarSala('Ana');
    const segunda = await criarSala('Beto');

    const client = await connect(segunda.code, primeira.token);
    const erro = await client.waitFor('error');

    expect(erro.payload.code).toBe('INVALID_TOKEN');
    expect((await client.closed).code).toBe(CLOSE_CODES.INVALID_TOKEN);
  });

  it('token forjado não abre sala', async () => {
    const sala = await criarSala();
    const client = await connect(sala.code, 'nada.disso.aqui');

    expect((await client.waitFor('error')).payload.code).toBe('INVALID_TOKEN');
    expect((await client.closed).code).toBe(CLOSE_CODES.INVALID_TOKEN);
  });

  it('sala inexistente fecha com código próprio, não com erro genérico', async () => {
    const sala = await criarSala();
    const token = createSigner(SECRET).sign(sala.playerId, 'ZZZZZ', Date.now());

    const client = await connect('ZZZZZ', token);
    expect((await client.waitFor('error')).payload.code).toBe('ROOM_NOT_FOUND');
    expect((await client.closed).code).toBe(CLOSE_CODES.ROOM_NOT_FOUND);
  });

  it('caminho fora de /api/rooms/{code}/ws não faz upgrade', async () => {
    const socket = new WebSocket(`${base}/ws?token=x`);
    await expect(
      new Promise((_, reject) => {
        socket.on('error', reject);
        socket.on('open', () => reject(new Error('não deveria abrir')));
      }),
    ).rejects.toThrow();
  });
});

describe('CA-044: uma sessão, uma aba', () => {
  it('o segundo socket derruba o primeiro com ERR-409', async () => {
    const sala = await criarSala();
    const primeiro = await connect(sala.code, sala.token);
    await primeiro.waitFor('room:snapshot');

    const segundo = await connect(sala.code, sala.token);
    await segundo.waitFor('room:snapshot');

    expect((await primeiro.waitFor('error')).payload.code).toBe('SESSION_TAKEN');
    expect((await primeiro.closed).code).toBe(CLOSE_CODES.SESSION_TAKEN);
  });

  it('o close atrasado do socket antigo não desregistra o novo', async () => {
    const sala = await criarSala();
    const primeiro = await connect(sala.code, sala.token);
    await primeiro.waitFor('room:snapshot');

    const segundo = await connect(sala.code, sala.token);
    await segundo.waitFor('room:snapshot');
    await primeiro.closed;
    await segundo.quiet(50);

    // O socket vivo continua recebendo: um comando dele volta com ack.
    segundo.send('room:resync', {});
    await segundo.waitFor('ack');
  });
});

describe('05 §4: comandos e respostas', () => {
  it('comando aceito volta com ack ecoando o id', async () => {
    const sala = await criarSala();
    const client = await connect(sala.code, sala.token);
    await client.waitFor('room:snapshot');

    const id = client.send('player:setProfile', {
      nickname: 'Ana Maria',
      avatar: { emoji: '🐙', color: 'teal' },
    });

    const ack = await client.waitFor('ack');
    expect(ack.payload.commandId).toBe(id);
  });

  it('room:resync devolve um snapshot novo', async () => {
    const sala = await criarSala();
    const client = await connect(sala.code, sala.token);
    await client.waitFor('room:snapshot');
    client.frames.length = 0;

    client.send('room:resync', {});
    expect((await client.waitFor('room:snapshot')).stateVersion).toBe(hub.get(sala.code)!.stateVersion);
  });

  it('CA-022: comando de host vindo de não-host é recusado', async () => {
    const sala = await criarSala('Ana');
    const beto = await entrar(sala.code, 'Beto');
    const client = await connect(sala.code, beto.token);
    await client.waitFor('room:snapshot');

    client.send('host:startMatch', {});
    expect((await client.waitFor('error')).payload.code).toBe('NOT_HOST');
  });

  it('erro de comando ecoa o commandId para a UI saber a que se refere', async () => {
    const sala = await criarSala('Ana');
    const beto = await entrar(sala.code, 'Beto');
    const client = await connect(sala.code, beto.token);
    await client.waitFor('room:snapshot');

    const id = client.send('host:startMatch', {});
    expect((await client.waitFor('error')).payload.commandId).toBe(id);
  });
});

describe('CA-126 / ERR-426: validação na fronteira', () => {
  it('payload fora do schema recebe ERR-008 e não toca a lógica de jogo', async () => {
    const sala = await criarSala();
    const client = await connect(sala.code, sala.token);
    await client.waitFor('room:snapshot');
    const antes = hub.get(sala.code)!.stateVersion;

    client.send('player:setProfile', { nickname: '', avatar: 'não é avatar' });

    expect((await client.waitFor('error')).payload.code).toBe('VALIDATION_FAILED');
    expect(hub.get(sala.code)!.stateVersion).toBe(antes);
  });

  it('JSON quebrado responde erro em vez de silêncio', async () => {
    const sala = await criarSala();
    const client = await connect(sala.code, sala.token);
    await client.waitFor('room:snapshot');

    client.raw('{isso não é json');
    expect((await client.waitFor('error')).payload.code).toBe('VALIDATION_FAILED');
  });

  it('versão de protocolo incompatível pede recarregar a página', async () => {
    const sala = await criarSala();
    const client = await connect(sala.code, sala.token);
    await client.waitFor('room:snapshot');

    client.raw(JSON.stringify({ v: 99, id: 'x', type: 'room:resync', ts: Date.now(), payload: {} }));
    expect((await client.waitFor('error')).payload.code).toBe('PROTOCOL_VERSION');
  });

  it('RNF-011: mensagem acima de 32 KB é descartada antes de qualquer parse', async () => {
    const sala = await criarSala();
    const client = await connect(sala.code, sala.token);
    await client.waitFor('room:snapshot');
    client.frames.length = 0;

    client.raw(JSON.stringify({
      v: PROTOCOL_VERSION, id: 'x', type: 'room:resync', ts: Date.now(),
      payload: { lixo: 'x'.repeat(LIMITS.maxMessageBytes) },
    }));

    await client.quiet(150);
    expect(client.frames).toEqual([]);
  });
});

describe('CA-124: rate limit por conexão', () => {
  it('o excedente recebe ERR-009 com retryAfterMs', async () => {
    const sala = await criarSala();
    const client = await connect(sala.code, sala.token);
    await client.waitFor('room:snapshot');
    client.frames.length = 0;

    for (let i = 0; i < LIMITS.commandsPerWindow + 5; i++) client.send('room:resync', {});
    await client.quiet(200);

    const limitados = client.frames.filter((f) => f.payload?.code === 'RATE_LIMITED');
    expect(limitados).toHaveLength(5);
    expect(Number((limitados[0]!.payload.params as { retryAfterMs: number }).retryAfterMs))
      .toBeGreaterThan(0);
  });

  it('CA-339: o chat não tem cota própria — gasta o mesmo orçamento', async () => {
    const sala = await criarSala();
    const client = await connect(sala.code, sala.token);
    await client.waitFor('room:snapshot');
    client.frames.length = 0;

    // A consequência é deliberada: quem inunda o chat gasta o próprio direito
    // de jogar. O limite se paga sozinho, sem mecanismo novo (`05` §7).
    for (let i = 0; i < LIMITS.commandsPerWindow + 3; i++) {
      client.send('chat:send', { text: `spam ${i}` });
    }
    await client.quiet(200);

    const limitados = client.frames.filter((f) => f.payload?.code === 'RATE_LIMITED');
    expect(limitados).toHaveLength(3);

    // E, barrado, ele também não consegue mais jogar: é o mesmo balde.
    client.frames.length = 0;
    client.send('room:resync', {});
    await client.quiet(150);
    expect(client.frames.some((f) => f.payload?.code === 'RATE_LIMITED')).toBe(true);
  });

  it('o limite é por conexão: uma aba barrada não barra a outra', async () => {
    const sala = await criarSala('Ana');
    const beto = await entrar(sala.code, 'Beto');
    const ana = await connect(sala.code, sala.token);
    const cliente = await connect(sala.code, beto.token);
    await ana.waitFor('room:snapshot');
    await cliente.waitFor('room:snapshot');

    for (let i = 0; i < LIMITS.commandsPerWindow + 5; i++) ana.send('room:resync', {});
    await ana.quiet(200);

    cliente.frames.length = 0;
    cliente.send('room:resync', {});
    await cliente.waitFor('ack');
  });
});

describe('CA-045 / RNF-013: idempotência', () => {
  it('reenviar o mesmo id devolve o ack original sem reexecutar', async () => {
    const sala = await criarSala();
    const client = await connect(sala.code, sala.token);
    await client.waitFor('room:snapshot');

    const perfil = { nickname: 'Ana Maria', avatar: { emoji: '🐙', color: 'teal' } };
    const id = client.send('player:setProfile', perfil);
    await client.waitFor('ack');
    const depoisDoPrimeiro = hub.get(sala.code)!.stateVersion;

    client.frames.length = 0;
    client.send('player:setProfile', perfil, id);
    const repetido = await client.waitFor('ack');

    expect(repetido.payload.commandId).toBe(id);
    // O efeito não aconteceu duas vezes.
    expect(hub.get(sala.code)!.stateVersion).toBe(depoisDoPrimeiro);
  });

  it('ids diferentes executam os dois', async () => {
    const sala = await criarSala();
    const client = await connect(sala.code, sala.token);
    await client.waitFor('room:snapshot');
    const antes = hub.get(sala.code)!.stateVersion;

    client.send('player:setProfile', { nickname: 'Ana 1', avatar: { emoji: '🐙', color: 'teal' } });
    await client.waitFor('ack');
    client.frames.length = 0;
    client.send('player:setProfile', { nickname: 'Ana 2', avatar: { emoji: '🐸', color: 'rose' } });
    await client.waitFor('ack');

    expect(hub.get(sala.code)!.stateVersion).toBe(antes + 2);
  });
});

describe('05 §5: entrega por destinatário', () => {
  it('o evento de entrada chega a quem já estava na sala', async () => {
    const sala = await criarSala('Ana');
    const ana = await connect(sala.code, sala.token);
    await ana.waitFor('room:snapshot');
    ana.frames.length = 0;

    await entrar(sala.code, 'Beto');

    const evento = await ana.waitFor('room:playerJoined');
    expect((evento.payload.player as { nickname: string }).nickname).toBe('Beto');
  });

  it('RNF-065: o desligamento fecha os sockets pedindo reconexão', async () => {
    const sala = await criarSala();
    const client = await connect(sala.code, sala.token);
    await client.waitFor('room:snapshot');

    hub.closeAll(CLOSE_CODES.SERVER_RESTART);
    expect((await client.closed).code).toBe(CLOSE_CODES.SERVER_RESTART);
  });
});
