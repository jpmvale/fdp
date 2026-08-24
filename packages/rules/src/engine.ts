/**
 * Motor de regras do FDP — função pura e determinística (`02` §4).
 *
 * Sem rede, sem I/O, sem framework (RJ-143). Sem `Date.now()` nem
 * `Math.random()` (RJ-140): tempo e aleatoriedade entram por parâmetro.
 */

import { buildShoe, cardCatalog, deckCountFor } from './deck.js';
import { createRng } from './rng.js';
import {
  forbiddenBetFor,
  nextCardsThisRound,
  nextFirstBidder,
  orderFrom,
} from './round.js';
import { isDoomed, nextLeaderOf, resolveTrick } from './trick.js';
import {
  type EngineCtx,
  type EngineEvent,
  type MatchOptions,
  type MatchState,
  type Move,
  type MoveFailure,
  type MoveResult,
  type PlayerId,
  type RoundState,
  type RoundSummary,
  type Trick,
  DEFAULT_OPTIONS,
} from './types.js';

const fail = (
  code: MoveFailure['code'],
  motivo: MoveFailure['motivo'],
): MoveFailure => ({ ok: false, code, motivo });

/** Jogador ainda na partida: nem eliminado, nem retirado. */
export function isActive(state: MatchState, playerId: PlayerId): boolean {
  return (
    !state.eliminated.some((e) => e.playerId === playerId) &&
    !state.withdrawn.some((w) => w.playerId === playerId)
  );
}

export function activePlayers(state: MatchState): PlayerId[] {
  return state.playerOrder.filter((id) => isActive(state, id));
}

/** Semente derivada, para que cada rodada embaralhe diferente do mesmo seed. */
function roundRng(state: MatchState): ReturnType<typeof createRng> {
  return createRng(`${state.seed}:r${state.roundNumber}`);
}

// ---------------------------------------------------------------------------
// Criação da partida
// ---------------------------------------------------------------------------

export interface CreateMatchParams {
  matchId: string;
  seed: string;
  /** Jogadores da sala; a ordem da mesa é sorteada a partir daqui (RJ-030). */
  playerIds: readonly PlayerId[];
  options?: Partial<MatchOptions>;
}

export function createMatch(params: CreateMatchParams): MatchState {
  const options: MatchOptions = { ...DEFAULT_OPTIONS, ...params.options };
  validateOptions(options, params.playerIds.length);

  const setupRng = createRng(`${params.seed}:setup`);

  // RJ-030: ordem da mesa sorteada e fixa. RJ-031: primeiro apostador sorteado.
  const playerOrder = shufflePlayers(params.playerIds, setupRng);
  const firstBidderId = playerOrder[setupRng.nextInt(playerOrder.length)]!;

  const lives: Record<PlayerId, number> = {};
  for (const id of playerOrder) lives[id] = options.vidasIniciais;

  const state: MatchState = {
    id: params.matchId,
    seed: params.seed,
    options,
    playerOrder,
    lives,
    eliminated: [],
    withdrawn: [],
    roundNumber: 1,
    cardsThisRound: 1, // RJ-033
    deckCount: deckCountFor(playerOrder.length, 1),
    firstBidderId,
    round: emptyRound(),
    hidden: { stock: [], hands: {}, cards: {} },
    history: [],
    winnerIds: null,
    endReason: null,
  };

  return state;
}

function shufflePlayers(
  players: readonly PlayerId[],
  rng: ReturnType<typeof createRng>,
): PlayerId[] {
  const out = players.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = rng.nextInt(i + 1);
    const a = out[i]!;
    const b = out[j]!;
    out[i] = b;
    out[j] = a;
  }
  return out;
}

function validateOptions(options: MatchOptions, playerCount: number): void {
  if (playerCount < 2 || playerCount > 8) {
    throw new RangeError(`FDP admite 2 a 8 jogadores, recebeu ${playerCount}`);
  }
  if (options.vidasIniciais < 1 || options.vidasIniciais > 10) {
    throw new RangeError('vidasIniciais deve estar em [1, 10]');
  }
  if (options.maxCartasPorRodada < 1 || options.maxCartasPorRodada > 10) {
    throw new RangeError('maxCartasPorRodada deve estar em [1, 10]');
  }
}

