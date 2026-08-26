/**
 * Testes das regras do FDP. Cada bloco cita o critério de aceite de
 * docs/10-criterios-de-aceite.md §4 que ele cumpre (RNF-102).
 */

import { describe, expect, it } from 'vitest';
import {
  buildShoe,
  createRng,
  deckCountFor,
  forbiddenBetFor,
  isDoomed,
  legalBets,
  minGuaranteedDeviation,
  nextCardsThisRound,
  nextFirstBidder,
  nextLeaderOf,
  orderFrom,
  rankValue,
  resolveTrick,
  trickStanding,
  type Card,
  type CardId,
  type TieRule,
  type TrickPlay,
} from '../src/index.js';

// --- helpers ---------------------------------------------------------------

/** Monta uma vaza a partir de uma descrição `[jogador, valor]`, em ordem de jogada. */
function table(entries: readonly [string, number][]): {
  plays: TrickPlay[];
  cards: Record<CardId, Card>;
} {
  const plays: TrickPlay[] = [];
  const cards: Record<CardId, Card> = {};
  entries.forEach(([playerId, value], i) => {
    const id = `c${i}`;
    cards[id] = { id, rank: 'A', suit: 'copas', value, deckIndex: 0 };
    plays.push({ playerId, cardId: id });
  });
  return { plays, cards };
}

const ANULA_VAZA: TieRule = 'EMPATE_ANULA_VAZA';
const ANULA_CARTAS: TieRule = 'EMPATE_ANULA_CARTAS';

// --- 4.1 Baralhos, setup e progressão --------------------------------------

describe('CA-201/CA-202: sabot e número de baralhos', () => {
  it('CA-202: deckCount = ceil(jogadores × cartas / 52), mínimo 1', () => {
    expect(deckCountFor(8, 7)).toBe(2); // 56 cartas
    expect(deckCountFor(8, 6)).toBe(1); // 48 cartas
    expect(deckCountFor(2, 1)).toBe(1);
    expect(deckCountFor(8, 10)).toBe(2); // 80 cartas
    expect(deckCountFor(7, 7)).toBe(1); // 49 cartas — cabe em um baralho
  });

  it('CA-201: o sabot tem 52×d cartas, 4×d de cada valor, ids únicos', () => {
    for (const deckCount of [1, 2, 3]) {
      const shoe = buildShoe(deckCount, createRng(`seed-${deckCount}`));
      expect(shoe).toHaveLength(52 * deckCount);
      expect(new Set(shoe.map((c) => c.id)).size).toBe(52 * deckCount);

      const byValue = new Map<number, number>();
      for (const card of shoe) byValue.set(card.value, (byValue.get(card.value) ?? 0) + 1);
      expect([...byValue.keys()].sort((a, b) => a - b)).toEqual(
        Array.from({ length: 13 }, (_, i) => i + 2),
      );
      for (const count of byValue.values()) expect(count).toBe(4 * deckCount);
    }
  });

  it('CA-203: com 2 baralhos existem cartas idênticas e ids distintos', () => {
    const shoe = buildShoe(2, createRng('dup'));
    const key = (c: Card): string => `${c.rank}-${c.suit}`;
    const groups = new Map<string, Card[]>();
    for (const card of shoe) groups.set(key(card), [...(groups.get(key(card)) ?? []), card]);
    for (const cards of groups.values()) {
      expect(cards).toHaveLength(2);
      expect(cards[0]!.id).not.toBe(cards[1]!.id);
    }
  });

  it('CA-201: ids são opacos — não derivam da carta nem da posição', () => {
    const shoeA = buildShoe(1, createRng('opaco-a'));
    const shoeB = buildShoe(1, createRng('opaco-b'));
    const key = (c: Card): string => `${c.rank}-${c.suit}-${c.deckIndex}`;

    for (const card of shoeA) expect(card.id).toMatch(/^k[0-9a-f]{16}$/);

    // A mesma carta recebe ids distintos em partidas distintas: o id não é
    // função de (rank, naipe, baralho), então ninguém deriva a carta a partir
    // dele. É o que sustenta RJ-100 na rodada de testa.
    const idsB = new Map(shoeB.map((c) => [key(c), c.id]));
    let iguais = 0;
    for (const card of shoeA) if (idsB.get(key(card)) === card.id) iguais++;
    expect(iguais).toBe(0);

    // E o id também não codifica a posição no sabot embaralhado: são sorteados
    // antes do embaralhamento, então a ordem dos ids não é a ordem das cartas.
    const ordenados = shoeA.map((c) => c.id).slice().sort();
    expect(shoeA.map((c) => c.id)).not.toEqual(ordenados);
  });

  it('RJ-021: valores de 2 a 14, com A no topo', () => {
    expect(rankValue('2')).toBe(2);
    expect(rankValue('10')).toBe(10);
    expect(rankValue('J')).toBe(11);
    expect(rankValue('A')).toBe(14);
  });
});

