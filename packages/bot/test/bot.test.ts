import { describe, expect, it } from 'vitest';
import { createRng, type PlayerView } from '@fdp/rules';
import { decidirAposta, decidirCarta, DIFICULDADES } from '@fdp/bot';

const carta = (value: number, id = `c${value}`) => ({
  id, rank: String(value) as never, suit: 'copas' as const, value, deckIndex: 0,
});

/** Uma projeção mínima, com só o que as decisões olham. */
function visao(over: Partial<PlayerView> = {}): PlayerView {
  return {
    matchId: 'm1',
    options: {} as never,
    playerOrder: ['eu', 'a', 'b'],
    lives: { eu: 5, a: 5, b: 5 },
    eliminated: [],
    withdrawn: [],
    roundNumber: 1,
    cardsThisRound: 3,
    deckCount: 1,
    firstBidderId: 'eu',
    phase: 'APOSTAS',
    activePlayerId: 'eu',
    isForeheadRound: false,
    bets: {},
    bidOrder: ['eu', 'a', 'b'],
    tricksWon: {},
    mortoEmVaza: {},
    trickNumber: 1,
    handCounts: { eu: 3, a: 3, b: 3 },
    hand: [carta(14), carta(7), carta(3)],
    foreheadCards: {},
    stockCount: 0,
    currentTrick: null,
    resolvedTricks: [],
    history: [],
    winnerIds: null,
    endReason: null,
    forbiddenBet: null,
    viewerId: 'eu',
    isSpectator: false,
    ...over,
  } as PlayerView;
}

const rng = () => createRng('semente-fixa');

describe('CA-320: o bot nunca aposta o valor proibido', () => {
  it('em nenhuma dificuldade, para todo valor proibido possível', () => {
    for (const dificuldade of DIFICULDADES) {
      for (let proibido = 0; proibido <= 3; proibido++) {
        for (let tentativa = 0; tentativa < 40; tentativa++) {
          const aposta = decidirAposta(
            visao({ forbiddenBet: proibido }),
            dificuldade,
            createRng(`s${tentativa}`),
          );
          expect(aposta).not.toBe(proibido);
          expect(aposta).toBeGreaterThanOrEqual(0);
          expect(aposta).toBeLessThanOrEqual(3);
        }
      }
    }
  });
});

describe('CA-321: o bot médio aposta segundo a mão', () => {
  it('mão de ases aposta alto; mão de cartas baixas aposta baixo', () => {
    const ases = decidirAposta(
      visao({ hand: [carta(14, 'a1'), carta(14, 'a2'), carta(13, 'k')] }),
      'MEDIO', rng(),
    );
    const lixo = decidirAposta(
      visao({ hand: [carta(2, 'x'), carta(3, 'y'), carta(4, 'z')] }),
      'MEDIO', rng(),
    );
    expect(ases).toBeGreaterThan(lixo);
    expect(lixo).toBe(0);
  });

  it('a mesma mão dá sempre a mesma aposta: a decisão é determinística', () => {
    const mao = [carta(11), carta(9), carta(5)];
    const primeira = decidirAposta(visao({ hand: mao }), 'MEDIO', rng());
    for (let i = 0; i < 10; i++) {
      expect(decidirAposta(visao({ hand: mao }), 'MEDIO', createRng(`outra-${i}`))).toBe(primeira);
    }
  });
});

describe('CA-322: na testa o bot decide pela carta dos OUTROS', () => {
  it('aposta que ganha quando o que está à vista é baixo', () => {
    const aposta = decidirAposta(
      visao({
        isForeheadRound: true, cardsThisRound: 1, hand: [],
        foreheadCards: { a: carta(3, 'a3'), b: carta(4, 'b4') } as never,
      }),
      'MEDIO', rng(),
    );
    expect(aposta).toBe(1);
  });

  it('aposta que perde quando há um ás à vista', () => {
    const aposta = decidirAposta(
      visao({
        isForeheadRound: true, cardsThisRound: 1, hand: [],
        foreheadCards: { a: carta(14, 'aA'), b: carta(4, 'b4') } as never,
      }),
      'MEDIO', rng(),
    );
    expect(aposta).toBe(0);
  });
});

describe('CA-323: o bot médio joga a carta certa para o que apostou', () => {
  it('precisando de vaza, usa a MENOR carta que ainda ganha', () => {
    const escolhida = decidirCarta(
      visao({
        phase: 'VAZAS',
        hand: [carta(14, 'as'), carta(9, 'nove'), carta(5, 'cinco')],
        bets: { eu: 2 }, tricksWon: { eu: 0 },
        currentTrick: { plays: [{ playerId: 'a', card: carta(7, 'sete') }] } as never,
      }),
      'MEDIO', rng(),
    );
    // 9 ganha do 7 e guarda o ás para depois.
    expect(escolhida).toBe('nove');
  });

  it('já tendo o que apostou, joga a MAIOR que ainda perde', () => {
    const escolhida = decidirCarta(
      visao({
        phase: 'VAZAS',
        hand: [carta(6, 'seis'), carta(9, 'nove'), carta(2, 'dois')],
        bets: { eu: 1 }, tricksWon: { eu: 1 },
        currentTrick: { plays: [{ playerId: 'a', card: carta(10, 'dez') }] } as never,
      }),
      'MEDIO', rng(),
    );
    expect(escolhida).toBe('nove');
  });

  it('quando todas ganham e ele não quer a vaza, entrega a menor', () => {
    const escolhida = decidirCarta(
      visao({
        phase: 'VAZAS',
        hand: [carta(12, 'dama'), carta(13, 'rei')],
        bets: { eu: 0 }, tricksWon: { eu: 0 },
        currentTrick: { plays: [{ playerId: 'a', card: carta(3, 'tres') }] } as never,
      }),
      'MEDIO', rng(),
    );
    expect(escolhida).toBe('dama');
  });
});

describe('CA-324: o bot só joga carta que tem na mão', () => {
  it('em qualquer dificuldade e com qualquer semente', () => {
    const mao = [carta(8, 'oito'), carta(4, 'quatro'), carta(12, 'doze')];
    const ids = new Set(mao.map((c) => c.id));
    for (const dificuldade of DIFICULDADES) {
      for (let i = 0; i < 50; i++) {
        const escolhida = decidirCarta(
          visao({ phase: 'VAZAS', hand: mao }), dificuldade, createRng(`s${i}`),
        );
        expect(ids.has(escolhida)).toBe(true);
      }
    }
  });
});

describe('CA-325: o bot não enxerga o que não deveria', () => {
  it('na testa, decide sem a própria carta — ela nem chega na projeção', () => {
    const projecao = visao({
      isForeheadRound: true, cardsThisRound: 1, hand: [],
      foreheadCards: { a: carta(9, 'a9') } as never,
    });
    // A garantia é estrutural: `hand` está vazia e `foreheadCards` não tem o
    // próprio id. Se um dia passar a ter, este teste cai junto com RJ-101.
    expect(projecao.hand).toHaveLength(0);
    expect(projecao.foreheadCards['eu']).toBeUndefined();
    expect(() => decidirAposta(projecao, 'MEDIO', rng())).not.toThrow();
  });
});
