/**
 * SSO de ponta a ponta, com o provedor simulado (plano 01, F3).
 *
 * O provedor é injetado porque o caminho que mais importa — a tomada de conta
 * de D-3 — não pode ser verificado só em produção, com uma conta de verdade.
 * Aqui ele percorre inteiro: ida, `state`, troca do código, perfil, e a conta
 * que sai do outro lado.
 */

import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { createMemoryStore } from '@fdp/store';
import { criarDadosEmMemoria, type Dados } from '@fdp/contas';
import { createHub, type Hub } from '../src/hub.js';
import { createHttpApp } from '../src/http.js';
import { createPersistence } from '../src/persistence.js';
import { createSigner, type SessionSigner } from '../src/session.js';
import { destinoSeguro, apelidoSugerido } from '../src/sso.js';

const SEGREDO = 'segredo-de-teste-com-32-caracteres!';
const CLIENT = fileURLToPath(new URL('../../app/build/', import.meta.url));

let hub: Hub;
let signer: SessionSigner;
let dados: Dados;
let app: ReturnType<typeof createHttpApp>;
let agora = 1_700_000_000_000;

/** O que o provedor simulado vai responder no próximo `/user`. */
let perfilDoProvedor: Record<string, unknown>;
let emailsDoGitHub: unknown[];
let recusarToken = false;

const env = () => ({ incoming: { socket: { remoteAddress: '203.0.113.1' } } }) as never;

const json = (corpo: unknown, ok = true): Response =>
  new Response(JSON.stringify(corpo), { status: ok ? 200 : 400 });

/** Google e GitHub de mentira, respondendo ao que o servidor de verdade pede. */
const buscarFalso = async (url: string): Promise<Response> => {
  if (url.includes('/token') || url.includes('access_token')) {
    return recusarToken ? json({ error: 'bad' }, false) : json({ access_token: 'tk' });
  }
  if (url.includes('openidconnect.googleapis.com')) return json(perfilDoProvedor);
  if (url.endsWith('api.github.com/user')) return json(perfilDoProvedor);
  if (url.endsWith('/user/emails')) return json(emailsDoGitHub);
  return json({}, false);
};

async function chamar(
  caminho: string,
  init?: { cookie?: string; method?: string; body?: unknown },
): Promise<Response> {
  const headers: Record<string, string> = {
    'content-type': 'application/json', host: 'fdp.test',
  };
  if (init?.cookie) headers['cookie'] = init.cookie;
  return app.fetch(new Request(`http://fdp.test${caminho}`, {
    method: init?.method ?? 'GET',
    headers,
    redirect: 'manual',
    ...(init?.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  }), env());
}

const corpo = async (r: Response): Promise<Record<string, never>> =>
  (await r.json()) as Record<string, never>;

/** Todos os `set-cookie` da resposta, por nome. */
function cookies(r: Response): Record<string, string> {
  const saida: Record<string, string> = {};
  for (const linha of r.headers.getSetCookie?.() ?? [r.headers.get('set-cookie') ?? '']) {
    const par = linha.split(';')[0] ?? '';
    const [nome, ...resto] = par.split('=');
    if (nome) saida[nome] = resto.join('=');
  }
  return saida;
}

beforeEach(() => {
  agora = 1_700_000_000_000;
  recusarToken = false;
  perfilDoProvedor = { sub: 'google-123', name: 'Ana Silva', email: 'ana@exemplo.com', email_verified: true };
  emailsDoGitHub = [];

  hub = createHub({
    persistence: createPersistence({ store: createMemoryStore() }),
    now: () => agora,
    randomSeed: () => randomBytes(16).toString('hex'),
  });
  signer = createSigner(SEGREDO);
  dados = criarDadosEmMemoria({ agora: () => agora });
  app = createHttpApp({
    hub, signer, clientPath: CLIENT, now: () => agora, dados,
    cookieSeguro: false,
    sso: {
      google: { clientId: 'g-id', clientSecret: 'g-secret' },
      github: { clientId: 'h-id', clientSecret: 'h-secret' },
    },
    buscarSso: buscarFalso,
  });
});

/** Faz a ida e devolve o `state` e o cookie, como um navegador faria. */
async function ida(provedor: string, destino?: string) {
  const r = await chamar(`/api/sso/${provedor}${destino ? `?destino=${encodeURIComponent(destino)}` : ''}`);
  const url = new URL(r.headers.get('location')!);
  const estado = url.searchParams.get('state')!;
  return { r, url, estado, cookie: `fdp_sso=${cookies(r)['fdp_sso']}` };
}

describe('ida ao provedor', () => {
  it('lista só os provedores configurados', async () => {
    const r = await chamar('/api/sso');
    expect((await corpo(r))['provedores']).toEqual(['google', 'github']);
  });

  it('monta a URL do Google com PKCE', async () => {
    const { url } = await ida('google');
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(url.searchParams.get('client_id')).toBe('g-id');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('code_challenge')).toBeTruthy();
    expect(url.searchParams.get('state')).toBeTruthy();
    // https porque o host não é localhost: em produção o Caddy termina TLS, e
    // um `redirect_uri` em http seria recusado pelo próprio Google.
    expect(url.searchParams.get('redirect_uri')).toBe('https://fdp.test/api/sso/google/retorno');
  });

  /**
   * O GitHub **não implementa PKCE** em OAuth App. Mandar `code_challenge`
   * para lá é ruído que ele ignora; a defesa é o `state` mais o segredo do
   * cliente. Este teste existe para a ausência ser deliberada e não parecer
   * esquecimento para quem passar por aqui depois.
   */
  it('a URL do GitHub NÃO leva PKCE, e isso é do GitHub', async () => {
    const { url } = await ida('github');
    expect(url.origin + url.pathname).toBe('https://github.com/login/oauth/authorize');
    expect(url.searchParams.get('code_challenge')).toBeNull();
    expect(url.searchParams.get('state')).toBeTruthy();
    // E o escopo pede os e-mails, sem os quais D-3 não pode decidir nada.
    expect(url.searchParams.get('scope')).toContain('user:email');
  });

  it('provedor desconhecido é 404; sem banco, 503', async () => {
    expect((await chamar('/api/sso/orkut')).status).toBe(404);

    app = createHttpApp({
      hub, signer, clientPath: CLIENT, now: () => agora, dados: null,
      cookieSeguro: false, sso: { google: { clientId: 'g', clientSecret: 's' } },
    });
    expect((await chamar('/api/sso/google')).status).toBe(503);
  });
});