describe('CA-209: embaralhamento determinístico e uniforme', () => {
  it('o mesmo seed produz sempre o mesmo sabot', () => {
    const a = buildShoe(2, createRng('mesma-semente')).map((c) => `${c.rank}${c.suit}`);
    const b = buildShoe(2, createRng('mesma-semente')).map((c) => `${c.rank}${c.suit}`);
    expect(a).toEqual(b);
  });

  it('seeds diferentes produzem sabots diferentes', () => {
    const a = buildShoe(1, createRng('s1')).map((c) => c.value);
    const b = buildShoe(1, createRng('s2')).map((c) => c.value);
    expect(a).not.toEqual(b);
  });

  it('a distribuição por posição é uniforme dentro da tolerância', () => {
    // Onde cai o Ás de copas do baralho 0, ao longo de muitos embaralhamentos.
    const buckets = new Array(52).fill(0) as number[];
    const runs = 52_000;
    for (let i = 0; i < runs; i++) {
      const shoe = buildShoe(1, createRng(`u${i}`));
      const pos = shoe.findIndex((c) => c.rank === 'A' && c.suit === 'copas');
      buckets[pos]! += 1;
    }
    const expected = runs / 52; // 1000
    for (const count of buckets) {
      expect(Math.abs(count - expected)).toBeLessThan(expected * 0.2);
    }
    // Prazo explícito: são 52 mil embaralhamentos, ~2,3 s numa máquina
    // ociosa. O teste é DETERMINÍSTICO — as sementes são fixas —, então
    // falhar aqui só pode ser prazo, e o padrão de 5 s do vitest deixava-o a
    // um pico de CPU de virar falso vermelho. Aconteceu em 26/08/2026, quando
    // os testes de avatar entraram e passaram a decodificar imagens grandes
    // em paralelo.
  }, 20_000);

  it('nextInt não tem viés de módulo em faixas não potência de dois', () => {
    const rng = createRng('bias');
    const buckets = new Array(3).fill(0) as number[];
    for (let i = 0; i < 60_000; i++) buckets[rng.nextInt(3)]! += 1;
    for (const count of buckets) expect(Math.abs(count - 20_000)).toBeLessThan(1200);
  });
});

describe('CA-205: progressão em serrote', () => {
  it('sobe até o teto e volta a 1, sem vai-e-volta', () => {
    const sequence: number[] = [1];
    for (let i = 1; i < 20; i++) sequence.push(nextCardsThisRound(sequence[i - 1]!, 7));
    expect(sequence).toEqual([
      1, 2, 3, 4, 5, 6, 7, 1, 2, 3, 4, 5, 6, 7, 1, 2, 3, 4, 5, 6,
    ]);
  });

  it('CA-205: o teto não é reduzido pelo número de jogadores', () => {
    // Com 8 jogadores, 7 cartas continuam valendo — o custo vira 2 baralhos.
    expect(nextCardsThisRound(6, 7)).toBe(7);
    expect(deckCountFor(8, 7)).toBe(2);
  });
});

