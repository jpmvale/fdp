/**
 * Rotas de conta: cadastro, login, saída e "quem sou eu".
 *
 * **Tudo aqui é opcional.** Sem `Dados` — isto é, sem `DATABASE_URL` — as rotas
 * respondem `503` e o jogo continua inteiro: entrar por link, jogar, ver o fim
 * de partida. É a invariante I-1 do plano 01 escrita em código, e não só em
 * prosa: conta é acréscimo, nunca pedágio, e o banco fora do ar não pode tirar
 * o jogo do ar.
 *
 * A sessão vive num cookie `HttpOnly` (D-7). O token de sala continua na query
 * string do WebSocket porque expira com a sala e só serve para ela; sessão de
 * conta é identidade permanente e não pode viajar assim.
 */

import { Hono } from 'hono';
import type { HttpBindings } from '@hono/node-server';
import { AVATAR_COLORS, AVATAR_EMOJIS, type Avatar } from '@fdp/protocol';
import { avatarSchema, nicknameSchema } from '@fdp/protocol/validate';
import type { Conta, Dados } from '@fdp/contas';
import { conferirSenha, gastarComoSeFosse, gerarHash, senhaAceitavel } from './senha.js';
import { createRateLimiter } from './limits.js';
import { SESSAO_CONTA_MS, type SessionSigner } from './session.js';

export const COOKIE_SESSAO = 'fdp_conta';

export interface ContasHttpOptions {
  dados: Dados | null;
  signer: SessionSigner;
  now?: () => number;
  clientIp: (c: { env: HttpBindings; req: { header(n: string): string | undefined } }) => string;
  /** Em teste, sem TLS, o cookie não pode exigir `Secure` ou nada funciona. */
  cookieSeguro?: boolean;
}

/** O que sai para o cliente. O `id` interno NUNCA vai junto — só o slug. */
export interface ContaPublica {
  slug: string;
  apelido: string;
  avatar: Avatar;
}

export const contaPublica = (c: Conta): ContaPublica => ({
  slug: c.slug, apelido: c.apelido, avatar: c.avatar,
});

const PADRAO: Avatar = { emoji: AVATAR_EMOJIS[0]!, color: AVATAR_COLORS[0]! };

/**
 * E-mail: validação deliberadamente frouxa.
 *
 * Regex de e-mail "correto" é folclore — a RFC 5322 aceita coisas que nenhuma
 * regex de uma linha cobre, e toda tentativa acaba recusando endereço legítimo
 * de gente real. O que importa é que tenha um `@` com algo dos dois lados e um
 * ponto no domínio; o resto quem valida é a caixa de entrada, quando a
 * confirmação de e-mail existir (§8).
 */
const EMAIL = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;
const EMAIL_MAX = 254;

const emailAceitavel = (v: unknown): v is string =>
  typeof v === 'string' && v.length <= EMAIL_MAX && EMAIL.test(v.trim());

function biscoito(valor: string, maxAgeMs: number, seguro: boolean): string {
  const partes = [
    `${COOKIE_SESSAO}=${valor}`,
    'Path=/',
    'HttpOnly',
    // `Lax` e não `Strict`: o jogo se abre por link mandado no WhatsApp, e
    // `Strict` faria a primeira navegação chegar deslogada — a pessoa veria a
    // tela de visitante e acharia que a conta sumiu.
    'SameSite=Lax',
    `Max-Age=${Math.floor(maxAgeMs / 1000)}`,
  ];
  if (seguro) partes.push('Secure');
  return partes.join('; ');
}

function lerCookie(cabecalho: string | undefined, nome: string): string | null {
  if (!cabecalho) return null;
  for (const parte of cabecalho.split(';')) {
    const [chave, ...resto] = parte.trim().split('=');
    if (chave === nome) return resto.join('=') || null;
  }
  return null;
}

