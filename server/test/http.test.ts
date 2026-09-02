/**
 * Endpoints de `06`. Cobre CA-001 a CA-008 e os transversais RNF-001 a RNF-006.
 */

import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { ROOM_CODE_ALPHABET } from '@fdp/protocol';
import { createMemoryStore } from '@fdp/store';
import { createHub, type Hub } from '../src/hub.js';
import { createHttpApp } from '../src/http.js';
import { createPersistence } from '../src/persistence.js';
import { createSigner, type SessionSigner } from '../src/session.js';

const SECRET = 'segredo-de-teste-com-32-caracteres!';
// O diretório do build do Vite, não um arquivo: o cliente virou uma SPA com
// ativos próprios (`11` §6), e o servidor serve o diretório inteiro.
const CLIENT = fileURLToPath(new URL('../../app/build/', import.meta.url));

let hub: Hub;
let signer: SessionSigner;
let app: ReturnType<typeof createHttpApp>;
let now = 1_700_000_000_000;

/** `env` finge o socket de entrada: é de lá que sai o IP do rate limit. */
const env = (ip = '203.0.113.1') =>
  ({ incoming: { socket: { remoteAddress: ip } } }) as never;

const json = async (response: Response): Promise<Record<string, unknown>> =>
  (await response.json()) as Record<string, unknown>;

async function call(
  path: string,
  init?: { method?: string; body?: unknown; ip?: string; headers?: Record<string, string> },
): Promise<Response> {
  const request = new Request(`http://fdp.test${path}`, {
    method: init?.method ?? 'GET',
    headers: { 'content-type': 'application/json', host: 'fdp.test', ...init?.headers },
    ...(init?.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  });
  return app.fetch(request, env(init?.ip));
}

const criar = async (nickname = 'Ana', ip?: string) => {
  const response = await call('/api/rooms', { method: 'POST', body: { nickname }, ...(ip ? { ip } : {}) });
  return { response, body: (await response.json()) as Record<string, string> };
};

beforeEach(() => {
  now = 1_700_000_000_000;
  hub = createHub({
    persistence: createPersistence({ store: createMemoryStore() }),
    now: () => now,
    randomSeed: () => randomBytes(16).toString('hex'),
  });
  signer = createSigner(SECRET);
  app = createHttpApp({ hub, signer, clientPath: CLIENT, now: () => now });
});

describe('CA-001: criar sala', () => {
  it('devolve código de 5 caracteres do alfabeto de 06 §2 e um token válido', async () => {
    const { response, body } = await criar();

    expect(response.status).toBe(201);
    expect(body.roomCode).toHaveLength(5);
    expect([...body.roomCode!].every((c) => ROOM_CODE_ALPHABET.includes(c))).toBe(true);
    expect(body.wsUrl).toBe(`ws://fdp.test/api/rooms/${body.roomCode}/ws`);

    const verified = signer.verify(body.sessionToken!, now, body.roomCode);
    expect(verified.ok).toBe(true);
    if (!verified.ok) return;
    expect(verified.claims.playerId).toBe(body.playerId);
  });

  it('atrás de TLS o wsUrl é wss', async () => {
    const response = await call('/api/rooms', {
      method: 'POST',
      body: { nickname: 'Ana' },
      headers: { 'x-forwarded-proto': 'https' },
    });
    const body = (await response.json()) as Record<string, string>;
    expect(body.wsUrl!.startsWith('wss://')).toBe(true);
  });

  it('apelido inválido é recusado por schema, não normalizado na marra', async () => {
    const response = await call('/api/rooms', { method: 'POST', body: { nickname: '' } });
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ code: 'VALIDATION_FAILED' });
  });
});