describe('CA-207: rotação do primeiro apostador', () => {
  const order = ['p1', 'p2', 'p3', 'p4'];
  const all = () => true;

  it('avança um jogador por rodada', () => {
    expect(nextFirstBidder(order, 'p1', all)).toBe('p2');
    expect(nextFirstBidder(order, 'p4', all)).toBe('p1');
  });

  it('RJ-039: pula quem saiu, ancorando na posição de quem abriu antes', () => {
    const active = (id: string): boolean => id === 'p1' || id === 'p4';
    expect(nextFirstBidder(order, 'p2', active)).toBe('p4');
    expect(nextFirstBidder(order, 'p1', active)).toBe('p4');
    // Mesmo tendo saído, p3 continua servindo de âncora.
    expect(nextFirstBidder(order, 'p3', active)).toBe('p4');
  });

  it('orderFrom devolve os ativos em ordem horária', () => {
    expect(orderFrom(order, 'p3', all)).toEqual(['p3', 'p4', 'p1', 'p2']);
    expect(orderFrom(order, 'p3', (id) => id !== 'p4')).toEqual(['p3', 'p1', 'p2']);
  });
});

// --- 4.2 Apostas e a soma proibida -----------------------------------------

describe('CA-220 a CA-224: regra da soma proibida', () => {
  it('CA-220: com 2 cartas e apostas 0,0,1,0 o valor proibido é 1', () => {
    expect(forbiddenBetFor(2, [0, 0, 1, 0])).toBe(1);
    expect(legalBets(2, [0, 0, 1, 0], true)).toEqual([0, 2]);
  });

  it('CA-222: some a restrição quando o valor cai fora do intervalo', () => {
    expect(forbiddenBetFor(2, [3])).toBeNull(); // 2 − 3 = −1
    expect(forbiddenBetFor(2, [])).toBe(2);
    expect(legalBets(2, [3], true)).toEqual([0, 1, 2]);
  });

  it('CA-224: o último apostador sempre tem ao menos uma aposta legal', () => {
    for (let cards = 1; cards <= 10; cards++) {
      for (let sum = 0; sum <= cards * 8; sum++) {
        expect(legalBets(cards, [sum], true).length).toBeGreaterThan(0);
      }
    }
  });

  it('CA-223: nenhuma combinação legal fecha a soma com o número de cartas', () => {
    for (let cards = 1; cards <= 7; cards++) {
      const previous = [Math.floor(cards / 2)];
      for (const bet of legalBets(cards, previous, true)) {
        expect(previous[0]! + bet).not.toBe(cards);
      }
    }
  });

  it('quem não é o último não sofre restrição', () => {
    expect(legalBets(2, [0], false)).toEqual([0, 1, 2]);
  });
});

// --- 4.3 Vazas e empates ---------------------------------------------------

describe('CA-240 a CA-248: resolução de vaza', () => {
  it('CA-240: sem empate, vence a maior — em qualquer modo', () => {
    const { plays, cards } = table([['a', 14], ['b', 13], ['c', 5]]);
    for (const rule of [ANULA_VAZA, ANULA_CARTAS]) {
      expect(resolveTrick(plays, cards, rule).winnerId).toBe('a');
    }
  });

  it('CA-204: naipe e baralho de origem não influenciam', () => {
    const cards: Record<CardId, Card> = {
      x: { id: 'x', rank: 'K', suit: 'paus', value: 13, deckIndex: 1 },
      y: { id: 'y', rank: 'K', suit: 'copas', value: 13, deckIndex: 0 },
      z: { id: 'z', rank: 'A', suit: 'ouros', value: 14, deckIndex: 1 },
    };
    const plays = [
      { playerId: 'a', cardId: 'x' },
      { playerId: 'b', cardId: 'y' },
      { playerId: 'c', cardId: 'z' },
    ];
    expect(resolveTrick(plays, cards, ANULA_CARTAS).winnerId).toBe('c');
    // Os dois reis empatam entre si, independentemente de naipe e deckIndex.
    const semAs = plays.slice(0, 2);
    expect(resolveTrick(semAs, cards, ANULA_CARTAS).winnerId).toBeNull();
  });

  it('CA-241: ANULA_VAZA — empate no topo, ninguém leva', () => {
    const { plays, cards } = table([['a', 14], ['b', 14], ['c', 13], ['d', 5], ['e', 3]]);
    const r = resolveTrick(plays, cards, ANULA_VAZA);
    expect(r.winnerId).toBeNull();
    expect(r.annulledValue).toBe(14);
  });

  it('CA-242: ANULA_CARTAS — A A K 5 3 → vence o K', () => {
    const { plays, cards } = table([['a', 14], ['b', 14], ['c', 13], ['d', 5], ['e', 3]]);
    expect(resolveTrick(plays, cards, ANULA_CARTAS).winnerId).toBe('c');
  });

  it('CA-243: ANULA_CARTAS — A A K K 5 → vence o 5', () => {
    const { plays, cards } = table([['a', 14], ['b', 14], ['c', 13], ['d', 13], ['e', 5]]);
    expect(resolveTrick(plays, cards, ANULA_CARTAS).winnerId).toBe('e');
  });

  it('CA-244: ANULA_CARTAS — A A K K → ninguém vence', () => {
    const { plays, cards } = table([['a', 14], ['b', 14], ['c', 13], ['d', 13]]);
    const r = resolveTrick(plays, cards, ANULA_CARTAS);
    expect(r.winnerId).toBeNull();
    expect(r.annulledValue).toBe(14); // grupo mais alto, para RJ-087
  });

  it('CA-245: A A A A A → ninguém vence, nos dois modos', () => {
    const { plays, cards } = table([
      ['a', 14], ['b', 14], ['c', 14], ['d', 14], ['e', 14],
    ]);
    for (const rule of [ANULA_VAZA, ANULA_CARTAS]) {
      expect(resolveTrick(plays, cards, rule).winnerId).toBeNull();
    }
  });
});