export function montarRotasDeConta(
  app: Hono<{ Bindings: HttpBindings }>,
  opcoes: ContasHttpOptions,
): void {
  const { dados, signer } = opcoes;
  const agora = opcoes.now ?? Date.now;
  const seguro = opcoes.cookieSeguro ?? true;

  /**
   * Limites de tentativa, por IP.
   *
   * O cadastro é mais apertado que o login: criar conta é caro (um scrypt
   * inteiro) e ninguém cadastra vinte vezes por hora de boa-fé. O login é
   * frouxo o bastante para quem erra a senha algumas vezes seguidas, e
   * apertado o bastante para que força bruta não caiba na janela.
   */
  const limiteCadastro = createRateLimiter({ limit: 10, windowMs: 60 * 60_000 });
  const limiteLogin = createRateLimiter({ limit: 20, windowMs: 15 * 60_000 });

  /** RNF-001: toda resposta de erro é `{ code, params? }`, sem embrulho. */
  const semBanco = () => ({ code: 'CONTAS_INDISPONIVEIS' as const });

  /** A conta do cookie, já conferida contra a época (D-8). */
  const contaDoPedido = (cookie: string | undefined): Promise<Conta | null> =>
    contaDoCookie(dados, signer, cookie, agora());

  const entrar = (c: { header(n: string, v: string): void }, conta: Conta): void => {
    c.header('set-cookie', biscoito(
      signer.signConta(conta.id, conta.epocaSessao, agora()), SESSAO_CONTA_MS, seguro));
  };

  app.post('/api/contas', async (c) => {
    if (!dados) return c.json(semBanco(), 503);
    const passeCadastro = limiteCadastro.check(opcoes.clientIp(c), agora());
    if (!passeCadastro.allowed) {
      return c.json({ code: 'RATE_LIMITED' }, 429, {
        'retry-after': String(Math.ceil(passeCadastro.retryAfterMs / 1000)),
      });
    }

    const corpo = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;

    const apelido = nicknameSchema.safeParse(corpo['apelido']);
    if (!apelido.success) return c.json({ code: 'APELIDO_INVALIDO' }, 400);

    if (!emailAceitavel(corpo['email'])) {
      return c.json({ code: 'EMAIL_INVALIDO' }, 400);
    }
    const senha = corpo['senha'];
    if (typeof senha !== 'string' || !senhaAceitavel(senha)) {
      return c.json({ code: 'SENHA_FRACA' }, 400);
    }

    let avatar: Avatar = PADRAO;
    if (corpo['avatar'] !== undefined) {
      const lido = avatarSchema.safeParse(corpo['avatar']);
      if (!lido.success) return c.json({ code: 'AVATAR_INVALIDO' }, 400);
      avatar = lido.data;
    }

    const criada = await dados.contas.criarComSenha({
      apelido: apelido.data, avatar, email: (corpo['email'] as string).trim(),
      hash: await gerarHash(senha),
    });

    if (!criada.ok) return c.json({ code: 'EMAIL_EM_USO' }, 409);

    entrar(c, criada.conta);
    return c.json({ conta: contaPublica(criada.conta) }, 201);
  });

  app.post('/api/sessao', async (c) => {
    if (!dados) return c.json(semBanco(), 503);
    const passeLogin = limiteLogin.check(opcoes.clientIp(c), agora());
    if (!passeLogin.allowed) {
      return c.json({ code: 'RATE_LIMITED' }, 429, {
        'retry-after': String(Math.ceil(passeLogin.retryAfterMs / 1000)),
      });
    }

    const corpo = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const email = typeof corpo['email'] === 'string' ? corpo['email'] : '';
    const senha = typeof corpo['senha'] === 'string' ? corpo['senha'] : '';

    const credencial = await dados.contas.credencialPorEmail(email);

    // CA-363. Sem conta, gasta-se o MESMO trabalho de uma conferência de
    // verdade antes de recusar. Responder na hora aqui transformaria o tempo
    // de resposta numa consulta de "esta pessoa tem conta neste site?".
    if (!credencial) {
      await gastarComoSeFosse(senha);
      return c.json({ code: 'CREDENCIAL_INVALIDA' }, 401);
    }

    if (!(await conferirSenha(senha, credencial.hash))) {
      return c.json({ code: 'CREDENCIAL_INVALIDA' }, 401);
    }

    const conta = await dados.contas.porId(credencial.contaId);
    if (!conta) return c.json({ code: 'CREDENCIAL_INVALIDA' }, 401);

    entrar(c, conta);
    return c.json({ conta: contaPublica(conta) });
  });

  /**
   * Sair. `Max-Age=0` apaga o cookie no navegador.
   *
   * NÃO incrementa a época: sair num aparelho não pode derrubar os outros. A
   * época é para "sair de todos" e para a tomada de conta de §7, que são
   * outra coisa.
   */
  app.delete('/api/sessao', (c) => {
    c.header('set-cookie', biscoito('', 0, seguro));
    return c.json({ ok: true });
  });

  app.get('/api/eu', async (c) => {
    const conta = await contaDoPedido(c.req.header('cookie'));
    // Visitante não é erro: é o estado normal de quem ainda não fez conta.
    return c.json({ conta: conta ? contaPublica(conta) : null });
  });

  /**
   * Editar o próprio perfil — R-4 do plano 01 §5.1, e a armadilha desta fase.
   *
   * Quem tem conta edita **a conta**, não o apelido que a mesa lhe deu. Se a
   * sala te renomeou para "João (2)" porque já havia um João, e o editor
   * gravasse o que está na mesa, o sufixo entraria na conta e viraria
   * permanente — a pessoa passaria a se chamar "João (2)" em todas as salas,
   * para sempre, por causa de uma mesa de uma noite.
   *
   * Por isso o cliente lê a identidade daqui, e não do jogador da sala.
   */
  app.patch('/api/eu', async (c) => {
    if (!dados) return c.json(semBanco(), 503);

    const conta = await contaDoPedido(c.req.header('cookie'));
    if (!conta) return c.json({ code: 'SEM_SESSAO' }, 401);

    const corpo = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;

    const apelido = nicknameSchema.safeParse(corpo['apelido']);
    if (!apelido.success) return c.json({ code: 'APELIDO_INVALIDO' }, 400);

    const lido = avatarSchema.safeParse(corpo['avatar']);
    if (!lido.success) return c.json({ code: 'AVATAR_INVALIDO' }, 400);

    const atualizada = await dados.contas.atualizarPerfil(conta.id, {
      apelido: apelido.data, avatar: lido.data,
    });
    if (!atualizada) return c.json({ code: 'SEM_SESSAO' }, 401);

    return c.json({ conta: contaPublica(atualizada) });
  });

  app.get('/api/perfis/:slug', async (c) => {
    if (!dados) return c.json(semBanco(), 503);
    const conta = await dados.contas.porSlug(c.req.param('slug'));
    if (!conta) return c.json({ code: 'PERFIL_NAO_ENCONTRADO' }, 404);

    // D-4: público para quem tem o link, sem listagem nem busca. O que sai é
    // o que já aparece na mesa, mais o placar de vida inteira.
    const resumo = await dados.partidas.resumoDaConta(conta.id);
    return c.json({ conta: contaPublica(conta), resumo });
  });
}

/**
 * A conta de quem está fazendo o pedido, ou `null`.
 *
 * Exportada porque o `join` precisa dela: quem entra logado não escolhe
 * apelido nem avatar na sala — vêm da conta (plano 01 §5). Fica aqui, e não
 * duplicada no `http.ts`, para que a conferência de época (D-8) seja a mesma
 * nos dois caminhos: sessão revogada não pode continuar valendo para sentar à
 * mesa depois de já não valer para o resto.
 */
export async function contaDoCookie(
  dados: Dados | null,
  signer: SessionSigner,
  cabecalho: string | undefined,
  agora: number,
): Promise<Conta | null> {
  if (!dados) return null;
  const token = lerCookie(cabecalho, COOKIE_SESSAO);
  if (!token) return null;

  const v = signer.verifyConta(token, agora);
  if (!v.ok) return null;

  const conta = await dados.contas.porId(v.claims.conta);
  if (!conta) return null;
  if (conta.epocaSessao !== v.claims.epoca) return null;
  return conta;
}
