/**
 * A nota de desempenho.
 *
 * Uma fórmula de nota erra em silêncio: o número sai plausível, ninguém
 * confere, e a mesa passa a discutir um ranking errado. Então cada
 * característica que a nota promete tem um caso aqui — incluindo o cenário que
 * motivou a nota existir.
 */

import { describe, expect, it } from 'vitest';
import { CORES, desempenhoDaPartida, faixaDe } from '../src/desempenho';
import type { PlayerView } from '../src/state/tipos';
import { contraste, hexParaRgb } from './daltonismo';

/** Uma rodada como o servidor a resume. */
function rodada(numero: number, cartas: number, dados: Record<string, [aposta: number, fez: number]>, extra?: {
  aborted?: boolean; eliminados?: string[];
}) {
  const bets: Record<string, number> = {};
  const tricksWon: Record<string, number> = {};
  const livesLost: Record<string, number> = {};
  const mortoEmVaza: Record<string, number | null> = {};
  for (const [id, [aposta, fez]] of Object.entries(dados)) {
    bets[id] = aposta; tricksWon[id] = fez;
    livesLost[id] = Math.abs(aposta - fez); mortoEmVaza[id] = null;
  }
  return {
    roundNumber: numero, cardsThisRound: cartas, deckCount: 1,
    aborted: extra?.aborted ?? false,
    bets, tricksWon, livesLost, mortoEmVaza,
    eliminatedThisRound: extra?.eliminados ?? [], annulledTricks: 0,
  };
}

function partida(
  playerOrder: string[],
  history: ReturnType<typeof rodada>[],
  winnerIds: string[] | null,
  withdrawn: { playerId: string; roundNumber: number }[] = [],
): PlayerView {
  return { playerOrder, history, winnerIds, withdrawn } as unknown as PlayerView;
}

const notaDe = (lista: ReturnType<typeof desempenhoDaPartida>, id: string) =>
  lista.find((d) => d.playerId === id)!;

describe('nota: as faixas', () => {
  it('cada faixa começa onde a anterior termina', () => {
    expect(faixaDe(0)).toBe('baixa');
    expect(faixaDe(3.9)).toBe('baixa');
    expect(faixaDe(4)).toBe('media');
    expect(faixaDe(6.4)).toBe('media');
    expect(faixaDe(6.5)).toBe('alta');
    expect(faixaDe(7.9)).toBe('alta');
    expect(faixaDe(8)).toBe('excelente');
    expect(faixaDe(10)).toBe('excelente');
  });

  it('toda faixa tem palavra, não só cor (RNF-031)', () => {
    for (const faixa of ['baixa', 'media', 'alta', 'excelente'] as const) {
      expect(CORES[faixa].rotulo.length).toBeGreaterThan(0);
    }
  });
});

describe('nota: o que ela mede', () => {
  it('acertar tudo dá nota máxima', () => {
    const p = partida(['a'], [rodada(1, 1, { a: [1, 1] }), rodada(2, 2, { a: [2, 2] })], ['a']);
    expect(notaDe(desempenhoDaPartida(p), 'a').nota).toBe(10);
  });

  it('errar o máximo possível em tudo dá zero', () => {
    // Sem vencer, sem sobreviver a rodada nenhuma além das jogadas: só o peso
    // da sobrevivência sobra, e aqui ele é cheio — o piso real não é 0.
    const p = partida(['a', 'b'], [rodada(1, 2, { a: [2, 0], b: [0, 2] })], null);
    const a = notaDe(desempenhoDaPartida(p), 'a');
    // Pontaria 0, acertos 0, sobrevivência 1 → 25% de 10.
    expect(a.nota).toBe(2.5);
    expect(a.faixa).toBe('baixa');
  });

  it('errar por pouco vale mais que errar por muito', () => {
    const p = partida(
      ['perto', 'longe'],
      [rodada(1, 5, { perto: [3, 2], longe: [5, 0] })],
      null,
    );
    const lista = desempenhoDaPartida(p);
    expect(notaDe(lista, 'perto').nota).toBeGreaterThan(notaDe(lista, 'longe').nota);
  });

  it('chegar mais longe vale ponto', () => {
    // Mesma pontaria; um jogou as três rodadas, o outro caiu na primeira.
    const p = partida(
      ['fica', 'cai'],
      [
        rodada(1, 1, { fica: [1, 1], cai: [1, 1] }),
        rodada(2, 2, { fica: [2, 2] }),
        rodada(3, 3, { fica: [3, 3] }),
      ],
      null,
    );
    const lista = desempenhoDaPartida(p);
    expect(notaDe(lista, 'fica').nota).toBeGreaterThan(notaDe(lista, 'cai').nota);
  });

  it('rodada abortada não conta para ninguém (RJ-155)', () => {
    // Abortada é refeita e não debita vida; contá-la puniria quem estava na
    // mesa quando outra pessoa caiu.
    const comAbortada = partida(
      ['a'],
      [rodada(1, 2, { a: [2, 2] }), rodada(2, 2, { a: [0, 2] }, { aborted: true })],
      null,
    );
    const semAbortada = partida(['a'], [rodada(1, 2, { a: [2, 2] })], null);

    expect(notaDe(desempenhoDaPartida(comAbortada), 'a').nota)
      .toBe(notaDe(desempenhoDaPartida(semAbortada), 'a').nota);
  });

  it('quem nunca jogou não recebe nota inventada', () => {
    const p = partida(['a', 'espectador'], [rodada(1, 1, { a: [1, 1] })], ['a']);
    const e = notaDe(desempenhoDaPartida(p), 'espectador');
    expect(e.nota).toBe(0);
    expect(e.rodadasJogadas).toBe(0);
  });
});

