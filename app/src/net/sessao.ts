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

async function api<T>(caminho: string, corpo?: unknown): Promise<T> {
  const init: RequestInit = corpo
    ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(corpo) }
    : { method: 'GET' };
  const r = await fetch(caminho, init);
  const dados = (await r.json()) as Record<string, string>;
  if (!r.ok) throw new ErroApi(dados.code ?? 'ERRO', dados.motivo ?? dados.code ?? 'Deu errado.');
  return dados as T;
}

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