describe('CA-246 a CA-248: quem puxa a vaza seguinte', () => {
  it('CA-246: com vencedor, é ele', () => {
    const { plays, cards } = table([['a', 14], ['b', 5]]);
    const r = resolveTrick(plays, cards, ANULA_CARTAS);
    expect(nextLeaderOf(plays, cards, r)).toBe('a');
  });

  it('CA-247: sem vencedor, puxa o ÚLTIMO a jogar o valor empatado mais alto', () => {
    // Ordem de jogada: P1:K P2:A P3:5 P4:A → empate em A entre P2 e P4.
    const { plays, cards } = table([['p1', 13], ['p2', 14], ['p3', 5], ['p4', 14]]);
    const r = resolveTrick(plays, cards, ANULA_VAZA);
    expect(r.winnerId).toBeNull();
    expect(nextLeaderOf(plays, cards, r)).toBe('p4');
  });

  it('CA-248: ANULA_CARTAS com dois grupos anulados usa o de valor mais alto', () => {
    // P1:A P2:K P3:A P4:K → A anula com A, K anula com K, ninguém vence.
    const { plays, cards } = table([['p1', 14], ['p2', 13], ['p3', 14], ['p4', 13]]);
    const r = resolveTrick(plays, cards, ANULA_CARTAS);
    expect(r.winnerId).toBeNull();
    expect(r.annulledValue).toBe(14);
    expect(nextLeaderOf(plays, cards, r)).toBe('p3');
  });

  it('empate triplo: puxa o último dos três', () => {
    const { plays, cards } = table([['p1', 14], ['p2', 14], ['p3', 7], ['p4', 14]]);
    const r = resolveTrick(plays, cards, ANULA_VAZA);
    expect(nextLeaderOf(plays, cards, r)).toBe('p4');
  });
});

// --- 4.4 Morte -------------------------------------------------------------

describe('CA-260/CA-261: desvio mínimo garantido e morte', () => {
  it('CA-260: ultrapassou a aposta — o excesso já está garantido', () => {
    expect(minGuaranteedDeviation(2, 3, 2)).toBe(1);
  });

  it('CA-260: não alcança mais a aposta — a falta já está garantida', () => {
    expect(minGuaranteedDeviation(3, 0, 2)).toBe(1);
  });

  it('CA-260: ainda dá para acertar em cheio', () => {
    expect(minGuaranteedDeviation(2, 1, 2)).toBe(0);
    expect(minGuaranteedDeviation(0, 0, 5)).toBe(0);
  });

  it('CA-261: morre quando o desvio garantido alcança as vidas', () => {
    // 1 vida, apostou 0 e ganhou a primeira vaza de 7: já era.
    expect(isDoomed(0, 1, 6, 1)).toBe(true);
    // 2 vidas, mesmo cenário: ainda respira.
    expect(isDoomed(0, 1, 6, 2)).toBe(false);
    // Apostou 3, restam 2 vazas e ganhou 0: erra por 1 no mínimo.
    expect(isDoomed(3, 0, 2, 1)).toBe(true);
  });

  it('acertar em cheio nunca é morte', () => {
    expect(isDoomed(2, 2, 0, 1)).toBe(false);
  });
});

