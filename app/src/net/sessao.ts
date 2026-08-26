/**
 * Sessão e HTTP de `06`.
 *
 * Uma sessão POR SALA, e não uma global: é o que permite participar de salas
 * diferentes em abas diferentes. O token é assinado e escopado — guardá-lo no
 * `localStorage` não dá acesso a nada além daquela sala, e ele expira com ela.
 */

export interface Sessao {
  playerId: string;
  sessionToken: string;
  roomCode: string;
  wsUrl: string;
  role: 'PLAYER' | 'SPECTATOR';
}

const chave = (codigo: string) => `fdp.session.${codigo}`;

export const guardado = (codigo: string) => localStorage.getItem(chave(codigo));
export const guardar = (codigo: string, token: string) => localStorage.setItem(chave(codigo), token);
export const esquecer = (codigo: string) => localStorage.removeItem(chave(codigo));

export const ultimaSala = () => localStorage.getItem('fdp.ultima');
export const lembrarSala = (codigo: string) => localStorage.setItem('fdp.ultima', codigo);

/** Erro com o motivo já em português, pronto para a tela. */
export class ErroApi extends Error {
  constructor(readonly codigo: string, mensagem: string) {
    super(mensagem);
  }
}

async function api<T>(caminho: string, corpo?: unknown, metodo?: string): Promise<T> {
  const init: RequestInit = corpo !== undefined
    ? {
        method: metodo ?? 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(corpo),
        // O cookie de sessão de conta é `HttpOnly` e mesma origem; sem isto
        // ele não acompanha o pedido e a pessoa parece deslogada.
        credentials: 'same-origin',
      }
    : { method: metodo ?? 'GET', credentials: 'same-origin' };
  const r = await fetch(caminho, init);
  const dados = (await r.json()) as Record<string, string>;
  if (!r.ok) throw new ErroApi(dados.code ?? 'ERRO', dados.motivo ?? dados.code ?? 'Deu errado.');
  return dados as T;
}

// --- contas (plano 01, F2) --------------------------------------------------

export interface ContaPublica {
  slug: string;
  apelido: string;
  avatar: { emoji: string; color: string };
}

/**
 * Quem está logado, ou `null`.
 *
 * Nunca lança: visitante é o estado NORMAL de quem ainda não fez conta, e um
 * erro aqui deixaria a tela inicial em branco por causa da parte opcional do
 * produto. Servidor sem banco também cai aqui, e o jogo segue (I-1).
 */
export async function quemSouEu(): Promise<ContaPublica | null> {
  try {
    const r = await api<{ conta: ContaPublica | null }>('/api/eu');
    return r.conta;
  } catch {
    return null;
  }
}

export const criarConta = (dados: {
  apelido: string; email: string; senha: string; avatar?: unknown;
}) => api<{ conta: ContaPublica }>('/api/contas', dados);

export const entrarComSenha = (email: string, senha: string) =>
  api<{ conta: ContaPublica }>('/api/sessao', { email, senha });

export const sairDaConta = () => api<{ ok: true }>('/api/sessao', undefined, 'DELETE');

/**
 * R-4 do plano 01 §5.1: quem tem conta edita **a conta**, não o apelido que a
 * mesa lhe deu. Se a sala desempatou para "João (2)" e isto gravasse o que
 * está na mesa, o sufixo entraria na conta e viraria permanente.
 */
export const salvarPerfilDaConta = (apelido: string, avatar: unknown) =>
  api<{ conta: ContaPublica }>('/api/eu', { apelido, avatar }, 'PATCH');

export const perfilPublico = (slug: string) =>
  api<{ conta: ContaPublica; resumo: { partidas: number; vitorias: number; notaMedia: number | null } }>(
    `/api/perfis/${encodeURIComponent(slug)}`);

/**
 * Cria a sala. Quem está logado tem a identidade tirada da CONTA pelo servidor,
 * e o que vai no corpo é ignorado — mandar mesmo assim mantém o caminho de
 * convidado funcionando sem `if` no cliente.
 */
export const criarSala = (nickname: string, avatar?: unknown) =>
  api<Sessao>('/api/rooms', { nickname, ...(avatar ? { avatar } : {}) });

export const entrarNaSala = (codigo: string, nickname: string, avatar?: unknown) =>
  api<Sessao>(`/api/rooms/${codigo}/join`, { nickname, ...(avatar ? { avatar } : {}) });

export const retomarSessao = (codigo: string, sessionToken: string) =>
  api<Sessao>(`/api/rooms/${codigo}/session`, { sessionToken });

/**
 * Recarregar a página não pode custar o lugar na mesa (CA-007). O código sai da
 * URL (link de convite) ou da última sala visitada; o token guardado revalida
 * em `/session`, que devolve o MESMO `playerId`.
 */
export async function retomar(): Promise<Sessao | null> {
  const codigo = new URLSearchParams(location.search).get('sala') ?? ultimaSala();
  if (!codigo) return null;
  const token = guardado(codigo);
  if (!token) return null;
  try {
    return await retomarSessao(codigo, token);
  } catch {
    esquecer(codigo);
    return null;
  }
}
