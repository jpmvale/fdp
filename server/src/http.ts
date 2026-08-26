/**
 * Endpoints HTTP (`06`).
 *
 * O HTTP cobre só o que acontece **antes** de existir um WebSocket: criar sala,
 * verificar sala e obter sessão. Nenhum endpoint aqui expõe estado de partida —
 * nem placar, nem cartas (RNF-004).
 */

import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { extname, join as caminhoDe } from 'node:path';
import { Hono } from 'hono';
import type { HttpBindings } from '@hono/node-server';
import {
  PROTOCOL_VERSION,
  AVATAR_COLORS,
  AVATAR_EMOJIS,
  LIMITS,
  type Avatar,
  type ErrorCode,
} from '@fdp/protocol';
import { avatarSchema, nicknameSchema, roomCodeSchema } from '@fdp/protocol/validate';
import {
  createRoom,
  generateFreeCode,
  isPresent,
  join,
  seatedPlayers,
  spectators,
  type Room,
} from '@fdp/room';
import type { Hub } from './hub.js';
import { createRateLimiter } from './limits.js';
import type { SessionSigner } from './session.js';

export interface HttpOptions {
  hub: Hub;
  signer: SessionSigner;
  /** Caminho do cliente servido do disco. Recarrega a cada request em dev. */
  clientPath: string;
  now?: () => number;
  /** Origem permitida em CORS (RNF-002). Ausente = só mesma origem. */
  allowedOrigin?: string | undefined;
  /** Atrás do Caddy o IP verdadeiro vem em `X-Forwarded-For`. */
  trustProxy?: boolean;
  version?: string;
}

/** Avatar de quem não escolheu. A sala troca se já estiver tomado. */
const PADRAO: Avatar = { emoji: AVATAR_EMOJIS[0]!, color: AVATAR_COLORS[0]! };

interface Identity {
  nickname: string;
  avatar?: Avatar | undefined;
}

/** RNF-072: nada de cliente chega à lógica de jogo sem passar por schema. */
function parseIdentity(body: unknown): { ok: true; value: Identity } | { ok: false } {
  const raw = (body ?? {}) as { nickname?: unknown; avatar?: unknown };
  const nickname = nicknameSchema.safeParse(raw.nickname);
  if (!nickname.success) return { ok: false };

  if (raw.avatar === undefined) return { ok: true, value: { nickname: nickname.data } };
  const avatar = avatarSchema.safeParse(raw.avatar);
  if (!avatar.success) return { ok: false };
  return { ok: true, value: { nickname: nickname.data, avatar: avatar.data } };
}