describe('CA-364: o `state` protege a volta', () => {
  it('sem `state` na URL, recusa', async () => {
    const { cookie } = await ida('google');
    const r = await chamar('/api/sso/google/retorno?code=abc', { cookie });
    expect(r.status).toBe(400);
    expect(await corpo(r)).toMatchObject({ code: 'ESTADO_INVALIDO' });
  });

  /**
   * O caso que a defesa existe para pegar: o atacante fabrica a URL de volta
   * com um `state` que ele conhece, mas não consegue pôr o cookie no navegador
   * da vítima. Sem o cookie, não entra.
   */
  it('sem o cookie, recusa mesmo com `state` válido', async () => {
    const { estado } = await ida('google');
    const r = await chamar(`/api/sso/google/retorno?code=abc&state=${estado}`);
    expect(r.status).toBe(400);
    expect(await corpo(r)).toMatchObject({ code: 'ESTADO_INVALIDO' });
  });

  it('`state` da URL diferente do cookie, recusa', async () => {
    const a = await ida('google');
    const b = await ida('google');
    const r = await chamar(`/api/sso/google/retorno?code=abc&state=${a.estado}`, { cookie: b.cookie });
    expect(r.status).toBe(400);
  });

  it('o mesmo `state` não serve duas vezes', async () => {
    const { estado, cookie } = await ida('google');
    const primeira = await chamar(`/api/sso/google/retorno?code=abc&state=${estado}`, { cookie });
    expect(primeira.status).toBe(302);

    const segunda = await chamar(`/api/sso/google/retorno?code=abc&state=${estado}`, { cookie });
    expect(segunda.status).toBe(400);
  });

  it('`state` de outro provedor não atravessa', async () => {
    const { estado, cookie } = await ida('google');
    const r = await chamar(`/api/sso/github/retorno?code=abc&state=${estado}`, { cookie });
    expect(r.status).toBe(400);
  });

  it('login pela metade expira', async () => {
    const { estado, cookie } = await ida('google');
    agora += 11 * 60_000;
    const r = await chamar(`/api/sso/google/retorno?code=abc&state=${estado}`, { cookie });
    expect(r.status).toBe(400);
  });
});