function emptyRound(): RoundState {
  return {
    phase: 'DISTRIBUICAO',
    activePlayerId: null,
    isForeheadRound: true,
    bets: {},
    bidOrder: [],
    forbiddenBet: null,
    tricksWon: {},
    mortoEmVaza: {},
    trickNumber: 0,
    currentTrick: null,
    resolvedTricks: [],
  };
}

// ---------------------------------------------------------------------------
// Fases automáticas (`03` §4.2)
// ---------------------------------------------------------------------------

/**
 * Avança as fases que não dependem de comando: DISTRIBUICAO, REVELACAO e
 * RESOLUCAO. Devolve o estado inalterado se a fase corrente exige jogada.
 *
 * O servidor chama isto ao cumprir as pausas de legibilidade; os testes chamam
 * em laço. Modelar assim mantém as pausas fora do motor, mas as fases visíveis.
 */
export function advance(state: MatchState, ctx: EngineCtx): MoveResult {
  if (state.endReason !== null) return fail('WRONG_STATUS', 'MATCH_ENCERRADA');

  switch (state.round.phase) {
    case 'DISTRIBUICAO':
      return deal(state);
    case 'REVELACAO':
      return reveal(state);
    case 'RESOLUCAO':
      return resolveRound(state);
    default:
      return fail('WRONG_STATUS', 'FASE_ERRADA');
  }
}

/** RJ-040, RJ-041, RJ-042. */
function deal(state: MatchState): MoveResult {
  const players = activePlayers(state);
  const cardsThisRound = state.cardsThisRound;
  const deckCount = deckCountFor(players.length, cardsThisRound);

  const rng = roundRng(state);
  const shoe = buildShoe(deckCount, rng);

  // RJ-043: por construção de RJ-024 o sabot sempre basta.
  const needed = players.length * cardsThisRound;
  if (shoe.length < needed) {
    throw new Error(
      `sabot insuficiente: ${shoe.length} cartas para ${needed} necessárias`,
    );
  }

  const bidOrder = orderFrom(state.playerOrder, state.firstBidderId, (id) =>
    players.includes(id),
  );

  // RJ-041: uma carta por vez, na ordem da mesa, a partir do primeiro apostador.
  const hands: Record<PlayerId, string[]> = {};
  for (const id of bidOrder) hands[id] = [];
  let cursor = 0;
  for (let round = 0; round < cardsThisRound; round++) {
    for (const id of bidOrder) {
      hands[id]!.push(shoe[cursor++]!.id);
    }
  }

  const tricksWon: Record<PlayerId, number> = {};
  const mortoEmVaza: Record<PlayerId, number | null> = {};
  for (const id of bidOrder) {
    tricksWon[id] = 0;
    mortoEmVaza[id] = null; // RJ-096: reiniciado a cada rodada
  }

  const isForeheadRound = cardsThisRound === 1;

  const next: MatchState = {
    ...state,
    deckCount,
    hidden: {
      stock: shoe.slice(cursor).map((c) => c.id),
      hands,
      cards: cardCatalog(shoe),
    },
    round: {
      phase: 'APOSTAS',
      activePlayerId: bidOrder[0]!,
      isForeheadRound,
      bets: {},
      bidOrder,
      forbiddenBet: bidOrder.length === 1 ? forbiddenBetFor(cardsThisRound, []) : null,
      tricksWon,
      mortoEmVaza,
      trickNumber: 0,
      currentTrick: null,
      resolvedTricks: [],
    },
  };

  return {
    ok: true,
    state: next,
    events: [
      {
        type: 'round:started',
        roundNumber: next.roundNumber,
        cardsThisRound,
        deckCount,
        isForeheadRound,
        firstBidderId: next.firstBidderId,
      },
      { type: 'round:phaseChanged', phase: 'APOSTAS', activePlayerId: bidOrder[0]! },
    ],
  };
}