describe('CA-002 / CA-003: consultar e normalizar', () => {
  it('código inexistente devolve 404 com ERR-001', async () => {
    const response = await call('/api/rooms/ZZZZZ');
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ code: 'ROOM_NOT_FOUND' });
  });

  it('CA-003: código em minúsculas e com espaços é normalizado', async () => {
    const { body } = await criar();
    const bagunçado = `${body.roomCode!.slice(0, 2)} -${body.roomCode!.slice(2)}`.toLowerCase();

    const response = await call(`/api/rooms/${encodeURIComponent(bagunçado)}`);
    expect(response.status).toBe(200);
    expect((await json(response)).roomCode).toBe(body.roomCode);
  });

  it('RNF-004/006: a consulta pública não expõe partida e é no-store', async () => {
    const { body } = await criar();
    const response = await call(`/api/rooms/${body.roomCode}`);

    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(Object.keys(await json(response)).sort()).toEqual([
      'canJoinAsPlayer', 'canJoinAsSpectator', 'maxPlayers', 'playerCount', 'roomCode', 'status',
    ]);
  });
});

describe('CA-004 / CA-006: entrar na sala', () => {
  it('CA-006: dois "Ana" entram os dois, com apelidos distintos', async () => {
    const { body } = await criar('Ana');
    const response = await call(`/api/rooms/${body.roomCode}/join`, {
      method: 'POST',
      body: { nickname: 'Ana' },
    });
    expect(response.status).toBe(200);

    const nicknames = hub.get(body.roomCode!)!.players.map((p) => p.nickname);
    expect(nicknames).toHaveLength(2);
    expect(new Set(nicknames).size).toBe(2);
  });

  it('CA-004: o nono jogador recebe ERR-002', async () => {
    const { body } = await criar();
    for (let i = 2; i <= 8; i++) {
      const r = await call(`/api/rooms/${body.roomCode}/join`, {
        method: 'POST',
        body: { nickname: `J${i}` },
      });
      expect(r.status).toBe(200);
    }

    const nono = await call(`/api/rooms/${body.roomCode}/join`, {
      method: 'POST',
      body: { nickname: 'Nono' },
    });
    expect(nono.status).toBe(409);
    expect((await json(nono)).code).toBe('ROOM_FULL');
  });

  it('cada jogador recebe um avatar livre da paleta', async () => {
    const { body } = await criar();
    for (let i = 2; i <= 8; i++) {
      await call(`/api/rooms/${body.roomCode}/join`, { method: 'POST', body: { nickname: `J${i}` } });
    }

    const avatares = hub.get(body.roomCode!)!.players.map((p) => `${p.avatar.emoji}${p.avatar.color}`);
    expect(new Set(avatares).size).toBe(8);
  });

  it('entrar em sala inexistente é 404, não 500', async () => {
    const response = await call('/api/rooms/ZZZZZ/join', { method: 'POST', body: { nickname: 'Ana' } });
    expect(response.status).toBe(404);
  });
});

describe('CA-007: retomar a sessão', () => {
  it('token válido devolve o mesmo playerId, sem criar jogador novo', async () => {
    const { body } = await criar();

    const response = await call(`/api/rooms/${body.roomCode}/session`, {
      method: 'POST',
      body: { sessionToken: body.sessionToken },
    });

    expect(response.status).toBe(200);
    const retomada = (await response.json()) as Record<string, string>;
    expect(retomada.playerId).toBe(body.playerId);
    expect(retomada.role).toBe('PLAYER');
    expect(hub.get(body.roomCode!)!.players).toHaveLength(1);
  });

  it('token de outra sala não retoma esta', async () => {
    const primeira = await criar('Ana');
    const segunda = await criar('Beto');

    const response = await call(`/api/rooms/${segunda.body.roomCode}/session`, {
      method: 'POST',
      body: { sessionToken: primeira.body.sessionToken },
    });
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ code: 'INVALID_TOKEN' });
  });

  it('token expirado devolve ERR-003 para o cliente limpar o storage', async () => {
    const { body } = await criar();
    now += 5 * 60 * 60_000; // além de ROOM_MAX_LIFE

    const response = await call(`/api/rooms/${body.roomCode}/session`, {
      method: 'POST',
      body: { sessionToken: body.sessionToken },
    });
    expect(response.status).toBe(401);
  });

  it('lixo no lugar do token é 401, não 500', async () => {
    const { body } = await criar();
    for (const lixo of [undefined, '', 'nada.disso.aqui', 42]) {
      const response = await call(`/api/rooms/${body.roomCode}/session`, {
        method: 'POST',
        body: { sessionToken: lixo },
      });
      expect(response.status).toBe(401);
    }
  });
});