describe('volta do provedor', () => {
  it('cria conta nova e já entra', async () => {
    const { estado, cookie } = await ida('google');
    const r = await chamar(`/api/sso/google/retorno?code=abc&state=${estado}`, { cookie });

    expect(r.status).toBe(302);
    expect(r.headers.get('location')).toBe('/?sso=ok');

    const conta = await dados.contas.porIdentidade('google', 'google-123');
    expect(conta).toMatchObject({ apelido: 'Ana', slug: 'ana' });

    // Entrou de fato: o cookie de conta veio junto e vale.
    const sessao = cookies(r)['fdp_conta'];
    expect(sessao).toBeTruthy();
    const eu = await chamar('/api/eu', { cookie: `fdp_conta=${sessao}` });
    expect((await corpo(eu))['conta']).toMatchObject({ slug: 'ana' });
  });

  it('entrar de novo cai na MESMA conta, e não cria outra', async () => {
    for (let i = 0; i < 2; i++) {
      const { estado, cookie } = await ida('google');
      await chamar(`/api/sso/google/retorno?code=abc&state=${estado}`, { cookie });
    }
    expect(await dados.contas.porSlug('ana')).not.toBeNull();
    // Se tivesse criado duas, a segunda seria `ana-2`.
    expect(await dados.contas.porSlug('ana-2')).toBeNull();
  });

  it('o `subject` é a chave: e-mail que muda não troca a conta de dono', async () => {
    const primeira = await ida('google');
    await chamar(`/api/sso/google/retorno?code=abc&state=${primeira.estado}`, { cookie: primeira.cookie });
    const antes = await dados.contas.porIdentidade('google', 'google-123');

    perfilDoProvedor = { sub: 'google-123', name: 'Ana Silva', email: 'outro@exemplo.com', email_verified: true };
    const segunda = await ida('google');
    await chamar(`/api/sso/google/retorno?code=abc&state=${segunda.estado}`, { cookie: segunda.cookie });

    expect((await dados.contas.porIdentidade('google', 'google-123'))!.id).toBe(antes!.id);
  });

  it('provedor recusando o código volta para a tela, sem criar nada', async () => {
    recusarToken = true;
    const { estado, cookie } = await ida('google');
    const r = await chamar(`/api/sso/google/retorno?code=abc&state=${estado}`, { cookie });

    expect(r.headers.get('location')).toBe('/?sso=falhou');
    expect(await dados.contas.porSlug('ana')).toBeNull();
  });

  it('quem cancela no provedor volta sem drama', async () => {
    const { estado, cookie } = await ida('google');
    const r = await chamar(`/api/sso/google/retorno?state=${estado}&error=access_denied`, { cookie });
    expect(r.headers.get('location')).toBe('/?sso=cancelado');
  });

  it('o destino volta para onde se estava, e nunca para fora do site', async () => {
    const bom = await ida('google', '/sala/AB12C');
    const r = await chamar(`/api/sso/google/retorno?code=abc&state=${bom.estado}`, { cookie: bom.cookie });
    expect(r.headers.get('location')).toBe('/sala/AB12C?sso=ok');
  });
});