// --- parcial da vaza, para a interface --------------------------------------

describe('trickStanding: quem está ganhando, e por quê', () => {
  /** As mesmas cartas de `table`, mas na forma que a projeção entrega ao cliente. */
  const mesa = (entries: readonly [string, number][]) =>
    entries.map(([playerId, value], i) => ({
      playerId,
      card: { id: `c${i}`, rank: 'A', suit: 'copas', value, deckIndex: 0 } as Card,
    }));

  it('com a vaza pela metade, responde sobre as cartas que já estão na mesa', () => {
    // Quem chama é que sabe se a vaza fechou; daqui a resposta é sempre "entre
    // ESTAS cartas, quem ganha". A interface lê isso como parcial durante a
    // vaza e como resultado quando ela fecha.
    const parcial = trickStanding(mesa([['a', 9], ['b', 12]]), ANULA_CARTAS);

    expect(parcial.winnerId).toBe('b');
    expect(parcial.annulledIds).toEqual([]);
  });

  it('vaza vazia não tem parcial nem vencedor', () => {
    expect(trickStanding([], ANULA_CARTAS)).toEqual({
      winnerId: null, annulledValue: null, annulledIds: [],
    });
  });

  // A tabela de `02` §3.6.1, agora cobrando também QUEM saiu da disputa —
  // que é o que a interface precisa para explicar o destaque pulando.
  it('A K 5 3: o A leva nos dois modos, sem ninguém anulado', () => {
    const plays = mesa([['a', 14], ['b', 13], ['c', 5], ['d', 3]]);
    for (const rule of [ANULA_VAZA, ANULA_CARTAS]) {
      const r = trickStanding(plays, rule);
      expect(r.winnerId).toBe('a');
      expect(r.annulledIds).toEqual([]);
    }
  });

  it('A A K 5 3: os dois ases se anulam e o destaque desce para o K', () => {
    const plays = mesa([['a', 14], ['b', 14], ['c', 13], ['d', 5], ['e', 3]]);

    const cartas = trickStanding(plays, ANULA_CARTAS);
    expect(cartas.winnerId).toBe('c');
    expect(cartas.annulledValue).toBe(14);
    expect(cartas.annulledIds.sort()).toEqual(['a', 'b']);

    const vaza = trickStanding(plays, ANULA_VAZA);
    expect(vaza.winnerId).toBeNull();
    expect(vaza.annulledIds.sort()).toEqual(['a', 'b']);
  });

  it('A A K K 5: a escada desce duas vezes e sobra o 5', () => {
    const plays = mesa([['a', 14], ['b', 14], ['c', 13], ['d', 13], ['e', 5]]);
    const r = trickStanding(plays, ANULA_CARTAS);

    expect(r.winnerId).toBe('e');
    // `annulledValue` é só o topo (RJ-087), mas a interface precisa das quatro.
    expect(r.annulledValue).toBe(14);
    expect(r.annulledIds.sort()).toEqual(['a', 'b', 'c', 'd']);
  });

  it('empate geral: ninguém leva e todos ficam anulados', () => {
    const r = trickStanding(mesa([['a', 7], ['b', 7]]), ANULA_CARTAS);
    expect(r.winnerId).toBeNull();
    expect(r.annulledIds.sort()).toEqual(['a', 'b']);
  });

  it('concorda com resolveTrick, que é o que o motor usa', () => {
    const entries: [string, number][] = [['a', 14], ['b', 14], ['c', 13], ['d', 5]];
    const { plays, cards } = table(entries);
    for (const rule of [ANULA_VAZA, ANULA_CARTAS]) {
      const doMotor = resolveTrick(plays, cards, rule);
      const daTela = trickStanding(mesa(entries), rule);
      expect({ winnerId: daTela.winnerId, annulledValue: daTela.annulledValue }).toEqual(doMotor);
    }
  });
});
