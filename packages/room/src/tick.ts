/**
 * Relógio da sala (`03` §2.1).
 *
 * Todos os prazos vivem como instantes no estado, e `tick` é a única coisa que
 * os consulta. O tempo entra por parâmetro: dez minutos de pausa levam
 * microssegundos em teste, e não existe `setTimeout` para vazar entre casos.
 *
 * O servidor chama `tick` periodicamente e sempre que um prazo vence.
 */

import { LIMITS, type BotDifficulty } from '@fdp/protocol';
import type { Move } from '@fdp/rules';
import { advance, autoMove, applyMove, createRng, isActive, isAutomaticPhase, project } from '@fdp/rules';
import { decidirAposta, decidirCarta } from '@fdp/bot';
import {
  absentMatchPlayers,
  deadlineFor,
  dealNow,
  sealMatchEnd,
  seatedPlayers,
  translate,
} from './room.js';
import {
  isAbsent,
  isOnline,
  isPresent,
  type Emission,
  type Room,
  type RoomCtx,
} from './types.js';
import { garantirHost } from './anfitriao.js';

const all = (event: Emission['event']): Emission => ({ audience: 'ALL', event });

export interface TickResult {
  room: Room;
  emissions: Emission[];
  changed: boolean;
}

/**
 * Próximo instante em que algo precisa acontecer. Devolve `null` quando não há
 * nada agendado, e serve para o servidor dormir em vez de fazer polling.
 */
export function nextDeadline(room: Room): number | null {
  const candidates: number[] = [];

  for (const player of room.players) {
    if (player.connection === 'RECONECTANDO' && player.socketLostAt !== null) {
      candidates.push(player.socketLostAt + LIMITS.transportGraceMs);
    }
  }

  if (room.pause) {
    if (!room.pause.decisionAnnounced) candidates.push(room.pause.decisionUnlockedAt);
    candidates.push(room.pause.hardDeadline);
  }

  if (room.phaseDeadline !== null && room.status === 'EM_PARTIDA') {
    candidates.push(room.phaseDeadline);
  }

  candidates.push(room.createdAt + LIMITS.roomMaxLifeMs);
  if (!room.players.some((p) => isPresent(p) && isOnline(p) && p.bot === null)) {
    candidates.push(room.lastActivityAt + LIMITS.lobbyIdleMs);
  }

  return candidates.length > 0 ? Math.min(...candidates) : null;
}

export function tick(room: Room, ctx: RoomCtx): TickResult {
  let current = room;
  const emissions: Emission[] = [];
  let changed = false;

  const step = <T extends { room: Room; emissions: Emission[] }>(result: T): void => {
    if (result.room !== current || result.emissions.length > 0) changed = true;
    current = result.room;
    emissions.push(...result.emissions);
  };

  // Ordem importa: a carência de transporte vira ausência antes de qualquer
  // decisão sobre pausa, e o fim de vida da sala vem por último.
  step(expireTransportGrace(current, ctx));
  step(advancePause(current, ctx));
  step(advanceMatchClock(current, ctx));
  step(expireRoom(current, ctx));

  // O relógio tem ponto de escrita próprio: a costura de fim de partida
  // precisa acontecer aqui também, e não só em `commit`.
  const sealed = sealMatchEnd(current, emissions);
  if (sealed !== current) {
    current = sealed;
    changed = true;
  }

  return {
    room: changed ? { ...current, stateVersion: current.stateVersion + 1 } : current,
    emissions,
    changed,
  };
}

/**
 * `RECONECTANDO` → `DESCONECTADO` (RJ-117a).
 *
 * É aqui que o socket caído vira ausência de verdade — e só aqui a partida
 * pausa. Quedas curtas de rede, que são a regra no celular, nunca chegam neste
 * ponto.
 */
