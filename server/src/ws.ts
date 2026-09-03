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
import { applyCommand, disconnect, foiExpulso, reconnect, snapshotFor } from '@fdp/room';
import type { PlayerId } from '@fdp/rules';
import type { Hub } from './hub.js';
import { createIdempotencyCache, createRateLimiter } from './limits.js';
import type { SessionSigner } from './session.js';
import type { FilaViva } from './fila-viva.js';
import { atenderFila } from './fila-ws.js';
import type { Dados } from '@fdp/contas';

export interface WsOptions {
  hub: Hub;
  signer: SessionSigner;
  now?: () => number;
  /** Origens aceitas no upgrade. Vazio = aceita qualquer uma (dev). */
  allowedOrigin?: string | undefined;
  onSuspicion?: (event: { code: string; roomCode: string; playerId: PlayerId }) => void;
  /** Atrás do Caddy o IP verdadeiro vem em `X-Forwarded-For`. Ver `enderecoDe`. */
  trustProxy?: boolean | undefined;
  /**
   * A fila. **Opcional de propósito**: sem ela o socket de fila responde 404 e
   * o jogo continua inteiro — a fila é mais um caminho, nunca o caminho (plano
   * 03, I-1).
   */
  fila?: FilaViva | null;
  /** Para saber quem está logado no `fila:entrar` da ranqueada. */
  dados?: Dados | null;
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

/** O socket da fila: sem sala, sem jogador — ainda. */
interface NaFila {
  fila: true;
}

type Sessao = Attached | NaFila;

/** O caminho da fila. Sem código de sala: a sala é o que ela vai produzir. */
const FILA_PATH = '/api/fila/ws';

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
  const fila = options.fila ?? null;
  const now = options.now ?? Date.now;
  const wss = new WebSocketServer({ noServer: true });
  const lastSeen = new WeakMap<WebSocket, number>();

  const refuse = (socket: Duplex, status: string): void => {
    socket.write(`HTTP/1.1 ${status}\r\nConnection: close\r\n\r\n`);
    socket.destroy();
  };

  server.on('upgrade', (request: IncomingMessage, socket: Duplex, head: Buffer) => {
    const url = new URL(request.url ?? '/', 'http://localhost');
    const naFila = url.pathname === FILA_PATH;
    const match = naFila ? null : WS_PATH.exec(url.pathname);
    if (!naFila && !match) return refuse(socket, '404 Not Found');

    // Origem cruzada não abre socket: o navegador não aplica CORS a WebSocket,
    // então checar aqui é a única defesa contra sala aberta por outro site.
    const origin = request.headers.origin;
    if (options.allowedOrigin && origin !== undefined && origin !== options.allowedOrigin) {
      return refuse(socket, '403 Forbidden');
    }

    /**
     * O socket da fila não tem sala, e por isso não tem token de sala.
     *
     * A identidade dele chega DEPOIS, no `fila:entrar` — apelido e avatar para
     * quem não tem conta, cookie de sessão para quem tem. Exigir token aqui
     * seria exigir uma sala que ainda não existe: é exatamente ela que a fila
     * está tentando criar.
     */
    if (naFila) {
      if (!fila) return refuse(socket, '404 Not Found');
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request, { fila: true } satisfies NaFila);
      });
      return;
    }

    const code = (match![1] ?? '').toUpperCase();
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

  wss.on('connection', (ws: WebSocket, request: IncomingMessage, session: Sessao) => {
    if ('fila' in session) {
      atenderFila(ws, request, fila!, {
        signer, dados: options.dados ?? null, now, lastSeen,
        endereco: enderecoDe(request, options.trustProxy ?? false),
      });
      return;
    }

    const { code, playerId } = session;
    const room = hub.get(code);
    if (!room || room.status === 'ENCERRADA') {
      hub.sendError(ws, { code: 'ROOM_NOT_FOUND' }, 0);
      ws.close(CLOSE_CODES.ROOM_NOT_FOUND, 'sala não existe');
      return;
    }

    /**
     * RF-096: expulso no meio da partida não abre socket.
     *
     * O assento existe e está jogando — com um bot dentro —, então nada abaixo
     * recusaria esta conexão: o snapshot sairia, com a projeção do assento, e
     * quem levou o pé continuaria vendo a mão que agora é do bot. A recusa
     * precisa acontecer aqui, antes de qualquer envio.
     */
    const eu = room.players.find((p) => p.id === playerId);
    if (eu && foiExpulso(eu)) {
      hub.sendError(ws, { code: 'INVALID_TOKEN', params: { motivo: 'EXPULSO' } }, room.stateVersion);
      ws.close(CLOSE_CODES.INVALID_TOKEN, 'expulso da sala');
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

/**
 * De onde a conexão veio, para o teto de bilhetes por endereço da fila.
 *
 * Mesma regra do `clientIp` do HTTP, e mesma cautela: `x-forwarded-for` é um
 * cabeçalho que QUALQUER cliente escreve, então só vale quando há um proxy na
 * frente que o reescreve. Confiar nele sem proxy entrega o teto de graça — quem
 * quisesse burlá-lo bastaria mandar um endereço diferente a cada socket.
 */
function enderecoDe(request: IncomingMessage, confiaNoProxy: boolean): string {
  if (confiaNoProxy) {
    const cabecalho = request.headers['x-forwarded-for'];
    const primeiro = (Array.isArray(cabecalho) ? cabecalho[0] : cabecalho)?.split(',')[0]?.trim();
    if (primeiro) return primeiro;
  }
  return request.socket.remoteAddress ?? 'desconhecido';
}
