/**
 * Testes do motor: partidas completas, projeção, auto-play e propriedade.
 * Cita os critérios de docs/10-criterios-de-aceite.md §4.
 */

import { describe, expect, it } from 'vitest';
import {
  isAutomaticPhase,
  advance,
  applyMove,
  autoMove,
  checkInvariants,
  checkNoLeak,
  createMatch,
  isActive,
  minGuaranteedDeviation,
  project,
  ranking,
  withdrawPlayers,
  type EngineEvent,
  type MatchOptions,
  type MatchState,
  type Move,
  type PlayerId,
} from '../src/index.js';

const ctx = { now: 0 };

function players(n: number): PlayerId[] {
  return Array.from({ length: n }, (_, i) => `p${i + 1}`);
}

function must(result: ReturnType<typeof applyMove>): MatchState {
  if (!result.ok) throw new Error(`jogada rejeitada: ${result.code}/${result.motivo}`);
  return result.state;
}

/** Roda todas as fases automáticas pendentes. */
function settle(state: MatchState): { state: MatchState; events: EngineEvent[] } {
  const events: EngineEvent[] = [];
  let current = state;
  while (
    current.endReason === null &&
    isAutomaticPhase(current.round.phase)
  ) {
    const result = advance(current, ctx);
    if (!result.ok) throw new Error(`advance falhou: ${result.motivo}`);
    current = result.state;
    events.push(...result.events);
  }
  return { state: current, events };
}

/**
 * Joga uma partida inteira com uma política de escolha, verificando invariantes
 * a cada passo. Devolve o estado final.
 */
function playMatch(
  seed: string,
  playerCount: number,
  options: Partial<MatchOptions>,
  pick: (state: MatchState, legal: Move[]) => Move,
  maxSteps = 20_000,
): { state: MatchState; violations: string[]; events: EngineEvent[] } {
  let state = createMatch({
    matchId: `m-${seed}`,
    seed,
    playerIds: players(playerCount),
    options,
  });
  const violations: string[] = [];
  const events: EngineEvent[] = [];

  const audit = (s: MatchState): void => {
    violations.push(...checkInvariants(s));
    for (const viewer of s.playerOrder) violations.push(...checkNoLeak(s, viewer));
  };

  let steps = 0;
  while (state.endReason === null) {
    if (++steps > maxSteps) throw new Error(`partida não terminou em ${maxSteps} passos`);
    const settled = settle(state);
    state = settled.state;
    events.push(...settled.events);
    audit(state);
    if (state.endReason !== null) break;

    const legal = legalMoves(state);
    const applied = applyMove(state, pick(state, legal), ctx);
    state = must(applied);
    if (applied.ok) events.push(...applied.events);
    audit(state);
  }

  return { state, violations, events };
}

function legalMoves(state: MatchState): Move[] {
  const playerId = state.round.activePlayerId;
  if (playerId === null) return [];
  const base = {
    playerId,
    roundNumber: state.roundNumber,
    trickNumber: state.round.trickNumber,
  };

  if (state.round.phase === 'APOSTAS') {
    const { round, cardsThisRound } = state;
    const placed = round.bidOrder.filter((id) => round.bets[id] !== undefined);
    const isLast = placed.length === round.bidOrder.length - 1;
    const sum = placed.reduce((n, id) => n + round.bets[id]!, 0);
    const forbidden = isLast ? cardsThisRound - sum : null;
    const moves: Move[] = [];
    for (let bet = 0; bet <= cardsThisRound; bet++) {
      if (bet !== forbidden) moves.push({ ...base, type: 'bet', bet });
    }
    return moves;
  }

  return (state.hidden.hands[playerId] ?? []).map((cardId) => ({
    ...base,
    type: 'playCard' as const,
    cardId,
  }));
}

// --- CA-200 / CA-303: determinismo -----------------------------------------

describe('CA-200/CA-303: determinismo', () => {
  it('o mesmo seed produz setup idêntico', () => {
    const a = createMatch({ matchId: 'm', seed: 'fixo', playerIds: players(5) });
    const b = createMatch({ matchId: 'm', seed: 'fixo', playerIds: players(5) });
    expect(a.playerOrder).toEqual(b.playerOrder);
    expect(a.firstBidderId).toBe(b.firstBidderId);
  });

  it('a partida inteira é reproduzível a partir do seed', () => {
    const pickFirst = (_: MatchState, legal: Move[]): Move => legal[0]!;
    const a = playMatch('repro', 4, {}, pickFirst);
    const b = playMatch('repro', 4, {}, pickFirst);
    expect(a.state.winnerIds).toEqual(b.state.winnerIds);
    expect(a.state.roundNumber).toBe(b.state.roundNumber);
    expect(a.state.history).toEqual(b.state.history);
  });

  it('CA-206: playerOrder é permutação e não muda até o fim', () => {
    const initial = createMatch({ matchId: 'm', seed: 'ordem', playerIds: players(6) });
    expect([...initial.playerOrder].sort()).toEqual(players(6).sort());
    expect(initial.cardsThisRound).toBe(1); // RJ-033
    expect(initial.playerOrder).toContain(initial.firstBidderId);

    const final = playMatch('ordem', 6, {}, (_, l) => l[0]!).state;
    expect(final.playerOrder).toEqual(initial.playerOrder);
  });

  it('CA-208: todos começam com vidasIniciais', () => {
    const state = createMatch({
      matchId: 'm',
      seed: 'vidas',
      playerIds: players(4),
      options: { vidasIniciais: 3 },
    });
    expect(Object.values(state.lives)).toEqual([3, 3, 3, 3]);
  });

  it('rejeita contagem de jogadores fora de 2..8', () => {
    expect(() => createMatch({ matchId: 'm', seed: 's', playerIds: players(1) })).toThrow();
    expect(() => createMatch({ matchId: 'm', seed: 's', playerIds: players(9) })).toThrow();
  });
});