function expireTransportGrace(room: Room, ctx: RoomCtx): { room: Room; emissions: Emission[] } {
  const emissions: Emission[] = [];
  let players = room.players;
  let anyExpired = false;

  for (const player of room.players) {
    if (player.connection !== 'RECONECTANDO' || player.socketLostAt === null) continue;
    if (ctx.now < player.socketLostAt + LIMITS.transportGraceMs) continue;

    anyExpired = true;
    players = players.map((p) =>
      p.id === player.id ? { ...p, connection: 'DESCONECTADO' as const } : p,
    );
    emissions.push(all({
      type: 'room:connectionChanged',
      payload: { playerId: player.id, connection: 'DESCONECTADO' },
    }));
  }

  if (!anyExpired) return { room, emissions };

  let next: Room = { ...room, players };

  // Só jogador da partida pausa a mesa. Espectador caindo não é problema de
  // ninguém (`03` §1.1).
  if (next.status === 'EM_PARTIDA' && absentMatchPlayers(next).length > 0) {
    next = enterPause(next, ctx, emissions);
  } else if (next.status === 'PAUSADA') {
    emissions.push(all({
      type: 'match:absenceChanged',
      payload: { absentPlayerIds: absentMatchPlayers(next) },
    }));
  }

  next = garantirHost(next, emissions);
  return { room: next, emissions };
}

function enterPause(room: Room, ctx: RoomCtx, emissions: Emission[]): Room {
  const pause = {
    since: ctx.now,
    decisionUnlockedAt: ctx.now + LIMITS.reconnectGraceMs,
    hardDeadline: ctx.now + LIMITS.pauseMaxMs,
    decisionAnnounced: false,
  };

  emissions.push(all({ type: 'room:statusChanged', payload: { status: 'PAUSADA' } }));
  emissions.push(all({
    type: 'match:paused',
    payload: {
      since: pause.since,
      absentPlayerIds: absentMatchPlayers(room),
      decisionUnlockedAt: pause.decisionUnlockedAt,
      hardDeadline: pause.hardDeadline,
    },
  }));

  // INV-15: pausado, nenhum prazo de turno corre.
  return { ...room, status: 'PAUSADA', pause, phaseDeadline: null };
}

/** RJ-150 e RJ-157: libera a decisão do host, e mata a pausa no teto. */
function advancePause(room: Room, ctx: RoomCtx): { room: Room; emissions: Emission[] } {
  if (room.status !== 'PAUSADA' || !room.pause) return { room, emissions: [] };
  const emissions: Emission[] = [];

  if (ctx.now >= room.pause.hardDeadline) {
    emissions.push(all({ type: 'room:statusChanged', payload: { status: 'FIM_DE_PARTIDA' } }));
    emissions.push(all({
      type: 'match:ended',
      payload: {
        winnerIds: [],
        lives: room.match?.lives ?? {},
        endReason: 'ENCERRADA_POR_AUSENCIA',
      },
    }));
    return {
      room: {
        ...room,
        status: 'FIM_DE_PARTIDA',
        pause: null,
        phaseDeadline: null,
        match: room.match
          ? { ...room.match, endReason: 'ENCERRADA_POR_AUSENCIA', winnerIds: [] }
          : null,
      },
      emissions,
    };
  }

  if (!room.pause.decisionAnnounced && ctx.now >= room.pause.decisionUnlockedAt) {
    // Vai a todos, não só ao host: a mesa precisa entender que existe uma
    // decisão pendente e de quem ela é.
    emissions.push(all({
      type: 'match:decisionUnlocked',
      payload: { hostId: room.hostId ?? '' },
    }));
    return {
      room: { ...room, pause: { ...room.pause, decisionAnnounced: true } },
      emissions,
    };
  }

  return { room, emissions: [] };
}

/**
 * Prazo de turno e fases automáticas.
 *
 * Auto-play só para jogador **conectado** (RJ-112): quem caiu pausa a partida
 * em vez de ter a jogada decidida por ninguém.
 */
