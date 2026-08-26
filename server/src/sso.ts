/**
 * SSO com Google e GitHub (plano 01, D-2 e F3).
 *
 * Fluxo de **código de autorização**, inteiro no servidor. O navegador só é
 * redirecionado: não há SDK, e nenhum token de provedor chega ao cliente. Isso
 * não é só higiene — é RNF-055, o orçamento de 180 KB do bundle, que um SDK de
 * OAuth come sozinho.
 *
 * ## PKCE só no Google, e isso é do GitHub
 *
 * O Google aceita PKCE (S256) e ele vai. **O GitHub não implementa PKCE** em
 * OAuth App nenhum — mandar `code_challenge` para lá é ruído que ele ignora.
 * Lá a defesa é o `state` mais o segredo do cliente, e o `state` é obrigatório
 * nos dois. Escrever isto aqui evita a próxima pessoa "consertar" a ausência.
 *
 * ## A chave é o `subject`, nunca o e-mail
 *
 * E-mail no Google e no GitHub muda; o `sub` não. Casar identidade por e-mail
 * faria a conta trocar de dono no dia em que alguém trocasse de endereço.
 */

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Provedor } from '@fdp/contas';

export interface PerfilDoProvedor {
  subject: string;
  /** Apelido sugerido. Pode vir vazio e a tela pede um. */
  nome: string;
  /** `null` quando o provedor não deu e-mail **verificado**. Ver CA-365. */
  emailVerificado: string | null;
}

export interface ConfigDoProvedor {
  clientId: string;
  clientSecret: string;
}

export type ConfigSso = Partial<Record<Provedor, ConfigDoProvedor>>;

interface Endpoints {
  autorizar: string;
  token: string;
  escopo: string;
  /** GitHub não implementa PKCE em OAuth App. Ver o cabeçalho deste arquivo. */
  pkce: boolean;
}

const ENDPOINTS: Record<Provedor, Endpoints> = {
  google: {
    autorizar: 'https://accounts.google.com/o/oauth2/v2/auth',
    token: 'https://oauth2.googleapis.com/token',
    escopo: 'openid email profile',
    pkce: true,
  },
  github: {
    autorizar: 'https://github.com/login/oauth/authorize',
    token: 'https://github.com/login/oauth/access_token',
    // `user:email` é preciso para ler `/user/emails`: o e-mail do perfil
    // público pode estar vazio ou não verificado, e é o verificado que decide
    // a tomada de conta de D-3.
    escopo: 'read:user user:email',
    pkce: false,
  },
};

/** Quanto um login pela metade fica de pé. Curto: é um pulo de redirect. */
export const PENDENTE_MS = 10 * 60_000;

export interface Pendente {
  provedor: Provedor;
  verifier: string;
  criadoEm: number;
  /** Para onde voltar depois. Só caminho, nunca URL de fora — ver `destinoSeguro`. */
  destino: string;
}

/**
 * Um `open redirect` é o presente que um fluxo de login dá ao phishing: manda
 * a pessoa para o provedor de verdade e a traz de volta para o site do
 * atacante, já autenticada. Só caminho interno passa daqui.
 */
export function destinoSeguro(bruto: string | null | undefined): string {
  if (typeof bruto !== 'string' || bruto.length === 0) return '/';
  // `//outro.site` é URL absoluta protocol-relative, e `\` é normalizado para
  // `/` por vários navegadores — os dois escapariam de um teste ingênuo de
  // "começa com barra".
  if (!bruto.startsWith('/') || bruto.startsWith('//') || bruto.includes('\\')) return '/';
  return bruto;
}

const b64url = (b: Buffer): string => b.toString('base64url');

export interface Desafio {
  estado: string;
  verifier: string;
  challenge: string;
}

export function criarDesafio(): Desafio {
  const verifier = b64url(randomBytes(32));
  return {
    estado: b64url(randomBytes(24)),
    verifier,
    challenge: b64url(createHash('sha256').update(verifier).digest()),
  };
}