/** RJ-073: rodada de testa — cartas reveladas e vaza única resolvida. */
function reveal(state: MatchState): MoveResult {
  const { bidOrder } = state.round;

  // RJ-074: a ordem de jogada da vaza única é a ordem de aposta.
  const plays = bidOrder.map((playerId) => ({
    playerId,
    cardId: state.hidden.hands[playerId]![0]!,
  }));

  const trick: Trick = {
    leaderId: bidOrder[0]!,
    playOrder: bidOrder.slice(),
    plays,
    winnerId: null,
    annulledValue: null,
    nextLeaderId: null,
  };

  const revealed: Record<PlayerId, string> = {};
  for (const play of plays) revealed[play.playerId] = play.cardId;

  // A carta sai da testa e vai para a mesa. Sem isso ela seria contada duas
  // vezes — em `hands` e em `plays` — quebrando INV-03 e INV-04.
  const emptiedHands: Record<PlayerId, string[]> = {};
  for (const playerId of bidOrder) emptiedHands[playerId] = [];

  const onTable: MatchState = {
    ...state,
    hidden: { ...state.hidden, hands: emptiedHands },
    round: { ...state.round, trickNumber: 1 },
  };

  const settled = settleTrick(onTable, trick);

  return {
    ok: true,
    state: { ...settled.state, round: { ...settled.state.round, phase: 'RESOLUCAO' } },
    events: [
      { type: 'round:revealed', cards: revealed },
      ...settled.events,
      { type: 'round:phaseChanged', phase: 'RESOLUCAO', activePlayerId: null },
    ],
  };
}

// ---------------------------------------------------------------------------
// Jogadas
// ---------------------------------------------------------------------------

export function applyMove(
  state: MatchState,
  move: Move,
  ctx: EngineCtx,
): MoveResult {
  if (state.endReason !== null) return fail('WRONG_STATUS', 'MATCH_ENCERRADA');

  // Ordem de validação espelha `05` §4.2: frescor → fase → vez → schema →
  // posse → regra. Posse antes de regra para que tentativa de trapaça nunca
  // apareça mascarada como erro de regra.
  if (move.roundNumber !== state.roundNumber) {
    return fail('STALE_MOVE', 'RODADA_OU_VAZA_ANTIGA');
  }
  if (move.trickNumber !== state.round.trickNumber) {
    return fail('STALE_MOVE', 'RODADA_OU_VAZA_ANTIGA');
  }
  if (!isActive(state, move.playerId)) {
    return fail('WRONG_STATUS', 'JOGADOR_INATIVO');
  }

  if (move.type === 'bet') {
    if (state.round.phase !== 'APOSTAS') return fail('WRONG_STATUS', 'FASE_ERRADA');
    if (state.round.activePlayerId !== move.playerId) {
      return fail('NOT_YOUR_TURN', 'NAO_E_SUA_VEZ');
    }
    return applyBet(state, move.playerId, move.bet);
  }

  if (state.round.phase !== 'VAZAS') return fail('WRONG_STATUS', 'FASE_ERRADA');
  if (state.round.activePlayerId !== move.playerId) {
    return fail('NOT_YOUR_TURN', 'NAO_E_SUA_VEZ');
  }
  return applyPlayCard(state, move.playerId, move.cardId);
}

function applyBet(state: MatchState, playerId: PlayerId, bet: number): MoveResult {
  const { round, cardsThisRound } = state;

  if (!Number.isInteger(bet) || bet < 0 || bet > cardsThisRound) {
    return fail('VALIDATION_FAILED', 'APOSTA_FORA_DO_INTERVALO');
  }

  const placed = round.bidOrder.filter((id) => round.bets[id] !== undefined);
  const isLastBidder = placed.length === round.bidOrder.length - 1;

  if (isLastBidder) {
    const forbidden = forbiddenBetFor(
      cardsThisRound,
      placed.map((id) => round.bets[id]!),
    );
    if (forbidden !== null && bet === forbidden) {
      return fail('ILLEGAL_MOVE', 'SOMA_PROIBIDA'); // RJ-056
    }
  }

  const bets = { ...round.bets, [playerId]: bet };
  const remaining = round.bidOrder.filter((id) => bets[id] === undefined);
  const events: EngineEvent[] = [
    { type: 'move:betPlaced', playerId, bet, forbiddenBet: round.forbiddenBet },
  ];

  if (remaining.length > 0) {
    const nextBidder = remaining[0]!;
    const stillToPlace = remaining.length;
    // Só o último apostador carrega a restrição (RJ-054).
    const nextForbidden =
      stillToPlace === 1
        ? forbiddenBetFor(
            cardsThisRound,
            round.bidOrder.filter((id) => bets[id] !== undefined).map((id) => bets[id]!),
          )
        : null;

    events.push({
      type: 'round:phaseChanged',
      phase: 'APOSTAS',
      activePlayerId: nextBidder,
    });

    return {
      ok: true,
      state: {
        ...state,
        round: { ...round, bets, activePlayerId: nextBidder, forbiddenBet: nextForbidden },
      },
      events,
    };
  }

  // Apostas encerradas.
  if (round.isForeheadRound) {
    events.push({ type: 'round:phaseChanged', phase: 'REVELACAO', activePlayerId: null });
    return {
      ok: true,
      state: {
        ...state,
        round: { ...round, bets, activePlayerId: null, forbiddenBet: null, phase: 'REVELACAO' },
      },
      events,
    };
  }

  // RJ-061: a primeira vaza é puxada pelo primeiro apostador.
  const leaderId = round.bidOrder[0]!;
  const firstTrick = openTrick(state, leaderId);
  events.push({ type: 'round:phaseChanged', phase: 'VAZAS', activePlayerId: leaderId });

  return {
    ok: true,
    state: {
      ...state,
      round: {
        ...round,
        bets,
        forbiddenBet: null,
        phase: 'VAZAS',
        trickNumber: 1,
        currentTrick: firstTrick,
        activePlayerId: leaderId,
      },
    },
    events,
  };
}

