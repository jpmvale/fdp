/**
 * WebSocket (`05`): handshake, envelope e roteamento de comandos.
 *
 * A ordem de `11` §5 é seguida à risca — autenticar, limitar, validar, aplicar,
 * entregar. Ela não é arbitrária: limitar antes de validar impede que payload
 * inválido em rajada custe schema; validar antes de aplicar garante que a
 * lógica de jogo nunca vê dado de cliente cru (RNF-072, CA-126).
 */

import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer, type WebSocket } from 'ws';
import { CLOSE_CODES, LIMITS, type ServerEvent } from '@fdp/protocol';
import { isWithinSizeLimit, parseClientMessage } from '@fdp/protocol/validate';
import { applyCommand, disconnect, reconnect, snapshotFor } from '@fdp/room';
import type { PlayerId } from '@fdp/rules';
import type { Hub } from './hub.js';
import { createIdempotencyCache, createRateLimiter } from './limits.js';
import type { SessionSigner } from './session.js';

export interface WsOptions {
  hub: Hub;
  signer: SessionSigner;
  now?: () => number;
  /** Origens aceitas no upgrade. Vazio = aceita qualquer uma (dev). */
  allowedOrigin?: string | undefined;
  onSuspicion?: (event: { code: string; roomCode: string; playerId: PlayerId }) => void;
}

/** `/api/rooms/{code}/ws` — o código na rota confina o token àquela sala. */
const WS_PATH = /^\/api\/rooms\/([^/]+)\/ws$/;

/**
 * `05` §2 pede detecção de conexão morta em 45 s.
 *
 * O batimento é do servidor, não do cliente: JavaScript de navegador não
 * consegue emitir um frame de ping, mas o navegador responde ao ping do
 * servidor automaticamente. Fazer o cliente mandar um comando de ping seria
 * inventar protocolo para resolver um problema que o próprio WebSocket já
 * resolve.
 */
const HEARTBEAT_MS = 20_000;
const HEARTBEAT_TIMEOUT_MS = 45_000;

interface Attached {
  code: string;
  playerId: PlayerId;
}

/**
 * Só o que é de fato usado do servidor HTTP. Pedir um `http.Server` inteiro
 * obrigaria o chamador a converter o retorno do `@hono/node-server`, que é
 * `Server | Http2Server` — conversão sem ganho nenhum.
 */
export interface Upgradable {
  on(event: 'upgrade', listener: (req: IncomingMessage, socket: Duplex, head: Buffer) => void): unknown;
}