// --- CA-210 / CA-211: distribuição -----------------------------------------

describe('CA-210/CA-211: distribuição', () => {
  it('CA-210: 8 jogadores × 7 cartas usam 2 baralhos e sobram 48 no monte', () => {
    let state = createMatch({
      matchId: 'm',
      seed: 'oito',
      playerIds: players(8),
      options: { maxCartasPorRodada: 7 },
    });
    // Salta direto para uma rodada de 7 cartas.
    state = { ...state, cardsThisRound: 7, deckCount: 0 };
    state = settle(state).state;

    expect(state.deckCount).toBe(2);
    expect(state.hidden.stock).toHaveLength(104 - 56);
    for (const id of state.playerOrder) {
      expect(state.hidden.hands[id]).toHaveLength(7);
    }
    expect(checkInvariants(state)).toEqual([]);
  });

  it('CA-211: o sabot é regerado a cada rodada', () => {
    const first = settle(
      createMatch({ matchId: 'm', seed: 'regen', playerIds: players(3) }),
    ).state;
    const idsRound1 = new Set(Object.keys(first.hidden.cards));

    let state = first;
    while (state.roundNumber === 1 && state.endReason === null) {
      state = settle(state).state;
      if (state.endReason !== null || state.roundNumber > 1) break;
      state = must(applyMove(state, legalMoves(state)[0]!, ctx));
    }
    state = settle(state).state;

    const idsRound2 = Object.keys(state.hidden.cards);
    expect(idsRound2.some((id) => idsRound1.has(id))).toBe(false);
  });
});

// --- CA-281 a CA-286: visibilidade -----------------------------------------

describe('CA-281 a CA-286: projeção e vazamento', () => {
  it('CA-281/CA-282: na rodada de testa vejo todos menos a mim', () => {
    const state = settle(
      createMatch({ matchId: 'm', seed: 'testa', playerIds: players(4) }),
    ).state;
    expect(state.round.isForeheadRound).toBe(true);

    for (const viewer of state.playerOrder) {
      const view = project(state, viewer);
      // CA-282: as cartas dos outros três estão completas.
      expect(Object.keys(view.foreheadCards).sort()).toEqual(
        state.playerOrder.filter((id) => id !== viewer).sort(),
      );
      for (const card of Object.values(view.foreheadCards)) {
        expect(card.rank).toBeDefined();
        expect(card.value).toBeGreaterThanOrEqual(2);
      }
      // CA-281: a própria carta não aparece em profundidade alguma.
      expect(view.foreheadCards[viewer]).toBeUndefined();
      expect(view.hand).toEqual([]);
      expect(checkNoLeak(state, viewer)).toEqual([]);
    }
  });

  it('CA-281: o CardId próprio não aparece no objeto serializado', () => {
    const state = settle(
      createMatch({ matchId: 'm', seed: 'serial', playerIds: players(5) }),
    ).state;
    for (const viewer of state.playerOrder) {
      const serialized = JSON.stringify(project(state, viewer));
      const ownCardId = state.hidden.hands[viewer]![0]!;
      expect(serialized).not.toContain(ownCardId);
    }
  });

  it('CA-347: na REVELAÇÃO o dono passa a ver a própria carta', () => {
    // O dono era o único da mesa que nunca via a própria carta: a revelação
    // saía no mesmo passo que resolvia a vaza e trocava para RESOLUCAO, onde
    // `foreheadCards` já está vazio. A fase que se chama REVELACAO não
    // revelava nada.
    let state = settle(
      createMatch({ matchId: 'm', seed: 'revelacao', playerIds: players(3) }),
    ).state;
    expect(state.round.isForeheadRound).toBe(true);

    // Apostando, ninguém vê a própria — é o segredo que faz a rodada (RJ-100).
    for (const viewer of state.playerOrder) {
      expect(project(state, viewer).foreheadCards[viewer]).toBeUndefined();
      expect(checkNoLeak(state, viewer)).toEqual([]);
    }

    // Fecha as apostas.
    let revelou = false;
    for (let i = 0; i < 4 && state.round.phase === 'APOSTAS'; i++) {
      const quem = state.round.activePlayerId!;
      // A conta do valor proibido é a mesma que o resto deste arquivo usa:
      // derivada de `bidOrder` e `bets`, e não lida de `round.forbiddenBet`.
      const postas = state.round.bidOrder.filter((id) => state.round.bets[id] !== undefined);
      const ultimo = postas.length === state.round.bidOrder.length - 1;
      const soma = postas.reduce((n, id) => n + state.round.bets[id]!, 0);
      const proibido = ultimo ? state.cardsThisRound - soma : null;
      let bet = 0;
      while (bet === proibido) bet++;
      const r = applyMove(state, {
        type: 'bet', playerId: quem, roundNumber: state.roundNumber,
        trickNumber: state.round.trickNumber, bet,
      }, { now: 0 });
      if (!r.ok) throw new Error(`aposta recusada: ${JSON.stringify(r)}`);
      state = r.state;
      if (r.events.some((e) => e.type === 'round:revealed')) revelou = true;
    }

    expect(state.round.phase).toBe('REVELACAO');
    // O evento sai AO ENTRAR na fase, não no fim dela.
    expect(revelou).toBe(true);

    for (const viewer of state.playerOrder) {
      const view = project(state, viewer);
      // Agora a mesa inteira está à vista, o dono incluído.
      expect(Object.keys(view.foreheadCards).sort()).toEqual([...state.playerOrder].sort());
      expect(view.foreheadCards[viewer]).toBeDefined();
      // E o verificador concorda: o segredo vale até a revelação, e ela chegou.
      expect(checkNoLeak(state, viewer)).toEqual([]);
    }
  });

  it('CA-286: em rodada de N>1 vejo só a minha mão e a contagem alheia', () => {
    let state = createMatch({ matchId: 'm', seed: 'mao', playerIds: players(4) });
    state = settle({ ...state, cardsThisRound: 4 }).state;

    for (const viewer of state.playerOrder) {
      const view = project(state, viewer);
      expect(view.hand).toHaveLength(4);
      expect(Object.keys(view.foreheadCards)).toEqual([]);
      for (const id of state.playerOrder) expect(view.handCounts[id]).toBe(4);
      expect(checkNoLeak(state, viewer)).toEqual([]);
    }
  });

  it('o valor proibido só vai para quem está na vez', () => {
    let state = createMatch({ matchId: 'm', seed: 'proib', playerIds: players(3) });
    state = settle({ ...state, cardsThisRound: 3 }).state;
    // Deixa só o último apostador de fora.
    state = must(applyMove(state, { ...baseMove(state), type: 'bet', bet: 1 }, ctx));
    state = must(applyMove(state, { ...baseMove(state), type: 'bet', bet: 1 }, ctx));

    const lastBidder = state.round.activePlayerId!;
    expect(project(state, lastBidder).forbiddenBet).toBe(1); // 3 − 2
    for (const other of state.playerOrder.filter((id) => id !== lastBidder)) {
      expect(project(state, other).forbiddenBet).toBeNull();
    }
  });
});