function advanceMatchClock(room: Room, ctx: RoomCtx): { room: Room; emissions: Emission[] } {
  if (room.status !== 'EM_PARTIDA' || !room.match) return { room, emissions: [] };
  if (room.match.endReason !== null) return { room, emissions: [] };
  if (room.phaseDeadline === null || ctx.now < room.phaseDeadline) {
    return { room, emissions: [] };
  }

  const phase = room.match.round.phase;

  if (isAutomaticPhase(phase)) {
    const result = advance(room.match, ctx);
    if (!result.ok) return { room, emissions: [] };
    const next: Room = {
      ...room,
      match: result.state,
      phaseDeadline: deadlineFor({ ...room, match: result.state }, ctx.now),
    };
    const emissions = translate(result.events, next);
    return { room: dealNow(next, ctx, emissions), emissions };
  }

  const activeId = room.match.round.activePlayerId;
  if (activeId === null) return { room, emissions: [] };

  const player = room.players.find((p) => p.id === activeId);
  if (!player || isAbsent(player)) {
    // Desconectado não sofre auto-play; a pausa já está a caminho.
    return { room, emissions: [] };
  }

  // Bot: decide de verdade, e a jogada NÃO é auto-play. Auto-play é o que
  // acontece com humano que não jogou a tempo, e anunciar a jogada de um bot
  // como "ficou sem tempo" seria mentira na tela.
  if (player.bot) {
    return playBot(room, player.bot.difficulty, activeId, ctx);
  }

  const move = autoMove(room.match);
  const result = applyMove(room.match, move, ctx);
  if (!result.ok) return { room, emissions: [] };

  let next: Room = {
    ...room,
    match: result.state,
    phaseDeadline: deadlineFor({ ...room, match: result.state }, ctx.now),
  };

  // RJ-116: auto-play nunca é silencioso.
  const emissions: Emission[] = [
    all({
      type: 'move:autoPlayed',
      payload: {
        playerId: activeId,
        kind: move.type === 'bet' ? 'BET' : 'CARD',
        value: move.type === 'bet' ? move.bet : room.match.hidden.cards[move.cardId]!,
      },
    }),
    ...translate(result.events, next),
  ];
  next = dealNow(next, ctx, emissions);

  return { room: next, emissions };
}

/**
 * A vez de um bot.
 *
 * A decisão sai de `@fdp/bot`, que recebe a MESMA projeção que um humano
 * receberia — é o que garante que o bot não vê o que não deveria. Se ele
 * devolver jogada ilegal (defeito nosso, não do jogador), o auto-play cobre:
 * a mesa não pode travar porque um bot se enganou.
 */
function playBot(
  room: Room,
  difficulty: BotDifficulty,
  botId: string,
  ctx: RoomCtx,
): { room: Room; emissions: Emission[] } {
  if (!room.match) return { room, emissions: [] };

  const visao = project(room.match, botId);
  const rng = createRng(ctx.randomSeed());
  const phase = room.match.round.phase;

  const base = { playerId: botId, roundNumber: visao.roundNumber, trickNumber: visao.trickNumber };

  let move: Move;
  try {
    move = phase === 'APOSTAS'
      ? { ...base, type: 'bet', bet: decidirAposta(visao, difficulty, rng) }
      : { ...base, type: 'playCard', cardId: decidirCarta(visao, difficulty, rng) };
  } catch {
    move = autoMove(room.match);
  }

  let result = applyMove(room.match, move, ctx);
  if (!result.ok) {
    result = applyMove(room.match, autoMove(room.match), ctx);
    if (!result.ok) return { room, emissions: [] };
  }

  let next: Room = {
    ...room,
    match: result.state,
    phaseDeadline: deadlineFor({ ...room, match: result.state }, ctx.now),
  };
  const emissions = translate(result.events, next);
  next = dealNow(next, ctx, emissions);

  return { room: next, emissions };
}

/** TTL da sala: nada de estado morto acumulando (`00` §3). */
function expireRoom(room: Room, ctx: RoomCtx): { room: Room; emissions: Emission[] } {
  if (room.status === 'ENCERRADA') return { room, emissions: [] };

  const tooOld = ctx.now >= room.createdAt + LIMITS.roomMaxLifeMs;
  // Só GENTE conta para "tem alguém aqui". Bot está sempre conectado por
  // construção, então incluí-lo aqui deixaria viva para sempre qualquer sala
  // que já teve um bot — o vazamento seria silencioso e permanente.
  const nobodyOnline = !room.players.some((p) => isPresent(p) && isOnline(p) && p.bot === null);
  const idleTooLong = nobodyOnline && ctx.now >= room.lastActivityAt + LIMITS.lobbyIdleMs;

  if (!tooOld && !idleTooLong) return { room, emissions: [] };

  return {
    room: { ...room, status: 'ENCERRADA', phaseDeadline: null, pause: null },
    emissions: [all({ type: 'room:statusChanged', payload: { status: 'ENCERRADA' } })],
  };
}

export { seatedPlayers, isActive };
