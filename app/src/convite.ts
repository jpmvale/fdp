import { ROOM_CODE_LENGTH } from '@fdp/protocol';

/**
 * O link de convite (RF-107).
 *
 * `/j/ABCDE` é o formato de `06`, e é o que o servidor reconhece para escrever
 * o cartão do link compartilhado. `?sala=ABCDE` é o formato que o produto usou
 * até 02/09/2026 e continua funcionando — links já foram mandados em conversas
 * que ninguém vai voltar para corrigir, e link de convite que morre é a pior
 * coisa que este jogo poderia fazer com quem o divulgou.
 *
 * Puro, e recebendo a `location` por parâmetro, para ser testável sem
 * navegador: o único jeito de errar aqui é silencioso — o código não é
 * preenchido, e a pessoa que clicou no convite cai numa tela vazia sem entender
 * por quê.
 */
export function codigoDoConvite(onde: { pathname: string; search: string }): string {
  const doCaminho = /^\/j\/([^/]+)\/?$/.exec(onde.pathname)?.[1];
  const daQuery = new URLSearchParams(onde.search).get('sala');
  const bruto = (doCaminho ?? daQuery ?? '').toUpperCase();

  // O que não tem cara de código não é preenchido. Deixar lixo no campo faria a
  // pessoa apagar caractere por caractere antes de poder digitar o certo.
  return bruto.length === ROOM_CODE_LENGTH ? bruto : '';
}

/** A URL que se manda para os amigos. */
export function linkDoConvite(origem: string, codigo: string): string {
  return `${origem}/j/${codigo}`;
}
