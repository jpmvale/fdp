/**
 * Servidor do FDP: HTTP de `06` + WebSocket de `05`.
 *
 * Um processo, todas as conexões na mesma memória (`11` §1). O broadcast é um
 * laço sobre sockets; a atomicidade vem do laço de eventos do Node.
 *
 * Estado ainda em memória — o `RoomStore` em Redis entra depois, atrás da
 * interface que já existe.
 */

import type { IncomingMessage } from 'node:http';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { WebSocketServer, type WebSocket } from 'ws';
import { LIMITS, type Avatar } from '@fdp/protocol';
import { isWithinSizeLimit, parseClientMessage } from '@fdp/protocol/validate';
import {
  applyCommand,
  createRoom,
  disconnect,
  generateFreeCode,
  join,
  nextDeadline,
  normalizeCode,
  reconnect,
  seatedPlayers,
  snapshotFor,
  tick,
  type Emission,
  type Room,
  type RoomCtx,
} from '@fdp/room';

const PORT = Number(process.env.PORT ?? 3000);

const rooms = new Map<string, Room>();
interface Session {
  code: string;
  playerId: string;
}

/**
 * token → sessão. **Provisório**: vive na memória e cai com o processo. A
 * versão de produção usa JWT assinado, escopado à sala (`06` §4).
 */
const sessions = new Map<string, Session>();
const sockets = new Map<string, Map<string, WebSocket>>();

const ctx = (): RoomCtx => ({
  now: Date.now(),
  randomSeed: () => randomBytes(16).toString('hex'), // RJ-144
  newId: () => randomUUID(),
});

// ---------------------------------------------------------------------------
// Entrega
// ---------------------------------------------------------------------------

function send(socket: WebSocket | undefined, event: unknown, stateVersion: number): void {
  if (!socket || socket.readyState !== socket.OPEN) return;
  socket.send(JSON.stringify({ v: 1, id: randomUUID(), ts: Date.now(), stateVersion, ...(event as object) }));
}

function deliver(room: Room, emissions: Emission[]): void {
  const peers = sockets.get(room.code);
  if (!peers || emissions.length === 0) return;
  for (const emission of emissions) {
    if (emission.audience === 'ALL') {
      for (const socket of peers.values()) send(socket, emission.event, room.stateVersion);
    } else {
      send(peers.get(emission.audience.playerId), emission.event, room.stateVersion);
    }
  }
}

/** Ponto único de escrita: nada muda a sala sem passar por aqui. */
function commit(result: ReturnType<typeof applyCommand>, code: string): void {
  if (!result.ok) return;
  rooms.set(code, result.room);
  deliver(result.room, result.emissions);
}

// ---------------------------------------------------------------------------
// Relógio (`03` §2.1)
// ---------------------------------------------------------------------------

setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms) {
    // Só acorda quem tem compromisso vencido — não varre à toa.
    const deadline = nextDeadline(room);
    if (deadline !== null && now < deadline) continue;

    const result = tick(room, ctx());
    if (!result.changed) continue;
    rooms.set(code, result.room);
    deliver(result.room, result.emissions);
    if (result.room.status === 'ENCERRADA') {
      rooms.delete(code);
      sockets.delete(code);
    }
  }
}, 250);

// ---------------------------------------------------------------------------
// HTTP (`06`)
// ---------------------------------------------------------------------------

const app = new Hono();

const AVATARS: Avatar[] = [
  { emoji: '🦊', color: 'amber' }, { emoji: '🐙', color: 'teal' },
  { emoji: '🐸', color: 'rose' }, { emoji: '🦁', color: 'indigo' },
  { emoji: '🐼', color: 'lime' }, { emoji: '🦉', color: 'sky' },
  { emoji: '🐺', color: 'orange' }, { emoji: '🦝', color: 'violet' },
];

function freeAvatar(room: Room | null): Avatar {
  const taken = new Set((room?.players ?? []).map((p) => `${p.avatar.emoji}${p.avatar.color}`));
  return AVATARS.find((a) => !taken.has(`${a.emoji}${a.color}`)) ?? AVATARS[0]!;
}

function newSession(code: string, playerId: string): string {
  const token = randomBytes(24).toString('hex');
  sessions.set(token, { code, playerId });
  return token;
}

app.post('/api/rooms', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { nickname?: string };
  const nickname = (body.nickname ?? '').trim() || 'Anfitrião';
  const code = generateFreeCode((n) => randomBytes(n), (candidate) => rooms.has(candidate));
  const playerId = randomUUID();

  const room = createRoom(code, { playerId, nickname, avatar: AVATARS[0]! }, ctx());
  rooms.set(code, room);
  sockets.set(code, new Map());

  return c.json({ roomCode: code, playerId, sessionToken: newSession(code, playerId) }, 201);
});

