/**
 * As duas rotas do SSO: ir ao provedor e voltar dele.
 *
 * O estado pendente entre a ida e a volta mora **em memória**, e não num
 * token: o processo é único (`11` §3.1), a janela é de dez minutos, e nada
 * assinado que o navegador carregue é mais simples do que um `Map` que o
 * atacante não alcança. Reiniciar o servidor perde logins pela metade, e isso
 * é aceitável — a pessoa clica de novo.
 */

import { Hono } from 'hono';
import type { HttpBindings } from '@hono/node-server';
import { AVATAR_COLORS, AVATAR_EMOJIS, type Avatar } from '@fdp/protocol';
import type { Conta, Dados, Provedor } from '@fdp/contas';
import { PROVEDORES } from '@fdp/contas';
import {
  apelidoSugerido, criarDesafio, destinoSeguro, mesmoEstado, perfilDoCodigo,
  urlDeAutorizacao, PENDENTE_MS,
  type Buscar, type ConfigSso, type Pendente,
} from './sso.js';
import { SESSAO_CONTA_MS, type SessionSigner } from './session.js';

const COOKIE_SSO = 'fdp_sso';
const PADRAO: Avatar = { emoji: AVATAR_EMOJIS[0]!, color: AVATAR_COLORS[0]! };

export interface SsoHttpOptions {
  dados: Dados | null;
  signer: SessionSigner;
  config: ConfigSso;
  now?: () => number;
  cookieSeguro?: boolean;
  /** Injetável para o teste percorrer o fluxo inteiro sem rede. */
  buscar?: Buscar;
  /** A origem pública, para montar o `redirect_uri`. */
  origem?: string;
}

const ehProvedor = (v: string): v is Provedor =>
  (PROVEDORES as readonly string[]).includes(v);

