/**
 * O que o espectador vê de cada jogador (CA-410).
 *
 * `allHands` traz só o que RESTA — o motor tira a carta da mão ao jogá-la.
 * Sozinho, ele responde "o que ainda dá para fazer" e não responde "o que já
 * foi feito", e numa rodada de 6 cartas, na terceira mão, quem assiste está
 * justamente tentando lembrar o que saiu.
 */

import { describe, expect, it } from 'vitest';
import { cartasDoJogador } from '../src/plateia';
import type { Card, PlayerView } from '../src/state/tipos';

const carta = (id: string, rank = '7'): Card =>
  ({ id, rank, suit: 'espadas', value: 7 } as unknown as Card);

const vaza = (plays: { playerId: string; card: Card }[]) =>
  ({ leaderId: 'p1', playOrder: ['p1', 'p2'], plays, winnerId: null, annulledValue: null, nextLeaderId: null });

const view = (over: Partial<PlayerView>): PlayerView => ({
  allHands: {}, resolvedTricks: [], currentTrick: null, trickNumber: 1,
  cardsThisRound: 6, playerOrder: ['p1', 'p2'],
  ...over,
} as unknown as PlayerView);

describe('CA-410: jogadas e restantes, separadas', () => {
  it('junta o que resta com o que já saiu, em ordem cronológica', () => {
    const v = view({
      allHands: { p1: [carta('c5'), carta('c6')] },
      resolvedTricks: [
        vaza([{ playerId: 'p1', card: carta('c1') }, { playerId: 'p2', card: carta('x1') }]),
        vaza([{ playerId: 'p1', card: carta('c2') }, { playerId: 'p2', card: carta('x2') }]),
      ],
      currentTrick: vaza([{ playerId: 'p1', card: carta('c3') }]),
      trickNumber: 3,
    });

    const r = cartasDoJogador(v, 'p1');

    expect(r.naMao.map((c) => c.id)).toEqual(['c5', 'c6']);
    // A mão em que cada uma saiu é o que responde "quando" — sem isso as
    // jogadas viram um monte indistinto assim que passam de duas.
    expect(r.jogadas.map((j) => [j.carta.id, j.mao])).toEqual([['c1', 1], ['c2', 2], ['c3', 3]]);
  });

  it('a carta de outro jogador não entra', () => {
    const v = view({
      allHands: { p1: [carta('meu')] },
      resolvedTricks: [vaza([{ playerId: 'p2', card: carta('dele') }])],
    });
    expect(cartasDoJogador(v, 'p1').jogadas).toEqual([]);
  });

  it('a mesma carta em `resolvedTricks` e `currentTrick` conta UMA vez', () => {
    /*
     * Entre resolver a mão e recolhê-la (fase RECOLHIMENTO), a mesma vaza pode
     * aparecer nos dois lugares. Contada em dobro, ela sugeriria que o jogador
     * tinha uma cópia que nunca existiu — pior que não contar.
     */
    const repetida = carta('c1');
    const v = view({
      allHands: { p1: [] },
      resolvedTricks: [vaza([{ playerId: 'p1', card: repetida }])],
      currentTrick: vaza([{ playerId: 'p1', card: repetida }]),
      trickNumber: 1,
    });

    expect(cartasDoJogador(v, 'p1').jogadas.map((j) => j.carta.id)).toEqual(['c1']);
  });

  it('jogador sem nada em `allHands` ainda mostra o que jogou', () => {
    // No fim da rodada todo mundo fica sem cartas, e é exatamente aí que o
    // histórico do que saiu é a única coisa que resta para olhar.
    const v = view({
      allHands: {},
      resolvedTricks: [vaza([{ playerId: 'p1', card: carta('c1') }])],
    });
    const r = cartasDoJogador(v, 'p1');
    expect(r.naMao).toEqual([]);
    expect(r.jogadas).toHaveLength(1);
  });
});