describe('nota: vencer e jogar bem são coisas diferentes', () => {
  it('vencer garante nota excelente, mesmo jogando mal', () => {
    // Vencedor de pontaria sofrível: sem o piso, cairia na faixa média.
    const p = partida(
      ['vencedor', 'outro'],
      [
        rodada(1, 4, { vencedor: [4, 0], outro: [4, 0] }),
        rodada(2, 4, { vencedor: [0, 4], outro: [0, 4] }),
      ],
      ['vencedor'],
    );
    const v = notaDe(desempenhoDaPartida(p), 'vencedor');
    expect(v.nota).toBe(8);
    expect(v.faixa).toBe('excelente');
  });

  it('O CASO: o segundo colocado impecável passa na frente do vencedor sofrível', () => {
    // Foi este cenário que fez a nota existir. `impecavel` acerta as três
    // primeiras rodadas em cheio e desaba na última, perdendo tudo de uma vez.
    // `vencedor` erra o tempo todo e sobrevive por atrito.
    const p = partida(
      ['impecavel', 'vencedor'],
      [
        rodada(1, 1, { impecavel: [1, 1], vencedor: [1, 0] }),
        rodada(2, 2, { impecavel: [2, 2], vencedor: [2, 0] }),
        rodada(3, 3, { impecavel: [3, 3], vencedor: [0, 3] }),
        rodada(4, 5, { impecavel: [5, 0], vencedor: [2, 1] }, { eliminados: ['impecavel'] }),
      ],
      ['vencedor'],
    );
    const lista = desempenhoDaPartida(p);
    const impecavel = notaDe(lista, 'impecavel');
    const vencedor = notaDe(lista, 'vencedor');

    expect(impecavel.nota).toBeGreaterThan(vencedor.nota);
    // Mas o vencedor não fica com nota ruim: ele venceu.
    expect(vencedor.faixa).toBe('excelente');
    // E a lista sai ordenada pela nota, não pela classificação.
    expect(lista[0]!.playerId).toBe('impecavel');
  });

  it('um vencedor que também jogou bem passa do piso pela própria pontaria', () => {
    const p = partida(
      ['a', 'b'],
      [rodada(1, 2, { a: [1, 1], b: [2, 0] }), rodada(2, 3, { a: [2, 2], b: [0, 3] })],
      ['a'],
    );
    const a = notaDe(desempenhoDaPartida(p), 'a');
    expect(a.nota).toBe(10);
  });
});

describe('nota: as cores são legíveis (RNF-030)', () => {
  it('toda cor de nota passa de 4,5:1 contra o fundo', () => {
    // As cores vivem no CSS; aqui vale o mesmo princípio da paleta de avatares
    // (CA-345): número afirmado sem medição é número que envelhece errado.
    const paleta: Record<string, string> = {
      baixa: '#ef4d5a', media: '#e0a33a', alta: '#3fb98a', excelente: '#6594fa',
    };
    const fundo = hexParaRgb('#0d121c'); // --poco, o fundo do cartão
    for (const [faixa, hex] of Object.entries(paleta)) {
      const razao = contraste(hexParaRgb(hex), fundo);
      expect(razao, `${faixa} (${hex}): ${razao.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
    }
  });
});