function biscoito(nome: string, valor: string, maxAgeMs: number, seguro: boolean): string {
  const partes = [
    `${nome}=${valor}`, 'Path=/', 'HttpOnly', 'SameSite=Lax',
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

export function montarRotasDeSso(
  app: Hono<{ Bindings: HttpBindings }>,
  opcoes: SsoHttpOptions,
): void {
  const { dados, signer, config } = opcoes;
  const agora = opcoes.now ?? Date.now;
  const seguro = opcoes.cookieSeguro ?? true;
  const buscar = opcoes.buscar ?? ((u: string, i?: RequestInit) => fetch(u, i));

  /** Logins pela metade. A chave é o `state`, que também vai no cookie. */
  const pendentes = new Map<string, Pendente>();

  const limpar = (): void => {
    const corte = agora() - PENDENTE_MS;
    for (const [k, v] of pendentes) if (v.criadoEm < corte) pendentes.delete(k);
  };

  const origemDe = (c: { req: { url: string; header(n: string): string | undefined } }): string => {
    if (opcoes.origem) return opcoes.origem;
    const host = c.req.header('host') ?? 'localhost';
    const proto = c.req.header('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https');
    return `${proto}://${host}`;
  };

  const redirectUri = (c: Parameters<typeof origemDe>[0], p: Provedor): string =>
    `${origemDe(c)}/api/sso/${p}/retorno`;

  /** Quais provedores estão de pé. A tela usa para não desenhar botão morto. */
  app.get('/api/sso', (c) =>
    c.json({ provedores: PROVEDORES.filter((p) => config[p] !== undefined) }));

  app.get('/api/sso/:provedor', (c) => {
    const bruto = c.req.param('provedor');
    if (!ehProvedor(bruto)) return c.json({ code: 'PROVEDOR_DESCONHECIDO' }, 404);
    if (!dados) return c.json({ code: 'CONTAS_INDISPONIVEIS' }, 503);

    const cfg = config[bruto];
    if (!cfg) return c.json({ code: 'PROVEDOR_INDISPONIVEL' }, 503);

    limpar();
    const desafio = criarDesafio();
    pendentes.set(desafio.estado, {
      provedor: bruto,
      verifier: desafio.verifier,
      criadoEm: agora(),
      destino: destinoSeguro(c.req.query('destino')),
    });

    // O `state` vai na URL E no cookie. É a defesa contra CSRF de login: o
    // atacante consegue fabricar a URL de volta, mas não consegue pôr um
    // cookie no navegador da vítima.
    c.header('set-cookie', biscoito(COOKIE_SSO, desafio.estado, PENDENTE_MS, seguro));
    return c.redirect(urlDeAutorizacao(bruto, cfg, desafio, redirectUri(c, bruto)), 302);
  });

  app.get('/api/sso/:provedor/retorno', async (c) => {
    const bruto = c.req.param('provedor');
    if (!ehProvedor(bruto)) return c.json({ code: 'PROVEDOR_DESCONHECIDO' }, 404);
    if (!dados) return c.json({ code: 'CONTAS_INDISPONIVEIS' }, 503);

    const cfg = config[bruto];
    if (!cfg) return c.json({ code: 'PROVEDOR_INDISPONIVEL' }, 503);

    const apagarPendente = (): void => {
      c.header('set-cookie', biscoito(COOKIE_SSO, '', 0, seguro));
    };

    // CA-364. O `state` precisa estar nos DOIS lugares e ser o mesmo.
    const estadoUrl = c.req.query('state') ?? '';
    const estadoCookie = lerCookie(c.req.header('cookie'), COOKIE_SSO) ?? '';
    if (!estadoUrl || !estadoCookie || !mesmoEstado(estadoUrl, estadoCookie)) {
      apagarPendente();
      return c.json({ code: 'ESTADO_INVALIDO' }, 400);
    }

    limpar();
    const pendente = pendentes.get(estadoUrl);
    // Consumido na hora: um `state` só vale uma volta, senão reapresentar a
    // mesma URL entraria de novo.
    pendentes.delete(estadoUrl);
    if (!pendente || pendente.provedor !== bruto) {
      apagarPendente();
      return c.json({ code: 'ESTADO_INVALIDO' }, 400);
    }

    const codigo = c.req.query('code');
    if (!codigo) {
      apagarPendente();
      // O provedor manda `error` quando a pessoa cancela. Não é falha.
      return c.redirect(`${pendente.destino}?sso=cancelado`, 302);
    }

    const perfil = await perfilDoCodigo(
      bruto, cfg, codigo, pendente.verifier, redirectUri(c, bruto), buscar);
    if (!perfil) {
      apagarPendente();
      return c.redirect(`${pendente.destino}?sso=falhou`, 302);
    }

    const conta = await resolverConta(dados, bruto, perfil);

    apagarPendente();
    c.header('set-cookie', biscoito(
      'fdp_conta', signer.signConta(conta.id, conta.epocaSessao, agora()),
      SESSAO_CONTA_MS, seguro), { append: true });

    return c.redirect(`${pendente.destino}?sso=ok`, 302);
  });
}

/**
 * De um perfil do provedor para uma conta. Três caminhos, nesta ordem.
 *
 * A ordem importa. `subject` primeiro porque é a chave: quem já entrou por
 * este provedor volta para a MESMA conta, aconteça o que acontecer com o
 * e-mail dele. Só depois o e-mail entra, e só se o provedor o tiver
 * verificado.
 */
async function resolverConta(
  dados: Dados,
  provedor: Provedor,
  perfil: { subject: string; nome: string; emailVerificado: string | null },
): Promise<Conta> {
  // 1. Já conheço esta identidade: é login.
  const conhecida = await dados.contas.porIdentidade(provedor, perfil.subject);
  if (conhecida) return conhecida;

  // 2. D-3: o e-mail VERIFICADO bate com uma conta de senha. O SSO assume.
  //
  //    CA-365 mora aqui: sem `emailVerificado`, nada disto acontece. Aceitar
  //    e-mail não verificado transformaria a regra num sequestro — bastaria
  //    pôr o endereço alheio no perfil do provedor.
  if (perfil.emailVerificado) {
    const credencial = await dados.contas.credencialPorEmail(perfil.emailVerificado);
    if (credencial) {
      const assumida = await dados.contas.assumirPorSso({
        contaId: credencial.contaId,
        provedor,
        subject: perfil.subject,
        email: perfil.emailVerificado,
      });
      if (assumida) return assumida;
    }
  }

  // 3. Ninguém conhecido: conta nova.
  return dados.contas.criarComSso({
    apelido: apelidoSugerido(perfil.nome),
    avatar: PADRAO,
    provedor,
    subject: perfil.subject,
    email: perfil.emailVerificado,
  });
}
