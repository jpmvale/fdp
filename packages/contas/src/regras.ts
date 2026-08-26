/**
 * As regras que as DUAS implementações precisam cumprir igual.
 *
 * Existe por causa de um defeito que já aconteceu neste projeto: a
 * classificação final vivia em dois lugares, o motor e a tela, e as duas
 * divergiram em silêncio — quem caiu primeiro aparecia em segundo lugar
 * (CA-360). Slug e a regra de gravação são exatamente do mesmo tipo: fáceis de
 * reescrever "igual" em memória e em SQL, e sutis o bastante para saírem
 * diferentes. Ficam aqui, puros, e as duas chamam.
 */

import type { JogadorDaPartida } from './tipos.js';

/**
 * Slug a partir do apelido: minúsculas, sem acento, só letra, número e hífen.
 *
 * Apelido aceita unicode inteiro (`04` §2) e o slug vai numa URL — então há
 * apelido legítimo que não sobra nada depois da limpeza ("🦊", "日本"). Nesse
 * caso o slug vira `jogador`, e o desempate numérico resolve o resto: um slug
 * feio é melhor que um cadastro recusado por causa do próprio nome.
 */
export function slugDe(apelido: string): string {
  const limpo = apelido
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24);

  return limpo.length >= 2 ? limpo : 'jogador';
}

/** `joao`, `joao-2`, `joao-3`… O primeiro livre, dado o que já existe. */
export function slugLivre(base: string, existe: (slug: string) => boolean): string {
  if (!existe(base)) return base;
  for (let n = 2; n < 10_000; n++) {
    const tentativa = `${base}-${n}`;
    if (!existe(tentativa)) return tentativa;
  }
  throw new Error(`sem slug livre para "${base}"`);
}

/**
 * RF-068: grava-se a partida se ao menos um jogador **sentado** tiver conta.
 *
 * Bot não conta — ele não é ninguém. Espectador também não, e não por
 * descuido: quem não sentou não jogou, e uma partida não deveria entrar no
 * histórico de quem só assistiu. Espectador não chega aqui, porque `jogadores`
 * é o `playerOrder` da partida.
 *
 * Uma mesa inteira de convidados não deixa rastro nenhum, que é o
 * comportamento certo: sem conta, não há a quem aquilo pertença.
 */
export function vaiPersistir(jogadores: readonly JogadorDaPartida[]): boolean {
  return jogadores.some((j) => !j.bot && j.contaId !== null);
}

/**
 * E-mail normalizado para comparação: `citext` no Postgres, isto em memória.
 *
 * Só caixa e espaço. NÃO se mexe em ponto nem em `+` do lado local: `a.b@` e
 * `ab@` são endereços diferentes por RFC, e "todo mundo sabe que no Gmail dá
 * no mesmo" é conhecimento sobre UM provedor, que não cabe numa normalização
 * geral. Tratá-los como iguais recusaria cadastro legítimo em servidor próprio.
 */
export function emailNormalizado(email: string): string {
  return email.trim().toLowerCase();
}