function baseMove(state: MatchState): {
  playerId: PlayerId;
  roundNumber: number;
  trickNumber: number;
} {
  return {
    playerId: state.round.activePlayerId!,
    roundNumber: state.roundNumber,
    trickNumber: state.round.trickNumber,
  };
}

// --- CA-221 a CA-226: validação de jogada ----------------------------------

describe('CA-221 a CA-226: rejeições', () => {
  const setup = (): MatchState => {
    const state = createMatch({ matchId: 'm', seed: 'rej', playerIds: players(3) });
    return settle({ ...state, cardsThisRound: 2 }).state;
  };

  it('CA-221: o último apostador não pode fechar a soma', () => {
    let state = setup();
    state = must(applyMove(state, { ...baseMove(state), type: 'bet', bet: 1 }, ctx));
    state = must(applyMove(state, { ...baseMove(state), type: 'bet', bet: 1 }, ctx));

    const before = state;
    const result = applyMove(state, { ...baseMove(state), type: 'bet', bet: 0 }, ctx);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('ILLEGAL_MOVE');
      expect(result.motivo).toBe('SOMA_PROIBIDA');
    }
    expect(state).toBe(before); // estado intacto
  });

  it('CA-225: aposta fora do intervalo é rejeitada', () => {
    const state = setup();
    for (const bet of [-1, 3, 1.5]) {
      const result = applyMove(state, { ...baseMove(state), type: 'bet', bet }, ctx);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.motivo).toBe('APOSTA_FORA_DO_INTERVALO');
    }
  });

  it('CA-226: jogar fora da vez é rejeitado', () => {
    const state = setup();
    const outra = state.playerOrder.find((id) => id !== state.round.activePlayerId)!;
    const result = applyMove(
      state,
      { ...baseMove(state), playerId: outra, type: 'bet', bet: 0 },
      ctx,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('NOT_YOUR_TURN');
  });

  it('CA-123: jogada de rodada ou vaza antiga é rejeitada como STALE_MOVE', () => {
    const state = setup();
    for (const stale of [
      { ...baseMove(state), roundNumber: 0 },
      { ...baseMove(state), trickNumber: 99 },
    ]) {
      const result = applyMove(state, { ...stale, type: 'bet', bet: 0 }, ctx);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe('STALE_MOVE');
    }
  });

  it('CA-121: carta que não está na mão é FORBIDDEN_CARD', () => {
    let state = setup();
    while (state.round.phase === 'APOSTAS') {
      state = must(applyMove(state, legalMoves(state)[0]!, ctx));
    }
    const player = state.round.activePlayerId!;
    const alheia = state.playerOrder
      .filter((id) => id !== player)
      .flatMap((id) => state.hidden.hands[id] ?? [])[0]!;

    const result = applyMove(
      state,
      { ...baseMove(state), type: 'playCard', cardId: alheia },
      ctx,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('FORBIDDEN_CARD');
  });

  it('CA-250: toda carta da mão é jogável', () => {
    let state = setup();
    while (state.round.phase === 'APOSTAS') {
      state = must(applyMove(state, legalMoves(state)[0]!, ctx));
    }
    const player = state.round.activePlayerId!;
    for (const cardId of state.hidden.hands[player]!) {
      const result = applyMove(
        state,
        { ...baseMove(state), type: 'playCard', cardId },
        ctx,
      );
      expect(result.ok).toBe(true);
    }
  });
});