app.get('/api/rooms/:code', (c) => {
  const room = rooms.get(normalizeCode(c.req.param('code')));
  if (!room || room.status === 'ENCERRADA') return c.json({ code: 'ROOM_NOT_FOUND' }, 404);
  return c.json({
    roomCode: room.code,
    status: room.status,
    playerCount: seatedPlayers(room).length,
    maxPlayers: LIMITS.maxPlayers,
  });
});

app.post('/api/rooms/:code/join', async (c) => {
  const code = normalizeCode(c.req.param('code'));
  const room = rooms.get(code);
  if (!room || room.status === 'ENCERRADA') return c.json({ code: 'ROOM_NOT_FOUND' }, 404);

  const body = (await c.req.json().catch(() => ({}))) as { nickname?: string };
  const nickname = (body.nickname ?? '').trim() || 'Jogador';
  const playerId = randomUUID();

  const result = join(room, { playerId, nickname, avatar: freeAvatar(room) }, ctx());
  if (!result.ok) return c.json({ code: result.code, motivo: result.motivo }, 409);

  rooms.set(code, result.room);
  deliver(result.room, result.emissions);
  return c.json({ roomCode: code, playerId, sessionToken: newSession(code, playerId) });
});

app.get('/api/health', (c) => c.json({ ok: true, rooms: rooms.size }));

// Cliente: um arquivo, servido do disco. Recarrega a cada request para que
// editar o HTML não exija reiniciar o servidor.
const clientPath = fileURLToPath(new URL('../../app/index.html', import.meta.url));
app.get('*', (c) => c.html(readFileSync(clientPath, 'utf8')));

// ---------------------------------------------------------------------------
// WebSocket (`05`)
// ---------------------------------------------------------------------------

const server = serve({ fetch: app.fetch, port: PORT }, (info) => {
  console.log(`FDP em http://localhost:${info.port}`);
});

const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (request, socket, head) => {
  const url = new URL(request.url ?? '/', 'http://localhost');
  if (url.pathname !== '/ws') return socket.destroy();

  const session = sessions.get(url.searchParams.get('token') ?? '');
  if (!session) return socket.destroy();

  wss.handleUpgrade(request, socket, head, (ws) => {
    wss.emit('connection', ws, request, session);
  });
});

wss.on('connection', (ws: WebSocket, _req: IncomingMessage, session: Session) => {
  const { code, playerId } = session;
  const room = rooms.get(code);
  if (!room) return ws.close();

  // Uma sessão, um socket: derruba o anterior para duas abas não divergirem.
  const peers = sockets.get(code) ?? new Map();
  peers.get(playerId)?.close();
  peers.set(playerId, ws);
  sockets.set(code, peers);

  const back = reconnect(room, playerId, ctx());
  if (back.ok) {
    rooms.set(code, back.room);
    // O snapshot vai primeiro, sempre: o cliente adota o estado inteiro antes
    // de receber qualquer evento incremental.
    send(ws, snapshotFor(back.room, playerId), back.room.stateVersion);
    deliver(back.room, back.emissions);
  }

  ws.on('message', (raw) => {
    const text = raw.toString();
    if (!isWithinSizeLimit(text)) return; // RNF-011

    let payload: unknown;
    try {
      payload = JSON.parse(text);
    } catch {
      return;
    }

    const parsed = parseClientMessage(payload);
    const current = rooms.get(code);
    if (!current) return;

    if (!parsed.ok) {
      send(ws, { type: 'error', payload: { code: parsed.code, params: { issues: parsed.issues } } }, current.stateVersion);
      return;
    }

    const result = applyCommand(current, playerId, parsed.value.command, ctx());
    if (!result.ok) {
      send(ws, {
        type: 'error',
        payload: { commandId: parsed.value.envelope.id, code: result.code, params: { motivo: result.motivo } },
      }, current.stateVersion);
      return;
    }
    commit(result, code);
  });

  ws.on('close', () => {
    if (sockets.get(code)?.get(playerId) === ws) sockets.get(code)?.delete(playerId);
    const current = rooms.get(code);
    if (!current) return;
    // Não é ausência ainda: começa a carência de transporte (RJ-117a).
    const result = disconnect(current, playerId, ctx());
    if (result.ok) {
      rooms.set(code, result.room);
      deliver(result.room, result.emissions);
    }
  });
});