export function attachWebSocket(server: Upgradable, options: WsOptions): { close(): void } {
  const { hub, signer } = options;
  const now = options.now ?? Date.now;
  const wss = new WebSocketServer({ noServer: true });
  const lastSeen = new WeakMap<WebSocket, number>();

  const refuse = (socket: Duplex, status: string): void => {
    socket.write(`HTTP/1.1 ${status}\r\nConnection: close\r\n\r\n`);
    socket.destroy();
  };

  server.on('upgrade', (request: IncomingMessage, socket: Duplex, head: Buffer) => {
    const url = new URL(request.url ?? '/', 'http://localhost');
    const match = WS_PATH.exec(url.pathname);
    if (!match) return refuse(socket, '404 Not Found');

    // Origem cruzada não abre socket: o navegador não aplica CORS a WebSocket,
    // então checar aqui é a única defesa contra sala aberta por outro site.
    const origin = request.headers.origin;
    if (options.allowedOrigin && origin !== undefined && origin !== options.allowedOrigin) {
      return refuse(socket, '403 Forbidden');
    }

    const code = (match[1] ?? '').toUpperCase();
    const token = url.searchParams.get('token') ?? '';
    const verified = signer.verify(token, now(), code);

    wss.handleUpgrade(request, socket, head, (ws) => {
      // CA-008: token de outra sala recebe `ERR-003` **e** o socket fecha. O
      // upgrade é concluído só para que a recusa chegue como erro do protocolo,
      // e não como um `close` mudo que o cliente não sabe interpretar.
      if (!verified.ok) {
        hub.sendError(ws, { code: 'INVALID_TOKEN', params: { motivo: verified.reason } }, 0);
        ws.close(CLOSE_CODES.INVALID_TOKEN, 'sessão inválida');
        return;
      }
      wss.emit('connection', ws, request, {
        code: verified.claims.roomCode,
        playerId: verified.claims.playerId,
      } satisfies Attached);
    });
  });

  wss.on('connection', (ws: WebSocket, _request: IncomingMessage, session: Attached) => {
    const { code, playerId } = session;
    const room = hub.get(code);
    if (!room || room.status === 'ENCERRADA') {
      hub.sendError(ws, { code: 'ROOM_NOT_FOUND' }, 0);
      ws.close(CLOSE_CODES.ROOM_NOT_FOUND, 'sala não existe');
      return;
    }

    // Uma sessão, uma aba (CA-044). O anterior sai sabendo por quê — "aberto em
    // outra aba" é uma explicação; um socket que morre sozinho não é.
    const previous = hub.socketOf(code, playerId);
    if (previous && previous !== ws) {
      hub.sendError(previous, { code: 'SESSION_TAKEN' }, room.stateVersion);
      previous.close(CLOSE_CODES.SESSION_TAKEN, 'sessão assumida em outra aba');
    }
    hub.attach(code, playerId, ws);
    lastSeen.set(ws, now());

    // RNF-010 e RNF-013 são por conexão: o limite protege o servidor de um
    // cliente, e a idempotência protege o jogador do próprio reenvio.
    const rate = createRateLimiter({
      limit: LIMITS.commandsPerWindow,
      windowMs: LIMITS.commandWindowMs,
    });
    const seen = createIdempotencyCache<ServerEvent>(LIMITS.idempotencyWindowMs);

    const back = reconnect(room, playerId, hub.ctx());
    if (back.ok) {
      hub.commit(back);
      // O snapshot vai primeiro, sempre: o cliente adota o estado inteiro antes
      // de receber qualquer evento incremental (`05` §2).
      hub.send(ws, snapshotFor(back.room, playerId) as ServerEvent, back.room.stateVersion);
    } else {
      hub.send(ws, snapshotFor(room, playerId) as ServerEvent, room.stateVersion);
    }

    ws.on('pong', () => lastSeen.set(ws, now()));

    ws.on('message', (raw) => {
      lastSeen.set(ws, now());
      const text = raw.toString();
      if (!isWithinSizeLimit(text)) return; // RNF-011

      const current = hub.get(code);
      if (!current) return;
      const version = current.stateVersion;

      const decision = rate.check(playerId, now());
      if (!decision.allowed) {
        // CA-124: o excedente recebe `retryAfterMs`, não silêncio — um cliente
        // que não sabe quando voltar volta imediatamente, e piora tudo.
        hub.sendError(ws, {
          code: 'RATE_LIMITED',
          params: { retryAfterMs: decision.retryAfterMs },
        }, version);
        return;
      }

      let payload: unknown;
      try {
        payload = JSON.parse(text);
      } catch {
        hub.sendError(ws, { code: 'VALIDATION_FAILED' }, version);
        return;
      }

      const parsed = parseClientMessage(payload);
      if (!parsed.ok) {
        hub.sendError(ws, { code: parsed.code, params: { issues: parsed.issues } }, version);
        return;
      }

      const commandId = parsed.value.envelope.id;

      // RNF-013 / CA-045: reenvio dentro da janela devolve a resposta original
      // sem reexecutar. Sem isto, uma carta jogada pode ser jogada duas vezes.
      const remembered = seen.recall(commandId, now());
      if (remembered) {
        hub.send(ws, remembered, version);
        return;
      }

      const result = applyCommand(current, playerId, parsed.value.command, hub.ctx());
      if (!result.ok) {
        const error: ServerEvent = {
          type: 'error',
          payload: { commandId, code: result.code, params: { motivo: result.motivo } },
        };
        if (result.code === 'FORBIDDEN_CARD') {
          // CA-121: carta que não é do jogador não é erro de digitação.
          options.onSuspicion?.({ code: result.code, roomCode: code, playerId });
        }
        // Erro não entra na janela de idempotência: a condição que o causou
        // pode ter mudado, e devolver o mesmo "não" para sempre seria mentira.
        hub.send(ws, error, version);
        return;
      }

      hub.commit(result);
      const ack: ServerEvent = { type: 'ack', payload: { commandId } };
      seen.remember(commandId, ack, now());
      hub.send(ws, ack, result.room.stateVersion);
    });

    ws.on('close', () => {
      hub.detach(code, playerId, ws);
      const live = hub.get(code);
      if (!live) return;
      // Não é ausência ainda: começa a carência de transporte (RJ-117a).
      hub.commit(disconnect(live, playerId, hub.ctx()));
    });
  });

  const heartbeat = setInterval(() => {
    const at = now();
    for (const ws of wss.clients) {
      if (at - (lastSeen.get(ws) ?? at) > HEARTBEAT_TIMEOUT_MS) {
        ws.terminate();
        continue;
      }
      if (ws.readyState === ws.OPEN) ws.ping();
    }
  }, HEARTBEAT_MS);
  heartbeat.unref();

  return {
    close() {
      clearInterval(heartbeat);
      wss.close();
    },
  };
}