function openTrick(state: MatchState, leaderId: PlayerId): Trick {
  const playOrder = orderFrom(state.playerOrder, leaderId, (id) =>
    state.round.bidOrder.includes(id),
  );
  return {
    leaderId,
    playOrder,
    plays: [],
    winnerId: null,
    annulledValue: null,
    nextLeaderId: null,
  };
}

function applyPlayCard(
  state: MatchState,
  playerId: PlayerId,
  cardId: string,
): MoveResult {
  const hand = state.hidden.hands[playerId] ?? [];
  if (!hand.includes(cardId)) {
    return fail('FORBIDDEN_CARD', 'CARTA_NAO_ESTA_NA_MAO');
  }

  // RJ-023/RJ-063: qualquer carta da mão é legal. Não há mais o que validar.
  const trick = state.round.currentTrick!;
  const plays = [...trick.plays, { playerId, cardId }];
  const hands = {
    ...state.hidden.hands,
    [playerId]: hand.filter((id) => id !== cardId),
  };

  const events: EngineEvent[] = [
    { type: 'move:cardPlayed', playerId, cardId, trickNumber: state.round.trickNumber },
  ];

  const withPlay: MatchState = {
    ...state,
    hidden: { ...state.hidden, hands },
    round: { ...state.round, currentTrick: { ...trick, plays } },
  };

  if (plays.length < trick.playOrder.length) {
    const nextPlayer = trick.playOrder[plays.length]!;
    return {
      ok: true,
      state: { ...withPlay, round: { ...withPlay.round, activePlayerId: nextPlayer } },
      events,
    };
  }

  const settled = settleTrick(withPlay, { ...trick, plays });
  return { ok: true, state: settled.state, events: [...events, ...settled.events] };
}

/**
 * Fecha a vaza: resolve o vencedor, credita, define o próximo puxador e
 * **grava as mortes** (RJ-095). O passo das mortes é o mais fácil de esquecer:
 * não tem sintoma visível até uma partida terminar com todos zerados.
 */