// --- CA-290 a CA-293: auto-play --------------------------------------------

describe('CA-290 a CA-293: auto-play', () => {
  it('CA-290: aposta 0 por padrão', () => {
    const state = settle(
      createMatch({ matchId: 'm', seed: 'auto', playerIds: players(4) }),
    ).state;
    const move = autoMove(state);
    expect(move.type).toBe('bet');
    if (move.type === 'bet') expect(move.bet).toBe(0);
  });

  it('CA-291: aposta 1 quando 0 é o valor proibido', () => {
    // 3 jogadores, 1 carta. Se os dois primeiros apostam 0, o proibido é 1...
    // então forçamos soma 1 para tornar 0 proibido.
    let state = createMatch({ matchId: 'm', seed: 'auto2', playerIds: players(3) });
    state = settle(state).state;
    state = must(applyMove(state, { ...baseMove(state), type: 'bet', bet: 1 }, ctx));
    state = must(applyMove(state, { ...baseMove(state), type: 'bet', bet: 0 }, ctx));

    const move = autoMove(state); // soma 1, cartas 1 → proibido é 0
    if (move.type === 'bet') expect(move.bet).toBe(1);
  });

  it('CA-292/CA-293: joga a menor carta, desempatando pelo menor CardId', () => {
    let state = createMatch({ matchId: 'm', seed: 'auto3', playerIds: players(3) });
    state = settle({ ...state, cardsThisRound: 3 }).state;
    while (state.round.phase === 'APOSTAS') {
      state = must(applyMove(state, legalMoves(state)[0]!, ctx));
    }

    const player = state.round.activePlayerId!;
    const hand = state.hidden.hands[player]!.map((id) => state.hidden.cards[id]!);
    const menorValor = Math.min(...hand.map((c) => c.value));
    const esperado = hand
      .filter((c) => c.value === menorValor)
      .map((c) => c.id)
      .sort()[0]!;

    const move = autoMove(state);
    if (move.type === 'playCard') expect(move.cardId).toBe(esperado);
  });
});

// --- CA-263 a CA-267: morte, vitória e ranking -----------------------------