export function createHttpApp(options: HttpOptions): Hono<{ Bindings: HttpBindings }> {
  const { hub, signer, clientPath } = options;
  const now = options.now ?? Date.now;
  const version = options.version ?? 'dev';

  // RNF-003. Janelas de uma hora, por IP.
  const createLimit = createRateLimiter({ limit: 10, windowMs: 60 * 60_000 });
  const joinLimit = createRateLimiter({ limit: 60, windowMs: 60 * 60_000 });

  const app = new Hono<{ Bindings: HttpBindings }>();

  const clientIp = (c: { env: HttpBindings; req: { header(name: string): string | undefined } }): string => {
    if (options.trustProxy) {
      // O primeiro da lista é o cliente; os demais são proxies encadeados.
      const forwarded = c.req.header('x-forwarded-for')?.split(',')[0]?.trim();
      if (forwarded) return forwarded;
    }
    return c.env.incoming.socket.remoteAddress ?? 'desconhecido';
  };

  const wsUrl = (c: { req: { header(name: string): string | undefined } }, code: string): string => {
    const host = c.req.header('host') ?? 'localhost';
    const secure = (c.req.header('x-forwarded-proto') ?? '').split(',')[0]?.trim() === 'https';
    return `${secure ? 'wss' : 'ws'}://${host}/api/rooms/${code}/ws`;
  };

  // RNF-005: cabeçalhos de segurança em toda resposta.
  app.use('*', async (c, next) => {
    // Nonce por resposta: é o que permite CSP sem `unsafe-inline` (RNF-078)
    // mesmo com o cliente provisório, que ainda é um arquivo só.
    const nonce = randomBytes(16).toString('base64');
    c.set('nonce' as never, nonce as never);

    await next();

    c.header('X-Content-Type-Options', 'nosniff');
    c.header('Referrer-Policy', 'no-referrer');
    c.header('X-Frame-Options', 'DENY');
    c.header(
      'Content-Security-Policy',
      [
        "default-src 'self'",
        `script-src 'nonce-${nonce}'`,
        // RNF-078 restringe `unsafe-inline` a **script**, e é o que dá para
        // fazer: um nonce cobre elementos `<style>`, mas não atributos
        // `style=`, que o cliente provisório usa em toda parte. Quando a UI de
        // `07` chegar com CSS Modules, isto aperta para `'self'`.
        `style-src 'self' 'unsafe-inline'`,
        "img-src 'self' data:",
        // `'self'` cobre ws/wss da mesma origem; não há endpoint externo.
        "connect-src 'self'",
        "base-uri 'none'",
        "form-action 'none'",
        "frame-ancestors 'none'",
        "object-src 'none'",
      ].join('; '),
    );

    // RNF-002: CORS restrito. Sem origem configurada, só mesma origem — que é
    // o caso do deploy de `11` §1, com o Caddy servindo tudo do mesmo host.
    const origin = c.req.header('origin');
    if (options.allowedOrigin && origin === options.allowedOrigin) {
      c.header('Access-Control-Allow-Origin', origin);
      c.header('Vary', 'Origin');
    }
  });

  const fail = (code: ErrorCode, params?: Record<string, unknown>) =>
    params ? { code, params } : { code };

  const limited = (retryAfterMs: number) => fail('RATE_LIMITED', { retryAfterMs });

  app.post('/api/rooms', async (c) => {
    const rate = createLimit.check(clientIp(c), now());
    if (!rate.allowed) return c.json(limited(rate.retryAfterMs), 429);

    const identity = parseIdentity(await c.req.json().catch(() => ({})));
    if (!identity.ok) return c.json(fail('VALIDATION_FAILED'), 422);

    const code = generateFreeCode(
      (n) => randomBytes(n),
      (candidate) => hub.get(candidate) !== undefined,
    );
    const playerId = randomUUID();
    const ctx = hub.ctx();

    hub.adopt(
      createRoom(
        code,
        // Sala nova: não há com quem colidir, então o host leva o que pediu.
        { playerId, nickname: identity.value.nickname, avatar: identity.value.avatar ?? PADRAO },
        ctx,
      ),
    );

    return c.json(
      {
        roomCode: code,
        playerId,
        sessionToken: signer.sign(playerId, code, ctx.now),
        wsUrl: wsUrl(c, code),
      },
      201,
    );
  });

  app.get('/api/rooms/:code', (c) => {
    // Consulta pública: leve, `no-store`, e sem nada de partida (RNF-004/006).
    c.header('Cache-Control', 'no-store');

    const parsed = roomCodeSchema.safeParse(c.req.param('code'));
    if (!parsed.success) return c.json(fail('ROOM_NOT_FOUND'), 404);

    const room = hub.get(parsed.data);
    if (!room || room.status === 'ENCERRADA') return c.json(fail('ROOM_NOT_FOUND'), 404);

    return c.json({
      roomCode: room.code,
      status: room.status,
      playerCount: seatedPlayers(room).length,
      maxPlayers: LIMITS.maxPlayers,
      canJoinAsPlayer:
        room.status === 'LOBBY' && seatedPlayers(room).length < LIMITS.maxPlayers,
      canJoinAsSpectator: spectators(room).length < LIMITS.maxSpectators,
    });
  });

  app.post('/api/rooms/:code/join', async (c) => {
    const rate = joinLimit.check(clientIp(c), now());
    if (!rate.allowed) return c.json(limited(rate.retryAfterMs), 429);

    const parsed = roomCodeSchema.safeParse(c.req.param('code'));
    if (!parsed.success) return c.json(fail('ROOM_NOT_FOUND'), 404);

    const room = hub.get(parsed.data);
    if (!room || room.status === 'ENCERRADA') return c.json(fail('ROOM_NOT_FOUND'), 404);

    const identity = parseIdentity(await c.req.json().catch(() => ({})));
    if (!identity.ok) return c.json(fail('VALIDATION_FAILED'), 422);

    const playerId = randomUUID();
    const ctx = hub.ctx();
    const result = join(
      room,
      // Sem pré-deduplicar: `join` é quem garante a identidade única agora.
      // Duas checagens do mesmo com regras próprias foi o que criou o buraco.
      { playerId, nickname: identity.value.nickname, avatar: identity.value.avatar ?? PADRAO },
      ctx,
    );
    if (!result.ok) {
      return c.json(fail(result.code, { motivo: result.motivo }), result.code === 'ROOM_FULL' ? 409 : 422);
    }

    hub.commit(result);
    const joined = result.room.players.find((p) => p.id === playerId);

    return c.json({
      roomCode: result.room.code,
      playerId,
      sessionToken: signer.sign(playerId, result.room.code, ctx.now),
      wsUrl: wsUrl(c, result.room.code),
      role: joined?.isSpectator ? 'SPECTATOR' : 'PLAYER',
    });
  });

  /**
   * CA-007: retoma sem criar jogador novo. É o que sustenta "fechei a aba sem
   * querer e voltei" — e é o motivo de o token ser escopado à sala: ele só
   * serve para reentrar exatamente onde já se estava.
   */
  app.post('/api/rooms/:code/session', async (c) => {
    const parsed = roomCodeSchema.safeParse(c.req.param('code'));
    if (!parsed.success) return c.json(fail('ROOM_NOT_FOUND'), 404);

    const body = (await c.req.json().catch(() => ({}))) as { sessionToken?: unknown };
    const token = typeof body.sessionToken === 'string' ? body.sessionToken : '';
    const verified = signer.verify(token, now(), parsed.data);
    if (!verified.ok) return c.json(fail('INVALID_TOKEN'), 401);

    const room = hub.get(parsed.data);
    if (!room || room.status === 'ENCERRADA') return c.json(fail('ROOM_NOT_FOUND'), 404);

    const player = room.players.find((p) => p.id === verified.claims.playerId);
    // Quem saiu ou foi expulso não retoma: refaz o join como qualquer um.
    if (!player || !isPresent(player)) return c.json(fail('INVALID_TOKEN'), 401);

    return c.json({
      roomCode: room.code,
      playerId: player.id,
      sessionToken: token,
      wsUrl: wsUrl(c, room.code),
      role: player.isSpectator ? 'SPECTATOR' : 'PLAYER',
    });
  });

    // `protocolVersion` e não só `version`: é a diferença entre "saiu versão
  // nova" e "o seu cliente não fala mais a mesma língua". Só a segunda obriga
  // o jogador a recarregar — um deploy comum atravessa a partida sem que
  // ninguém precise fazer nada (CA-046).
  app.get('/api/health', (c) =>
    c.json({ ok: true, version, protocolVersion: PROTOCOL_VERSION, rooms: hub.roomCount }));

  // Cliente: o build do Vite. `clientPath` aponta para o diretório, e o
  // `index.html` dele é o mesmo para toda rota — é uma SPA, o roteamento é do
  // lado de lá.
  const TIPOS: Record<string, string> = {
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.woff2': 'font/woff2',
    '.png': 'image/png',
    '.ico': 'image/x-icon',
    '.webmanifest': 'application/manifest+json',
  };

  app.get('*', (c) => {
    const caminho = new URL(c.req.url).pathname;

    // Ativos com hash no nome: imutáveis por definição, e o navegador pode
    // guardá-los para sempre. `..` fica de fora — o cliente escolhe o caminho,
    // e sem isto ele escolheria qualquer arquivo da máquina.
    const ext = extname(caminho);
    if (caminho.startsWith('/assets/') && !caminho.includes('..') && TIPOS[ext]) {
      try {
        const arquivo = readFileSync(caminhoDe(clientPath, caminho));
        return c.body(arquivo, 200, {
          'content-type': TIPOS[ext],
          'cache-control': 'public, max-age=31536000, immutable',
        });
      } catch {
        return c.notFound();
      }
    }

    const nonce = c.get('nonce' as never) as unknown as string;
    // O nonce entra nos scripts do build também: sem ele o CSP recusa o
    // bundle, e a tela fica branca sem erro visível no servidor.
    const html = readFileSync(caminhoDe(clientPath, 'index.html'), 'utf8')
      .replaceAll('<script type="module"', `<script type="module" nonce="${nonce}"`);
    return c.html(html);
  });

  return app;
}