function settleTrick(
  state: MatchState,
  trick: Trick,
): { state: MatchState; events: EngineEvent[] } {
  const { round } = state;
  const resolution = resolveTrick(trick.plays, state.hidden.cards, state.options.regraEmpate);
  const nextLeaderId = nextLeaderOf(trick.plays, state.hidden.cards, resolution);

  const resolved: Trick = {
    ...trick,
    winnerId: resolution.winnerId,
    annulledValue: resolution.annulledValue,
    nextLeaderId,
  };

  const tricksWon = { ...round.tricksWon };
  if (resolution.winnerId !== null) {
    tricksWon[resolution.winnerId] = (tricksWon[resolution.winnerId] ?? 0) + 1;
  }

  const trickNumber = round.isForeheadRound ? 1 : round.trickNumber;
  const tricksRemaining = state.cardsThisRound - trickNumber;

  // RJ-095: recalcula o desvio mínimo garantido de todos e grava mortes.
  const mortoEmVaza = { ...round.mortoEmVaza };
  const events: EngineEvent[] = [
    {
      type: 'trick:resolved',
      trickNumber,
      winnerId: resolution.winnerId,
      annulledValue: resolution.annulledValue,
      nextLeaderId,
    },
  ];

  for (const playerId of round.bidOrder) {
    if (mortoEmVaza[playerId] != null) continue;
    const doomed = isDoomed(
      round.bets[playerId]!,
      tricksWon[playerId] ?? 0,
      tricksRemaining,
      state.lives[playerId]!,
    );
    if (doomed) {
      mortoEmVaza[playerId] = trickNumber;
      events.push({ type: 'player:doomed', playerId, trickNumber });
    }
  }

  const resolvedTricks = [...round.resolvedTricks, resolved];
  const isLastTrick = trickNumber >= state.cardsThisRound;

  if (isLastTrick) {
    return {
      state: {
        ...state,
        round: {
          ...round,
          tricksWon,
          mortoEmVaza,
          currentTrick: null,
          resolvedTricks,
          activePlayerId: null,
          phase: round.isForeheadRound ? round.phase : 'RESOLUCAO',
        },
      },
      events: round.isForeheadRound
        ? events
        : [...events, { type: 'round:phaseChanged', phase: 'RESOLUCAO', activePlayerId: null }],
    };
  }

  // RJ-065: o puxador seguinte abre a próxima vaza.
  const nextTrick = openTrick(state, nextLeaderId);
  return {
    state: {
      ...state,
      round: {
        ...round,
        tricksWon,
        mortoEmVaza,
        resolvedTricks,
        trickNumber: trickNumber + 1,
        currentTrick: nextTrick,
        activePlayerId: nextLeaderId,
      },
    },
    events,
  };
}

// ---------------------------------------------------------------------------
// Resolução da rodada
// ---------------------------------------------------------------------------

/** RJ-090 a RJ-094, depois RJ-004/RJ-005. */
function resolveRound(state: MatchState): MoveResult {
  const { round } = state;
  const livesLost: Record<PlayerId, number> = {};
  const lives = { ...state.lives };

  // RJ-093: debita todo mundo antes de eliminar ninguém.
  for (const playerId of round.bidOrder) {
    const lost = Math.abs(round.bets[playerId]! - (round.tricksWon[playerId] ?? 0));
    livesLost[playerId] = lost;
    lives[playerId] = Math.max(0, lives[playerId]! - lost); // RJ-092
  }

  const eliminatedThisRound = round.bidOrder.filter((id) => lives[id] === 0);
  const eliminated = [...state.eliminated];
  for (const playerId of eliminatedThisRound) {
    eliminated.push({
      playerId,
      roundNumber: state.roundNumber,
      // RJ-011: todo eliminado tem morte registrada. Se faltar, é bug de RJ-095.
      mortoEmVaza: round.mortoEmVaza[playerId] ?? state.cardsThisRound,
    });
  }

  const summary: RoundSummary = {
    roundNumber: state.roundNumber,
    cardsThisRound: state.cardsThisRound,
    deckCount: state.deckCount,
    aborted: false,
    bets: { ...round.bets },
    tricksWon: { ...round.tricksWon },
    livesLost,
    mortoEmVaza: { ...round.mortoEmVaza },
    eliminatedThisRound,
    annulledTricks: round.resolvedTricks.filter((t) => t.winnerId === null).length,
  };

  const afterState: MatchState = {
    ...state,
    lives,
    eliminated,
    history: [...state.history, summary],
  };

  const events: EngineEvent[] = [{ type: 'round:resolved', summary }];
  const survivors = activePlayers(afterState);

  // RJ-004
  if (survivors.length === 1) {
    return finish(afterState, [survivors[0]!], 'VITORIA', events);
  }

  // RJ-005 + RJ-010: todos caíram juntos — vence quem segurou a última vida
  // por mais tempo; empate na mesma vaza dá vitória compartilhada.
  if (survivors.length === 0) {
    const contenders = eliminatedThisRound.map((playerId) => ({
      playerId,
      mortoEmVaza: round.mortoEmVaza[playerId] ?? state.cardsThisRound,
    }));
    const latest = Math.max(...contenders.map((c) => c.mortoEmVaza));
    const winners = contenders.filter((c) => c.mortoEmVaza === latest).map((c) => c.playerId);
    return finish(afterState, winners, 'VITORIA', events);
  }

  return { ok: true, state: startNextRound(afterState), events };
}