describe('RNF-003: rate limit por IP', () => {
  it('barra a 11ª criação de sala na mesma hora', async () => {
    for (let i = 0; i < 10; i++) {
      expect((await criar('Ana', '198.51.100.7')).response.status).toBe(201);
    }

    const barrada = await criar('Ana', '198.51.100.7');
    expect(barrada.response.status).toBe(429);
    expect(barrada.body.code).toBe('RATE_LIMITED');
    expect(Number((barrada.body as unknown as { params: { retryAfterMs: number } }).params.retryAfterMs))
      .toBeGreaterThan(0);
  });

  it('o limite é por IP: outro cliente não paga pelo primeiro', async () => {
    for (let i = 0; i < 10; i++) await criar('Ana', '198.51.100.7');
    expect((await criar('Beto', '198.51.100.8')).response.status).toBe(201);
  });

  it('passada a janela, volta a caber', async () => {
    for (let i = 0; i < 10; i++) await criar('Ana', '198.51.100.9');
    now += 60 * 60_000 + 1;
    expect((await criar('Ana', '198.51.100.9')).response.status).toBe(201);
  });

  it('só confia em X-Forwarded-For quando configurado para isso', async () => {
    // Sem `trustProxy`, forjar o cabeçalho não contorna o limite.
    for (let i = 0; i < 10; i++) {
      await call('/api/rooms', {
        method: 'POST',
        body: { nickname: 'Ana' },
        ip: '198.51.100.10',
        headers: { 'x-forwarded-for': `10.0.0.${i}` },
      });
    }
    const response = await call('/api/rooms', {
      method: 'POST',
      body: { nickname: 'Ana' },
      ip: '198.51.100.10',
      headers: { 'x-forwarded-for': '10.0.0.99' },
    });
    expect(response.status).toBe(429);
  });
});