describe('CA-365: só e-mail VERIFICADO assume conta (D-3)', () => {
  const comSenha = async () => {
    const r = await chamar('/api/contas', {
      method: 'POST',
      body: { apelido: 'Ana', email: 'ana@exemplo.com', senha: 'umaSenhaBoaAqui' },
    });
    return (await corpo(r))['conta'] as unknown as { slug: string };
  };

  it('Google com e-mail verificado assume a conta e apaga a senha', async () => {
    const antes = await comSenha();

    const { estado, cookie } = await ida('google');
    await chamar(`/api/sso/google/retorno?code=abc&state=${estado}`, { cookie });

    const conta = await dados.contas.porIdentidade('google', 'google-123');
    expect(conta).not.toBeNull();
    // MESMA conta: o slug e o histórico não se perdem.
    expect(conta!.slug).toBe(antes.slug);
    // A senha foi apagada. Se ficasse, duas pessoas teriam acesso à conta.
    expect(await dados.contas.credencialPorEmail('ana@exemplo.com')).toBeNull();
  });

  /**
   * O buraco que CA-365 fecha. Sem exigir verificação, bastaria pôr o e-mail
   * alheio no perfil do provedor para tomar a conta de outra pessoa — a regra
   * de D-3 viraria um sequestro.
   */
  it('Google SEM e-mail verificado NÃO assume: vira conta separada', async () => {
    const antes = await comSenha();
    perfilDoProvedor = {
      sub: 'google-999', name: 'Ana Silva', email: 'ana@exemplo.com', email_verified: false,
    };

    const { estado, cookie } = await ida('google');
    await chamar(`/api/sso/google/retorno?code=abc&state=${estado}`, { cookie });

    const nova = await dados.contas.porIdentidade('google', 'google-999');
    expect(nova).not.toBeNull();
    expect(nova!.slug).not.toBe(antes.slug);
    // E a senha da conta original continua lá, intacta.
    expect(await dados.contas.credencialPorEmail('ana@exemplo.com')).not.toBeNull();
  });

  it('GitHub sem e-mail primário verificado não assume', async () => {
    await comSenha();
    perfilDoProvedor = { id: 4242, login: 'ana', name: 'Ana Silva' };
    emailsDoGitHub = [
      { email: 'ana@exemplo.com', primary: true, verified: false },
      { email: 'outro@exemplo.com', primary: false, verified: true },
    ];

    const { estado, cookie } = await ida('github');
    await chamar(`/api/sso/github/retorno?code=abc&state=${estado}`, { cookie });

    // A conta de senha sobreviveu: nenhum daqueles dois autoriza a tomada —
    // um não é verificado, o outro não é o primário.
    expect(await dados.contas.credencialPorEmail('ana@exemplo.com')).not.toBeNull();
    expect(await dados.contas.porIdentidade('github', '4242')).not.toBeNull();
  });

  it('GitHub com primário verificado assume', async () => {
    await comSenha();
    perfilDoProvedor = { id: 4242, login: 'ana', name: 'Ana Silva' };
    emailsDoGitHub = [{ email: 'ana@exemplo.com', primary: true, verified: true }];

    const { estado, cookie } = await ida('github');
    await chamar(`/api/sso/github/retorno?code=abc&state=${estado}`, { cookie });

    expect(await dados.contas.credencialPorEmail('ana@exemplo.com')).toBeNull();
  });

  /** RF-063: depois da tomada, a tela precisa dizer o que houve. */
  it('RF-063: entrar com senha depois da tomada diz que a conta migrou', async () => {
    await comSenha();
    const { estado, cookie } = await ida('google');
    await chamar(`/api/sso/google/retorno?code=abc&state=${estado}`, { cookie });

    const r = await chamar('/api/sessao', {
      method: 'POST', body: { email: 'ana@exemplo.com', senha: 'umaSenhaBoaAqui' } });

    // Não é "senha inválida": é o comportamento fácil, e o que faz a pessoa
    // tentar cinco vezes e ir embora achando que é bug.
    expect(r.status).toBe(409);
    const b = await corpo(r);
    expect(b['code']).toBe('CONTA_MIGRADA_PARA_SSO');
    expect((b['params'] as unknown as { provedores: string[] }).provedores).toEqual(['google']);
  });

  it('e-mail que nunca teve conta continua com a resposta genérica', async () => {
    const r = await chamar('/api/sessao', {
      method: 'POST', body: { email: 'ninguem@exemplo.com', senha: 'umaSenhaBoaAqui' } });
    expect(r.status).toBe(401);
    expect(await corpo(r)).toMatchObject({ code: 'CREDENCIAL_INVALIDA' });
  });
});

describe('peças puras', () => {
  /** `open redirect` é o presente que um login dá ao phishing. */
  it('destino só aceita caminho interno', () => {
    expect(destinoSeguro('/sala/AB12C')).toBe('/sala/AB12C');
    expect(destinoSeguro('/')).toBe('/');

    for (const ruim of [
      'https://malvado.com',
      '//malvado.com',            // protocol-relative: URL absoluta disfarçada
      '\\\\malvado.com',          // barra invertida, que vários navegadores normalizam
      '/\\malvado.com',
      'javascript:alert(1)',
      '', null, undefined,
    ]) {
      expect(destinoSeguro(ruim as string)).toBe('/');
    }
  });

  it('apelido sugerido cabe no que o cadastro aceita', () => {
    expect(apelidoSugerido('Ana Silva')).toBe('Ana');
    expect(apelidoSugerido('  João  Pedro ')).toBe('João');
    // Nome de provedor pode ser qualquer coisa; ninguém é recusado por isso.
    expect(apelidoSugerido('')).toBe('Jogador');
    expect(apelidoSugerido('   ')).toBe('Jogador');
    // Emoji NÃO cai em "Jogador": `04` §2 permite unicode no apelido, e um
    // emoji de duas unidades já passa do mínimo de 2. Quem se chama 🦊 no
    // Google se chama 🦊 aqui.
    expect(apelidoSugerido('🦊')).toBe('🦊');
    expect(apelidoSugerido('Bartolomeu'.repeat(5)).length).toBeLessThanOrEqual(16);
  });
});