/** Comparação em tempo constante para o `state`, que é segredo de sessão. */
export function mesmoEstado(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export function urlDeAutorizacao(
  provedor: Provedor,
  config: ConfigDoProvedor,
  desafio: Desafio,
  redirectUri: string,
): string {
  const e = ENDPOINTS[provedor];
  const url = new URL(e.autorizar);
  url.searchParams.set('client_id', config.clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', e.escopo);
  url.searchParams.set('state', desafio.estado);

  if (e.pkce) {
    url.searchParams.set('code_challenge', desafio.challenge);
    url.searchParams.set('code_challenge_method', 'S256');
  }
  return url.toString();
}

export type Buscar = (url: string, init?: RequestInit) => Promise<Response>;

/**
 * Troca o código pelo perfil. Devolve `null` quando o provedor recusa.
 *
 * `buscar` é injetável para o teste poder percorrer o fluxo inteiro sem rede.
 * Sem isso, o caminho que mais importa — o da tomada de conta — só se
 * verificaria em produção, com uma conta de verdade.
 */
export async function perfilDoCodigo(
  provedor: Provedor,
  config: ConfigDoProvedor,
  codigo: string,
  verifier: string,
  redirectUri: string,
  buscar: Buscar,
): Promise<PerfilDoProvedor | null> {
  const e = ENDPOINTS[provedor];

  const corpo = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    code: codigo,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
  });
  if (e.pkce) corpo.set('code_verifier', verifier);

  const resposta = await buscar(e.token, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: corpo.toString(),
  });
  if (!resposta.ok) return null;

  const token = (await resposta.json().catch(() => null)) as { access_token?: unknown } | null;
  const acesso = typeof token?.access_token === 'string' ? token.access_token : null;
  if (!acesso) return null;

  return provedor === 'google'
    ? perfilGoogle(acesso, buscar)
    : perfilGitHub(acesso, buscar);
}

async function perfilGoogle(acesso: string, buscar: Buscar): Promise<PerfilDoProvedor | null> {
  const r = await buscar('https://openidconnect.googleapis.com/v1/userinfo', {
    headers: { authorization: `Bearer ${acesso}` },
  });
  if (!r.ok) return null;

  const u = (await r.json().catch(() => null)) as {
    sub?: unknown; name?: unknown; email?: unknown; email_verified?: unknown;
  } | null;
  if (typeof u?.sub !== 'string' || u.sub.length === 0) return null;

  // `email_verified` pode vir booleano ou a string "true", conforme o caminho.
  const verificado = u.email_verified === true || u.email_verified === 'true';
  return {
    subject: u.sub,
    nome: typeof u.name === 'string' ? u.name : '',
    emailVerificado: verificado && typeof u.email === 'string' ? u.email : null,
  };
}

/**
 * GitHub exige um segundo pedido.
 *
 * O e-mail do perfil público pode estar vazio (quem esconde) ou não
 * verificado, e é o VERIFICADO que autoriza a tomada de conta de D-3. Usar o
 * do perfil transformaria a regra num sequestro: bastaria pôr o e-mail alheio
 * no perfil do GitHub.
 */
async function perfilGitHub(acesso: string, buscar: Buscar): Promise<PerfilDoProvedor | null> {
  const cabecalhos = {
    authorization: `Bearer ${acesso}`,
    accept: 'application/vnd.github+json',
    'user-agent': 'fdp',
  };

  const r = await buscar('https://api.github.com/user', { headers: cabecalhos });
  if (!r.ok) return null;

  const u = (await r.json().catch(() => null)) as {
    id?: unknown; login?: unknown; name?: unknown;
  } | null;
  if (u?.id === undefined || u.id === null) return null;

  let emailVerificado: string | null = null;
  const re = await buscar('https://api.github.com/user/emails', { headers: cabecalhos });
  if (re.ok) {
    const lista = (await re.json().catch(() => null)) as
      | { email?: unknown; primary?: unknown; verified?: unknown }[]
      | null;
    if (Array.isArray(lista)) {
      const bom = lista.find(
        (x) => x.primary === true && x.verified === true && typeof x.email === 'string');
      if (bom) emailVerificado = bom.email as string;
    }
  }

  return {
    subject: String(u.id),
    nome: typeof u.name === 'string' && u.name ? u.name
      : typeof u.login === 'string' ? u.login : '',
    emailVerificado,
  };
}

/**
 * Apelido a partir do que o provedor deu.
 *
 * `nicknameSchema` exige de 2 a 16 caracteres. Nome de provedor vem com
 * sobrenome, emoji e o que a pessoa quiser, então corta-se no primeiro nome e
 * cai-se em "Jogador" quando não sobra nada — recusar o cadastro porque o
 * nome do Google é comprido seria absurdo.
 */
export function apelidoSugerido(nome: string): string {
  const limpo = nome.trim().split(/\s+/)[0] ?? '';
  if (limpo.length >= 2) return limpo.slice(0, 16);
  return 'Jogador';
}

export function configuracaoDoAmbiente(env: NodeJS.ProcessEnv): ConfigSso {
  const config: ConfigSso = {};
  if (env['GOOGLE_CLIENT_ID'] && env['GOOGLE_CLIENT_SECRET']) {
    config.google = {
      clientId: env['GOOGLE_CLIENT_ID'], clientSecret: env['GOOGLE_CLIENT_SECRET'],
    };
  }
  if (env['GITHUB_CLIENT_ID'] && env['GITHUB_CLIENT_SECRET']) {
    config.github = {
      clientId: env['GITHUB_CLIENT_ID'], clientSecret: env['GITHUB_CLIENT_SECRET'],
    };
  }
  return config;
}