function startNextRound(state: MatchState): MatchState {
  const survivors = activePlayers(state);
  const cardsThisRound = nextCardsThisRound(
    state.cardsThisRound,
    state.options.maxCartasPorRodada,
  );

  return {
    ...state,
    roundNumber: state.roundNumber + 1,
    cardsThisRound,
    deckCount: deckCountFor(survivors.length, cardsThisRound),
    firstBidderId: nextFirstBidder(state.playerOrder, state.firstBidderId, (id) =>
      survivors.includes(id),
    ),
    round: emptyRound(),
    hidden: { stock: [], hands: {}, cards: {} },
  };
}

function finish(
  state: MatchState,
  winnerIds: PlayerId[],
  endReason: MatchState['endReason'],
  events: EngineEvent[],
): MoveResult {
  return {
    ok: true,
    // Partida encerrada não tem jogador da vez. Sem esta limpeza, um
    // encerramento por retirada deixa `activePlayerId` apontando para quem
    // acabou de sair — estado inconsistente que viola INV-08 e faria a UI
    // pedir jogada a um fantasma.
    state: { ...state, round: { ...state.round, activePlayerId: null }, winnerIds, endReason },
    events: [...events, { type: 'match:ended', winnerIds, endReason: endReason! }],
  };
}

// ---------------------------------------------------------------------------
// Retirada por ausência (`02` §3.8.3)
// ---------------------------------------------------------------------------

/**
 * RJ-154/RJ-155: o host escolheu continuar sem os ausentes.
 *
 * Os retirados perdem cartas e vidas, e a rodada corrente é **abortada e
 * redistribuída** mantendo `roundNumber` — ninguém perde vida por ela, e o
 * retirado não ganha `mortoEmVaza`. Retirada não é eliminação (INV-17).
 */
export function withdrawPlayers(
  state: MatchState,
  playerIds: readonly PlayerId[],
  ctx: EngineCtx,
): MoveResult {
  if (state.endReason !== null) return fail('WRONG_STATUS', 'MATCH_ENCERRADA');

  const targets = playerIds.filter((id) => isActive(state, id));
  if (targets.length === 0) return fail('VALIDATION_FAILED', 'JOGADOR_INATIVO');

  const withdrawn = [...state.withdrawn];
  for (const playerId of targets) {
    withdrawn.push({
      playerId,
      roundNumber: state.roundNumber,
      livesAtWithdrawal: state.lives[playerId]!,
    });
  }

  const aborted: RoundSummary = {
    roundNumber: state.roundNumber,
    cardsThisRound: state.cardsThisRound,
    deckCount: state.deckCount,
    aborted: true,
    bets: { ...state.round.bets },
    tricksWon: { ...state.round.tricksWon },
    livesLost: {},
    mortoEmVaza: {},
    eliminatedThisRound: [],
    annulledTricks: 0,
  };

  const base: MatchState = {
    ...state,
    withdrawn,
    history: [...state.history, aborted],
  };

  const events: EngineEvent[] = [
    { type: 'round:aborted', roundNumber: state.roundNumber, withdrawnPlayerIds: [...targets] },
  ];

  const survivors = activePlayers(base);

  // RJ-156
  if (survivors.length === 1) {
    return finish(base, [survivors[0]!], 'VITORIA_POR_ABANDONO', events);
  }
  if (survivors.length === 0) {
    return finish(base, [], 'JOGADORES_INSUFICIENTES', events);
  }

  // Se o primeiro apostador saiu, a âncora de RJ-039 resolve sozinha.
  const firstBidderId = survivors.includes(base.firstBidderId)
    ? base.firstBidderId
    : nextFirstBidder(base.playerOrder, base.firstBidderId, (id) => survivors.includes(id));

  const restarted: MatchState = {
    ...base,
    firstBidderId,
    deckCount: deckCountFor(survivors.length, base.cardsThisRound),
    round: emptyRound(),
    hidden: { stock: [], hands: {}, cards: {} },
  };

  return { ok: true, state: restarted, events };
}

/** Encerramento externo: host desistiu, ausência não resolvida, etc. */
export function endMatch(
  state: MatchState,
  endReason: NonNullable<MatchState['endReason']>,
): MatchState {
  if (state.endReason !== null) return state;
  return {
    ...state,
    round: { ...state.round, activePlayerId: null },
    endReason,
    winnerIds: state.winnerIds ?? [],
  };
}