describe('CA-263 a CA-267: desempate por morte', () => {
  it('CA-261: morte é registrada na vaza em que vira inevitável', () => {
    let state = createMatch({
      matchId: 'm',
      seed: 'morte',
      playerIds: players(3),
      options: { vidasIniciais: 1, maxCartasPorRodada: 3 },
    });
    state = settle({ ...state, cardsThisRound: 3 }).state;

    // Todos apostam alto: quem não alcançar morre cedo.
    while (state.round.phase === 'APOSTAS') {
      const legal = legalMoves(state);
      state = must(applyMove(state, legal[legal.length - 1]!, ctx));
    }
    while (state.round.phase === 'VAZAS') {
      state = must(applyMove(state, legalMoves(state)[0]!, ctx));
    }

    const mortes = Object.values(state.round.mortoEmVaza).filter((v) => v !== null);
    expect(mortes.length).toBeGreaterThan(0);
    for (const vaza of mortes) {
      expect(vaza).toBeGreaterThanOrEqual(1);
      expect(vaza).toBeLessThanOrEqual(3);
    }
  });

  it('CA-266: numa rodada de testa todos morrem na vaza 1 e empatam', () => {
    // 2 jogadores com 1 vida numa rodada de 1 carta. A vitória compartilhada só
    // é alcançável quando ambos apostam 1 e a vaza empata: aí os dois erram por
    // 1, morrem na mesma vaza e RJ-010 dá a vitória aos dois. Apostar sempre o
    // mínimo nunca chega nesse ramo — daí a política de aposta máxima.
    let encontrouEmpate = false;
    for (let i = 0; i < 300 && !encontrouEmpate; i++) {
      const result = playMatch(`testa-${i}`, 2, { vidasIniciais: 1, maxCartasPorRodada: 1 },
        (_, legal) => legal[legal.length - 1]!);
      if ((result.state.winnerIds ?? []).length > 1) {
        encontrouEmpate = true;
        for (const winner of result.state.winnerIds!) {
          const record = result.state.eliminated.find((e) => e.playerId === winner)!;
          expect(record.mortoEmVaza).toBe(1);
        }
      }
      expect(result.violations).toEqual([]);
    }
    expect(encontrouEmpate).toBe(true);
  });

  it('CA-265/CA-272: toda partida termina com vencedor e mortes registradas', () => {
    for (let i = 0; i < 30; i++) {
      const { state, violations } = playMatch(`fim-${i}`, 4, {}, (_, l) => l[0]!);
      expect(violations).toEqual([]);
      expect(state.endReason).not.toBeNull();
      expect(state.winnerIds!.length).toBeGreaterThan(0);
      for (const record of state.eliminated) {
        expect(record.mortoEmVaza).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it('CA-267: ranking coloca retirados abaixo de todos os eliminados', () => {
    let state = createMatch({ matchId: 'm', seed: 'rank', playerIds: players(4) });
    state = settle(state).state;
    const vitima = state.playerOrder[0]!;
    const result = withdrawPlayers(state, [vitima], ctx);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const finalState = playFrom(result.state);
    const ordem = ranking(finalState);
    expect(ordem[ordem.length - 1]).toBe(vitima);
  });
});

function playFrom(start: MatchState): MatchState {
  let state = start;
  let steps = 0;
  while (state.endReason === null) {
    if (++steps > 20_000) throw new Error('não terminou');
    state = settle(state).state;
    if (state.endReason !== null) break;
    state = must(applyMove(state, legalMoves(state)[0]!, ctx));
  }
  return state;
}

// --- CA-296 / CA-297: retirada por ausência --------------------------------

describe('CA-296/CA-297: retirada', () => {
  it('CA-296: aborta a rodada sem debitar vida e sem registrar morte', () => {
    let state = createMatch({ matchId: 'm', seed: 'ret', playerIds: players(4) });
    state = settle({ ...state, cardsThisRound: 3 }).state;
    while (state.round.phase === 'APOSTAS') {
      state = must(applyMove(state, legalMoves(state)[0]!, ctx));
    }
    state = must(applyMove(state, legalMoves(state)[0]!, ctx));

    const vidasAntes = { ...state.lives };
    const vitima = state.playerOrder[1]!;
    const result = withdrawPlayers(state, [vitima], ctx);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const after = result.state;
    expect(after.roundNumber).toBe(state.roundNumber); // mesmo roundNumber
    expect(after.round.phase).toBe('DISTRIBUICAO'); // redistribuída
    expect(after.withdrawn.map((w) => w.playerId)).toContain(vitima);
    expect(after.eliminated.map((e) => e.playerId)).not.toContain(vitima); // INV-17
    expect(after.history.at(-1)!.aborted).toBe(true);
    for (const id of state.playerOrder) expect(after.lives[id]).toBe(vidasAntes[id]);
    expect(isActive(after, vitima)).toBe(false);
  });

  it('CA-053: deckCount é recalculado para o novo número de jogadores', () => {
    let state = createMatch({
      matchId: 'm',
      seed: 'decks',
      playerIds: players(8),
      options: { maxCartasPorRodada: 7 },
    });
    state = settle({ ...state, cardsThisRound: 7 }).state;
    expect(state.deckCount).toBe(2);

    const result = withdrawPlayers(state, [state.playerOrder[0]!], ctx);
    if (!result.ok) throw new Error('falhou');
    // 7 jogadores × 7 cartas = 49 → volta a caber em 1 baralho.
    expect(result.state.deckCount).toBe(1);
  });

  it('partida encerrada não deixa jogador da vez apontando para quem saiu', () => {
    // Regressão: a retirada que encerra a partida mantinha `activePlayerId`
    // no jogador retirado, violando INV-08 e fazendo a UI pedir jogada a um
    // fantasma. Encontrado pelo teste de propriedade da sala (CA-311).
    let state = createMatch({ matchId: 'm', seed: 'fantasma', playerIds: players(3) });
    state = settle({ ...state, cardsThisRound: 3 }).state;
    while (state.round.phase === 'APOSTAS') {
      state = must(applyMove(state, legalMoves(state)[0]!, ctx));
    }
    const daVez = state.round.activePlayerId!;
    expect(daVez).not.toBeNull();

    // Retira todos menos um: a partida encerra na hora.
    const outros = state.playerOrder.filter((id) => id !== state.playerOrder[0]!);
    const result = withdrawPlayers(state, outros, ctx);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.state.endReason).toBe('VITORIA_POR_ABANDONO');
    expect(result.state.round.activePlayerId).toBeNull();
    expect(checkInvariants(result.state)).toEqual([]);
  });

  it('CA-297/CA-055: sobrando 1, encerra com VITORIA_POR_ABANDONO', () => {
    let state = createMatch({ matchId: 'm', seed: 'aband', playerIds: players(3) });
    state = settle(state).state;
    const result = withdrawPlayers(state, state.playerOrder.slice(0, 2), ctx);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.endReason).toBe('VITORIA_POR_ABANDONO');
    expect(result.state.winnerIds).toEqual([state.playerOrder[2]!]);
  });
});

// --- CA-346: a pausa de fim de vaza ----------------------------------------

describe('CA-346: RECOLHIMENTO — a vaza fica na mesa antes de recolher', () => {
  /** Mesa de 3, rodada de 2 cartas, com as apostas feitas e a 1ª vaza jogada. */
  function primeiraVazaFechada(): MatchState {
    let state = settle(createMatch({
      matchId: 'm', seed: 'recolhe', playerIds: players(3),
      options: { maxCartasPorRodada: 2, vidasIniciais: 5 },
    })).state;

    // Rodada 1 é de testa; passa por ela para chegar numa de 2 cartas.
    while (state.cardsThisRound === 1) {
      while (state.round.activePlayerId !== null) {
        state = must(applyMove(state, legalMoves(state)[0]!, ctx));
      }
      state = settle(state).state;
    }

    while (state.round.phase === 'APOSTAS') {
      state = must(applyMove(state, legalMoves(state)[0]!, ctx));
    }
    expect(state.round.phase).toBe('VAZAS');

    while (state.round.phase === 'VAZAS') {
      state = must(applyMove(state, legalMoves(state)[0]!, ctx));
    }
    return state;
  }

  it('fechada a vaza, a fase é RECOLHIMENTO e ninguém está na vez', () => {
    const state = primeiraVazaFechada();

    expect(state.round.phase).toBe('RECOLHIMENTO');
    expect(state.round.activePlayerId).toBeNull();
    // A mesa ainda mostra a vaza: é o ponto inteiro da pausa.
    expect(state.round.resolvedTricks).toHaveLength(1);
    expect(state.round.resolvedTricks[0]!.plays).toHaveLength(3);
  });

  it('a vaza fechada não fica em dois lugares — INV-03 continua valendo', () => {
    // O modo de falhar aqui seria deixar a vaza em `currentTrick` E em
    // `resolvedTricks` para o cliente ter onde ler: as cartas contariam duas
    // vezes e a conservação quebraria sem sintoma na tela.
    const state = primeiraVazaFechada();

    expect(state.round.currentTrick).toBeNull();
    expect(checkInvariants(state)).toEqual([]);
  });

  it('a vaza seguinte só abre quando o relógio avança a fase', () => {
    const antes = primeiraVazaFechada();
    expect(antes.round.trickNumber).toBe(1);

    const depois = must(advance(antes, ctx));

    expect(depois.round.phase).toBe('VAZAS');
    expect(depois.round.trickNumber).toBe(2);
    expect(depois.round.currentTrick?.plays).toEqual([]);
    // Quem puxa é quem a vaza fechada registrou, não um recálculo.
    expect(depois.round.activePlayerId).toBe(antes.round.resolvedTricks[0]!.nextLeaderId);
    expect(checkInvariants(depois)).toEqual([]);
  });

  it('nenhuma jogada é aceita durante a pausa', () => {
    const state = primeiraVazaFechada();
    const mao = Object.values(state.hidden.hands).find((m) => m.length > 0)!;

    const recusa = applyMove(state, {
      type: 'playCard', playerId: state.playerOrder[0]!,
      roundNumber: state.roundNumber, trickNumber: state.round.trickNumber,
      cardId: mao[0]!,
    }, ctx);

    expect(recusa.ok).toBe(false);
  });

  it('a última vaza da rodada também é recolhida, e só então vem a conta', () => {
    // Ela ia direto ao acerto de contas, e era a única vaza do jogo cujo
    // resultado ninguém via: a tela trocava no mesmo quadro em que a carta
    // vencedora aparecia.
    let state = primeiraVazaFechada();
    state = settle(state).state;
    while (state.round.phase === 'VAZAS') {
      state = must(applyMove(state, legalMoves(state)[0]!, ctx));
    }

    expect(state.round.phase).toBe('RECOLHIMENTO');
    expect(state.round.resolvedTricks).toHaveLength(2);

    // E o passo seguinte é a conta, não outra vaza.
    const depois = must(advance(state, ctx));
    expect(depois.round.phase).toBe('RESOLUCAO');
    expect(depois.round.currentTrick).toBeNull();
    expect(checkInvariants(depois)).toEqual([]);
  });

  it('a rodada de testa não tem pausa de vaza: a revelação já é a pausa', () => {
    let state = settle(createMatch({
      matchId: 'm', seed: 'testa', playerIds: players(3),
      options: { maxCartasPorRodada: 3, vidasIniciais: 5 },
    })).state;
    expect(state.cardsThisRound).toBe(1);

    while (state.round.activePlayerId !== null) {
      state = must(applyMove(state, legalMoves(state)[0]!, ctx));
    }

    expect(state.round.phase).not.toBe('RECOLHIMENTO');
  });
});

// --- CA-310: propriedade ---------------------------------------------------

describe('CA-310: teste de propriedade', () => {
  it('1.000 partidas aleatórias terminam sem violar invariante', () => {
    const tieRules = ['EMPATE_ANULA_VAZA', 'EMPATE_ANULA_CARTAS'] as const;
    let matches = 0;
    let annulled = 0;
    let sharedWins = 0;

    for (let i = 0; i < 1000; i++) {
      const seed = `prop-${i}`;
      // Um rng próprio para a política de jogo, para que o caso seja reproduzível.
      let cursor = 0;
      const nextIndex = (max: number): number => {
        cursor = (cursor * 1103515245 + 12345 + i) >>> 0;
        return cursor % max;
      };

      const playerCount = 2 + (i % 7);
      const options: Partial<MatchOptions> = {
        vidasIniciais: 1 + (i % 4),
        maxCartasPorRodada: 1 + (i % 10),
        regraEmpate: tieRules[i % 2]!,
      };

      let result;
      try {
        result = playMatch(seed, playerCount, options, (_, legal) =>
          legal[nextIndex(legal.length)]!,
        );
      } catch (error) {
        throw new Error(`seed ${seed} (${playerCount}j, ${JSON.stringify(options)}): ${String(error)}`);
      }

      if (result.violations.length > 0) {
        throw new Error(`seed ${seed} violou: ${result.violations.slice(0, 3).join('; ')}`);
      }

      expect(result.state.endReason).not.toBeNull();
      expect(result.state.winnerIds!.length).toBeGreaterThan(0);

      matches++;
      annulled += result.state.history.reduce((n, h) => n + h.annulledTricks, 0);
      if (result.state.winnerIds!.length > 1) sharedWins++;
    }

    expect(matches).toBe(1000);
    // O corpus precisa exercitar de fato os casos interessantes, senão o teste
    // passa sem provar nada.
    expect(annulled).toBeGreaterThan(0);
    expect(sharedWins).toBeGreaterThan(0);
  }, 120_000);
});


// --- CA-353 a CA-355: vitória matemática (RJ-014, RJ-015) -------------------

describe('CA-353 a CA-355: vitória matemática', () => {
  /**
   * O lema em que a regra inteira se apoia: o desvio mínimo garantido NUNCA
   * diminui quando uma vaza é jogada. É o que garante que morto não ressuscita
   * — e, portanto, que cortar a rodada não pode roubar de ninguém uma virada
   * que ainda existia. Se este teste cair, RJ-014 está errada, e não o código.
   */
  it('CA-353: desvio mínimo garantido nunca diminui ao longo da rodada', () => {
    for (let cartas = 1; cartas <= 10; cartas++) {
      for (let aposta = 0; aposta <= cartas; aposta++) {
        for (let ganhas = 0; ganhas <= cartas; ganhas++) {
          for (let restantes = 1; restantes <= cartas - ganhas; restantes++) {
            const antes = minGuaranteedDeviation(aposta, ganhas, restantes);
            // A vaza seguinte só tem dois desfechos para este jogador: leva ou
            // não leva. Nenhum dos dois pode baixar o piso.
            const levou = minGuaranteedDeviation(aposta, ganhas + 1, restantes - 1);
            const perdeu = minGuaranteedDeviation(aposta, ganhas, restantes - 1);
            expect(levou).toBeGreaterThanOrEqual(antes);
            expect(perdeu).toBeGreaterThanOrEqual(antes);
          }
        }
      }
    }
  });

  /**
   * RJ-015 tem de ser uma GENERALIZAÇÃO de RJ-002, não uma regra concorrente:
   * com a rodada jogada até a última carta, as duas fórmulas têm de dar o mesmo
   * número, senão a mudança altera silenciosamente o débito de toda partida
   * normal.
   */
  it('CA-354: com a rodada inteira jogada, RJ-015 coincide com RJ-002', () => {
    for (let aposta = 0; aposta <= 10; aposta++) {
      for (let ganhas = 0; ganhas <= 10; ganhas++) {
        expect(minGuaranteedDeviation(aposta, ganhas, 0)).toBe(Math.abs(aposta - ganhas));
      }
    }
  });

  it('CA-355: a rodada é cortada e o vencedor é o único não-morto', () => {
    const tieRules = ['EMPATE_ANULA_VAZA', 'EMPATE_ANULA_CARTAS'] as const;
    let cortadas = 0;
    let partidasCortadas = 0;

    for (let i = 0; i < 400; i++) {
      const seed = `antecipada-${i}`;
      let cursor = 0;
      const nextIndex = (max: number): number => {
        cursor = (cursor * 1103515245 + 12345 + i) >>> 0;
        return cursor % max;
      };

      const result = playMatch(
        seed,
        2 + (i % 7),
        {
          vidasIniciais: 1 + (i % 3),
          // Rodadas longas com poucas vidas é onde a decisão antecipada
          // acontece: sobra vaza para pular depois de todo mundo já ter caído.
          maxCartasPorRodada: 4 + (i % 7),
          regraEmpate: tieRules[i % 2]!,
        },
        (_, legal) => legal[nextIndex(legal.length)]!,
      );

      expect(result.violations).toEqual([]);

      const cortes = result.events.filter((e) => e.type === 'round:decidedEarly');
      if (cortes.length === 0) continue;
      partidasCortadas++;
      cortadas += cortes.length;

      for (const corte of cortes) {
        // Só se corta o que sobra — cortar zero vaza seria um corte inútil, e
        // cortar mais do que a rodada tinha seria contabilidade errada.
        expect(corte.skippedTricks).toBeGreaterThan(0);
      }

      // A rodada cortada deixa rastro no histórico: menos vazas disputadas do
      // que cartas distribuídas.
      const cortada = result.state.history.filter((h) => {
        const feitas = Object.values(h.tricksWon).reduce((a, b) => a + b, 0);
        return !h.aborted && feitas + h.annulledTricks < h.cardsThisRound;
      });
      expect(cortada.length).toBe(cortes.length);

      // RJ-011/INV-16: quem foi eliminado numa rodada cortada morreu de fato —
      // aqui não existe o `?? cardsThisRound` de recurso, todo eliminado tem
      // sua vaza de morte gravada.
      for (const h of cortada) {
        for (const id of h.eliminatedThisRound) {
          expect(h.mortoEmVaza[id]).not.toBeNull();
          expect(h.mortoEmVaza[id]).toBeGreaterThan(0);
        }
      }

      // E o essencial: a partida acabou com vencedor, e ele não é alguém que a
      // rodada cortada eliminou.
      expect(result.state.endReason).not.toBeNull();
      const vencedores = result.state.winnerIds!;
      expect(vencedores.length).toBeGreaterThan(0);
      const ultima = cortada[cortada.length - 1];
      if (ultima && result.state.history[result.state.history.length - 1] === ultima) {
        for (const v of vencedores) {
          // Vencer por RJ-004 (sobreviveu) ou por RJ-010 (morreu por último).
          const morreuNaUltima = ultima.eliminatedThisRound.includes(v);
          if (morreuNaUltima) {
            const meu = ultima.mortoEmVaza[v] ?? 0;
            for (const outro of ultima.eliminatedThisRound) {
              expect(meu).toBeGreaterThanOrEqual(ultima.mortoEmVaza[outro] ?? 0);
            }
          } else {
            expect(isActive(result.state, v)).toBe(true);
          }
        }
      }
    }

    // Sem isto o teste passaria feliz num corpus que nunca dispara a regra.
    expect(partidasCortadas).toBeGreaterThan(0);
    expect(cortadas).toBeGreaterThan(0);
  }, 120_000);
});

// --- CA-360: a classificação é a ordem de vitória (RJ-012, RJ-129) ---------

describe('CA-360: classificação em ordem de vitória', () => {
  /**
   * A tela de fim ordenava por vidas restantes. Como todo eliminado termina em
   * ZERO vida, a comparação empatava sempre e a ordem entre eles caía no
   * `playerOrder` — o primeiro a cair podia aparecer em segundo lugar, com
   * medalha de prata. Um teste sobre vidas nunca pegaria isso; este ordena
   * gente que tem exatamente as mesmas vidas.
   */
  it('entre eliminados, quem caiu por último fica na frente', () => {
    const ordem = ranking({
      winnerIds: ['ana'],
      playerOrder: ['ana', 'beto', 'caio', 'dani'],
      // De propósito fora de ordem, e de propósito com `playerOrder` sugerindo
      // o contrário do certo.
      eliminated: [
        { playerId: 'beto', roundNumber: 2, mortoEmVaza: 1 },
        { playerId: 'dani', roundNumber: 5, mortoEmVaza: 3 },
        { playerId: 'caio', roundNumber: 5, mortoEmVaza: 1 },
      ],
      withdrawn: [],
    });

    expect(ordem).toEqual(['ana', 'dani', 'caio', 'beto']);
  });

  it('quem abandonou fica abaixo de todos, mesmo caindo tarde (RJ-129)', () => {
    const ordem = ranking({
      winnerIds: ['ana'],
      playerOrder: ['ana', 'beto', 'caio'],
      eliminated: [{ playerId: 'beto', roundNumber: 2, mortoEmVaza: 1 }],
      // Saiu na rodada 9, muito depois de Beto cair — e ainda assim vem
      // depois: sair não pode ser um jeito de terminar melhor.
      withdrawn: [{ playerId: 'caio', roundNumber: 9, livesAtWithdrawal: 4 }],
    });

    expect(ordem).toEqual(['ana', 'beto', 'caio']);
  });

  it('vitória compartilhada (RJ-010) põe os dois na frente', () => {
    const ordem = ranking({
      winnerIds: ['ana', 'beto'],
      playerOrder: ['ana', 'beto', 'caio'],
      eliminated: [
        { playerId: 'ana', roundNumber: 4, mortoEmVaza: 7 },
        { playerId: 'beto', roundNumber: 4, mortoEmVaza: 7 },
        { playerId: 'caio', roundNumber: 4, mortoEmVaza: 2 },
      ],
      withdrawn: [],
    });

    expect(ordem.slice(0, 2).sort()).toEqual(['ana', 'beto']);
    expect(ordem[2]).toBe('caio');
  });

  /** Numa partida de verdade: a classificação é o inverso da ordem de queda. */
  it('em partida completa, a ordem é o inverso exato da ordem de eliminação', () => {
    let cursor = 0;
    const result = playMatch(
      'ordem-vitoria',
      6,
      { vidasIniciais: 2, maxCartasPorRodada: 5 },
      (_, legal) => {
        cursor = (cursor * 1103515245 + 12345) >>> 0;
        return legal[cursor % legal.length]!;
      },
    );

    const ordem = ranking(result.state);
    expect(ordem.length).toBe(6);
    // Ninguém aparece duas vezes nem some da tabela.
    expect(new Set(ordem).size).toBe(6);

    const vencedores = result.state.winnerIds!;
    for (const v of vencedores) expect(ordem.indexOf(v)).toBeLessThan(vencedores.length);

    // Para cada par de eliminados, quem caiu depois está mais acima.
    const caiu = new Map(
      result.state.eliminated
        .filter((e) => !vencedores.includes(e.playerId))
        .map((e) => [e.playerId, e]),
    );
    for (const [a, ea] of caiu) {
      for (const [b, eb] of caiu) {
        if (a === b) continue;
        const depois =
          ea.roundNumber !== eb.roundNumber
            ? ea.roundNumber > eb.roundNumber
            : ea.mortoEmVaza > eb.mortoEmVaza;
        if (depois) expect(ordem.indexOf(a)).toBeLessThan(ordem.indexOf(b));
      }
    }
  });
});