describe('RNF-005 / RNF-078: cabeçalhos de segurança', () => {
  it('toda resposta traz CSP, nosniff e no-referrer', async () => {
    const response = await call('/api/health');

    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
    expect(response.headers.get('content-security-policy')).toContain("default-src 'self'");
  });

  it('a CSP não tem unsafe-inline em script: o cliente vai por nonce', async () => {
    const response = await call('/');
    const csp = response.headers.get('content-security-policy')!;
    const html = await response.text();

    const scriptSrc = csp.split('; ').find((d) => d.startsWith('script-src'))!;
    expect(scriptSrc).not.toContain('unsafe-inline');

    const nonce = /script-src 'nonce-([^']+)'/.exec(csp)?.[1];
    expect(nonce).toBeTruthy();
    expect(html).toContain(`<script type="module" nonce="${nonce}"`);
  });

  it('o nonce muda a cada resposta', async () => {
    const um = (await call('/')).headers.get('content-security-policy');
    const dois = (await call('/')).headers.get('content-security-policy');
    expect(um).not.toBe(dois);
  });

  it('RNF-002: sem origem configurada, não há CORS liberado', async () => {
    const response = await call('/api/health', { headers: { origin: 'https://outro.site' } });
    expect(response.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('RNF-002: com origem configurada, só ela é liberada', async () => {
    app = createHttpApp({
      hub, signer, clientPath: CLIENT, now: () => now, allowedOrigin: 'https://fdp.app',
    });

    const permitida = await call('/api/health', { headers: { origin: 'https://fdp.app' } });
    expect(permitida.headers.get('access-control-allow-origin')).toBe('https://fdp.app');

    const outra = await call('/api/health', { headers: { origin: 'https://outro.site' } });
    expect(outra.headers.get('access-control-allow-origin')).toBeNull();
  });
});

/**
 * O cartão do link compartilhado (RF-107). CA-433.
 *
 * O convite é COMO se entra no FDP, e chegava nos grupos como uma URL crua —
 * que num grupo de amigos parece spam.
 */
describe('CA-433: o cartão do convite', () => {
  const meta = (html: string, chave: string): string | null =>
    new RegExp(`<meta property="${chave}" content="([^"]*)">`).exec(html)?.[1] ?? null;

  it('`/j/CÓDIGO` de sala viva diz que a mesa existe e quantos estão nela', async () => {
    const { body } = await criar('Ana');
    const html = await (await app.request(`/j/${body.roomCode!}`)).text();

    expect(meta(html, 'og:title')).toBe(`Entre na mesa ${body.roomCode!} — FDP`);
    expect(meta(html, 'og:description')).toContain('1 de 8 na mesa');
    expect(html).toContain(`<title>Entre na mesa ${body.roomCode!} — FDP</title>`);
  });

  it('NUNCA sai apelido no cartão — o robô entrega isso a quem receber o encaminhado', async () => {
    const { body } = await criar('Ana');
    const html = await (await app.request(`/j/${body.roomCode!}`)).text();
    // Contagem já é pública em `GET /api/rooms/:code`; nome de quem joga não é.
    expect(html).not.toContain('Ana');
  });

  it('sala que não existe manda criar a sua, em vez de mentir que existe', async () => {
    const html = await (await app.request('/j/ZZZZZ')).text();
    expect(meta(html, 'og:title')).toBe('FDP');
    expect(meta(html, 'og:description')).toContain('não existe mais');
  });

  it('código inválido não quebra a página — ela abre como a home', async () => {
    const html = await (await app.request('/j/nao-e-um-codigo')).text();
    expect(meta(html, 'og:title')).toBe('FDP');
    expect(html).toContain('id="raiz"');
  });

  it('a home mantém o cartão padrão, e há UMA meta de cada', async () => {
    const html = await (await app.request('/')).text();
    expect(meta(html, 'og:title')).toBe('FDP');
    // Duas `og:description` fariam cada leitor escolher uma, e eles não
    // escolhem a mesma: o cartão sairia diferente no WhatsApp e no Telegram.
    expect(html.match(/<meta property="og:description"/g)).toHaveLength(1);
  });

  it('`og:image` sai ABSOLUTA — relativa chega ao robô como nada', async () => {
    const html = await (await app.request('/')).text();
    // O WhatsApp busca a imagem de fora do contexto da página: não há "mesma
    // origem" para resolver um caminho relativo contra. O cartão sairia sem
    // figura, e sem erro nenhum para alguém notar.
    const imagem = meta(html, 'og:image')!;
    expect(() => new URL(imagem)).not.toThrow();
    expect(imagem).toMatch(/^https?:\/\/.+\/og\.png$/);
  });

  it('atrás do proxy a origem é a que o NAVEGADOR vê, não a interna', async () => {
    // Em produção o Caddy termina o TLS e fala HTTP com o app. Sem isto o
    // cartão aponta para `http://…/og.png` — defeito que ninguém vê, porque a
    // única vítima é um robô de pré-visualização. Foi ao ar assim uma vez.
    const html = await (await app.request('/', {
      headers: { host: 'fdp.exemplo.com', 'x-forwarded-proto': 'https' },
    })).text();
    expect(meta(html, 'og:image')).toBe('https://fdp.exemplo.com/og.png');
  });

  it('o ícone e o manifesto são servidos da raiz', async () => {
    const icone = await app.request('/favicon.svg');
    expect(icone.status).toBe(200);
    expect(icone.headers.get('content-type')).toContain('image/svg+xml');

    const manifesto = await app.request('/site.webmanifest');
    expect(manifesto.status).toBe(200);
  });

  it('a raiz é lista fechada: nada além dela é servido de lá', async () => {
    // `/assets/` pode ser aberto porque todo nome ali tem hash do conteúdo.
    // A raiz não tem essa garantia, e servi-la por prefixo faria qualquer
    // arquivo que caísse no build virar público sem ninguém decidir isso.
    const html = await (await app.request('/index.html')).text();
    expect(html).toContain('id="raiz"');
    expect(html).not.toContain('<!doctype html>\n<!doctype html>');
  });
});
