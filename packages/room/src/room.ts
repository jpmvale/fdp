/**
 * Ciclo de vida da sala, conexão e comandos (`03` §1 e §2).
 */

import {
  AVATAR_COLORS,
  AVATAR_EMOJIS,
  LIMITS,
  type BotDifficulty,
  type ChatMessage,
  type Command,
} from '@fdp/protocol';
import {
  activePlayers,
  advance,
  applyMove,
  createMatch,
  DEFAULT_OPTIONS,
  endMatch,
  isActive,
  project,
  withdrawPlayers,
  type Card,
  type EngineEvent,
  type PlayerId,
} from '@fdp/rules';
import {
  isAbsent,
  isOnline,
  isPresent,
  toPublicPlayer,
  type Emission,
  type JoinParams,
  type Room,
  type RoomCtx,
  type RoomPlayer,
  type RoomResult,
} from './types.js';

function failWith(
  code:
    | 'ROOM_FULL' | 'NOT_HOST' | 'WRONG_STATUS' | 'VALIDATION_FAILED'
    | 'MATCH_PAUSED' | 'DECISION_LOCKED' | 'NOT_YOUR_TURN' | 'ILLEGAL_MOVE'
    | 'FORBIDDEN_CARD' | 'STALE_MOVE',
  motivo: string,
): RoomResult {
  return { ok: false, code, motivo };
}

/** Toda mudança de estado passa por aqui: `stateVersion` nunca é esquecido. */
function commit(room: Room, ctx: RoomCtx, emissions: Emission[]): RoomResult {
  const sealed = sealMatchEnd(room, emissions);
  return {
    ok: true,
    room: { ...sealed, stateVersion: sealed.stateVersion + 1, lastActivityAt: ctx.now },
    emissions,
  };
}

/**
 * Fecha a sala quando o motor encerra a partida.
 *
 * As saídas anormais — host encerrou, ausência, retirada — ajustam o status na
 * mão, porque são decisões da sala. A vitória normal não: ela vem do motor, que
 * por projeto não conhece sala nenhuma (RJ-143). Sem esta costura a partida
 * acaba, `match:ended` sai, e a sala fica presa em `EM_PARTIDA` — com
 * `host:rematch` recusado por status errado e quem chega virando espectador de
 * uma mesa que já terminou.
 *
 * INV-05 exige partida **ativa** em `EM_PARTIDA`; é exatamente esta transição
 * que a mantém verdadeira.
 */
export function sealMatchEnd(room: Room, emissions: Emission[]): Room {
  if (room.status !== 'EM_PARTIDA') return room;
  if (!room.match || room.match.endReason === null) return room;

  emissions.push(all({ type: 'room:statusChanged', payload: { status: 'FIM_DE_PARTIDA' } }));
  return { ...room, status: 'FIM_DE_PARTIDA', phaseDeadline: null, pause: null };
}

const all = (event: Emission['event']): Emission => ({ audience: 'ALL', event });
const to = (playerId: PlayerId, event: Emission['event']): Emission => ({
  audience: { playerId },
  event,
});

// ---------------------------------------------------------------------------
// Criação e entrada
// ---------------------------------------------------------------------------

export function createRoom(code: string, host: JoinParams, ctx: RoomCtx): Room {
  return {
    code,
    status: 'LOBBY',
    hostId: host.playerId,
    players: [newPlayer(host, ctx.now, false)],
    options: { ...DEFAULT_OPTIONS },
    match: null,
    pause: null,
    stateVersion: 1,
    createdAt: ctx.now,
    lastActivityAt: ctx.now,
    phaseDeadline: null,
    chat: [],
  };
}

function newPlayer(params: JoinParams, now: number, isSpectator: boolean): RoomPlayer {
  return {
    id: params.playerId,
    nickname: params.nickname,
    avatar: params.avatar,
    connection: 'CONECTADO',
    isSpectator,
    joinedAt: now,
    lastSeenAt: now,
    socketLostAt: null,
    bot: null,
  };
}

/** Nomes de bot: reconhecíveis como bot, e nunca confundíveis com gente. */
const NOMES_DE_BOT = [
  'Bot Ada', 'Bot Bardo', 'Bot Cazuza', 'Bot Dandara',
  'Bot Elis', 'Bot Faísca', 'Bot Gaia',
] as const;

function newBot(
  room: Room,
  difficulty: BotDifficulty,
  now: number,
  ctx: RoomCtx,
): RoomPlayer {
  const usados = new Set(room.players.filter(isPresent).map((p) => p.nickname));
  const nickname = NOMES_DE_BOT.find((n) => !usados.has(n)) ?? `Bot ${String(usados.size + 1)}`;

  const tomados = new Set(
    room.players.filter(isPresent).map((p) => `${p.avatar.emoji}|${p.avatar.color}`),
  );
  const avatar =
    AVATARES.find((a) => !tomados.has(`${a.emoji}|${a.color}`)) ?? AVATARES[0]!;

  // `newId` e não `randomSeed`: semente é para embaralhar e pode repetir entre
  // chamadas. Ainda assim o id passa por conferência — dois jogadores com o
  // mesmo id não dariam erro, dariam uma sala silenciosamente corrompida, e o
  // custo de garantir aqui é uma comparação.
  const existentes = new Set(room.players.map((p) => p.id));
  let id = ctx.newId();
  for (let n = 2; existentes.has(id); n++) id = `${ctx.newId()}-${n}`;

  return {
    id,
    nickname,
    avatar,
    // Bot está sempre conectado, por construção: não tem socket para cair, e
    // por isso nunca dispara pausa nem auto-play por ausência.
    connection: 'CONECTADO',
    isSpectator: false,
    joinedAt: now,
    lastSeenAt: now,
    socketLostAt: null,
    bot: { difficulty },
  };
}

const AVATARES = AVATAR_COLORS.map((color, i) => ({
  emoji: AVATAR_EMOJIS[i]!,
  color,
}));

export const botsOf = (room: Room): RoomPlayer[] =>
  room.players.filter((p) => isPresent(p) && p.bot !== null);

export function seatedPlayers(room: Room): RoomPlayer[] {
  return room.players.filter((p) => isPresent(p) && !p.isSpectator);
}

export function spectators(room: Room): RoomPlayer[] {
  return room.players.filter((p) => isPresent(p) && p.isSpectator);
}

export function join(room: Room, params: JoinParams, ctx: RoomCtx): RoomResult {
  if (room.status === 'ENCERRADA') return failWith('WRONG_STATUS', 'SALA_ENCERRADA');

  const existing = room.players.find((p) => p.id === params.playerId);
  if (existing) return reconnect(room, params.playerId, ctx);

  // Partida em andamento: entra como espectador e joga na próxima (RF-014).
  const asSpectator = room.status === 'EM_PARTIDA' || room.status === 'PAUSADA';

  if (asSpectator && spectators(room).length >= LIMITS.maxSpectators) {
    return failWith('ROOM_FULL', 'ESPECTADORES_LOTADOS');
  }
  if (!asSpectator && seatedPlayers(room).length >= LIMITS.maxPlayers) {
    return failWith('ROOM_FULL', 'SALA_LOTADA');
  }

  const player = newPlayer(params, ctx.now, asSpectator);
  const next: Room = { ...room, players: [...room.players, player] };
  return commit(next, ctx, [all({ type: 'room:playerJoined', payload: { player: toPublicPlayer(player) } })]);
}

// ---------------------------------------------------------------------------
// Conexão (`03` §2)
// ---------------------------------------------------------------------------

/**
 * Socket aberto. Se a pessoa estava ausente e a partida pausada, isso pode
 * retomar a partida.
 */
export function reconnect(room: Room, playerId: PlayerId, ctx: RoomCtx): RoomResult {
  const player = room.players.find((p) => p.id === playerId);
  if (!player) return failWith('VALIDATION_FAILED', 'JOGADOR_DESCONHECIDO');
  if (!isPresent(player)) return failWith('WRONG_STATUS', 'JOGADOR_SAIU');

  const wasAbsent = isAbsent(player);
  const players = replace(room.players, playerId, {
    connection: 'CONECTADO',
    socketLostAt: null,
    lastSeenAt: ctx.now,
  });

  const emissions: Emission[] = [];
  // Reconexão dentro da carência é invisível: nada de evento (RNF-066).
  if (wasAbsent) {
    emissions.push(all({ type: 'room:connectionChanged', payload: { playerId, connection: 'CONECTADO' } }));
  }

  const next = maybeResume({ ...room, players }, ctx, emissions);
  return commit(next.room, ctx, next.emissions);
}

/**
 * Socket caiu. **Não** é ausência ainda: começa a carência de transporte
 * (RJ-117a), e só o `tick` decide se virou ausência de verdade.
 */
export function disconnect(room: Room, playerId: PlayerId, ctx: RoomCtx): RoomResult {
  const player = room.players.find((p) => p.id === playerId);
  if (!player || !isPresent(player)) return failWith('VALIDATION_FAILED', 'JOGADOR_DESCONHECIDO');
  if (!isOnline(player)) return { ok: true, room, emissions: [] };

  const players = replace(room.players, playerId, {
    connection: 'RECONECTANDO',
    socketLostAt: ctx.now,
    lastSeenAt: ctx.now,
  });

  // Sem evento e sem incremento de versão: para o resto da mesa, nada mudou.
  return { ok: true, room: { ...room, players }, emissions: [] };
}

export function leave(room: Room, playerId: PlayerId, ctx: RoomCtx): RoomResult {
  const player = room.players.find((p) => p.id === playerId);
  if (!player || !isPresent(player)) return failWith('VALIDATION_FAILED', 'JOGADOR_DESCONHECIDO');

  let next: Room = {
    ...room,
    players: replace(room.players, playerId, { connection: 'SAIU' }),
  };
  const emissions: Emission[] = [
    all({ type: 'room:playerLeft', payload: { playerId, reason: 'LEFT' } }),
  ];

  // Sair em partida equivale a retirada: cartas e vidas descartadas (RJ-154).
  if (next.match && isActive(next.match, playerId)) {
    const withdrawal = withdrawPlayers(next.match, [playerId], ctx);
    if (withdrawal.ok) {
      next = { ...next, match: withdrawal.state };
      emissions.push(all({ type: 'round:aborted', payload: { roundNumber: withdrawal.state.roundNumber, withdrawnPlayerIds: [playerId] } }));
      if (withdrawal.state.endReason !== null) {
        next = { ...next, status: 'FIM_DE_PARTIDA', phaseDeadline: null, pause: null };
        emissions.push(all({ type: 'match:ended', payload: { winnerIds: withdrawal.state.winnerIds ?? [], lives: withdrawal.state.lives, endReason: withdrawal.state.endReason } }));
      }
    }
  }

  next = succeedHost(next, emissions);
  next = maybeResume(next, ctx, emissions).room;
  return commit(next, ctx, emissions);
}

/**
 * RF-013: o host passa ao jogador **online** com o menor `joinedAt`.
 *
 * Em `PAUSADA` isso é crítico: a decisão de RJ-150 precisa de alguém presente
 * para tomá-la, senão a sala só sai da pausa pelo `PAUSE_MAX`.
 */
function succeedHost(room: Room, emissions: Emission[]): Room {
  const host = room.players.find((p) => p.id === room.hostId);
  if (host && isPresent(host) && isOnline(host)) return room;

  const candidates = room.players
    .filter((p) => isPresent(p) && isOnline(p))
    .sort((a, b) => a.joinedAt - b.joinedAt);

  const successor = candidates[0];
  if (!successor) return room; // ninguém online; sucede na próxima conexão
  if (successor.id === room.hostId) return room;

  emissions.push(all({ type: 'room:hostChanged', payload: { hostId: successor.id } }));
  return { ...room, hostId: successor.id };
}

function replace(
  players: RoomPlayer[],
  playerId: PlayerId,
  patch: Partial<RoomPlayer>,
): RoomPlayer[] {
  return players.map((p) => (p.id === playerId ? { ...p, ...patch } : p));
}

// ---------------------------------------------------------------------------
// Pausa (`03` §1.2)
// ---------------------------------------------------------------------------

export function absentMatchPlayers(room: Room): PlayerId[] {
  if (!room.match) return [];
  return room.players
    .filter((p) => !p.isSpectator && isAbsent(p) && isActive(room.match!, p.id))
    .map((p) => p.id);
}

/** Entra em pausa. Suspende o prazo de turno — nunca o retoma (INV-15). */
export function pauseMatch(room: Room, ctx: RoomCtx, emissions: Emission[]): Room {
  if (room.status !== 'EM_PARTIDA') return room;

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

  return { ...room, status: 'PAUSADA', pause, phaseDeadline: null };
}

/**
 * Retoma se ninguém mais está ausente. O prazo de turno **reinicia do zero**
 * (RJ-119): ninguém volta de uma queda já com o relógio estourado.
 */
function maybeResume(room: Room, ctx: RoomCtx, emissions: Emission[]): { room: Room; emissions: Emission[] } {
  if (room.status !== 'PAUSADA' || !room.match) return { room, emissions };
  if (absentMatchPlayers(room).length > 0) {
    emissions.push(all({ type: 'match:absenceChanged', payload: { absentPlayerIds: absentMatchPlayers(room) } }));
    return { room, emissions };
  }

  const resumed: Room = {
    ...room,
    status: 'EM_PARTIDA',
    pause: null,
    phaseDeadline: deadlineFor(room, ctx.now),
  };

  emissions.push(all({ type: 'room:statusChanged', payload: { status: 'EM_PARTIDA' } }));
  emissions.push(all({
    type: 'match:resumed',
    payload: {
      phase: room.match.round.phase,
      activePlayerId: room.match.round.activePlayerId,
      deadline: resumed.phaseDeadline,
    },
  }));
  return { room: resumed, emissions };
}

/** Prazo da fase corrente. Automática usa a pausa de legibilidade de 3 s. */
export function deadlineFor(room: Room, now: number): number | null {
  if (!room.match || room.match.endReason !== null) return null;

  // Bot na vez: o prazo é o tempo que ele "pensa", não o do relógio humano.
  // Sem isso uma mesa de bots levaria 45 s por aposta esperando um estouro que
  // não vai acontecer — o bot não esquece de jogar.
  const ativo = room.match.round.activePlayerId;
  const phase = room.match.round.phase;
  if (ativo !== null && (phase === 'APOSTAS' || phase === 'VAZAS')) {
    const jogador = room.players.find((p) => p.id === ativo);
    if (jogador?.bot) return now + LIMITS.botThinkMs;
  }

  switch (room.match.round.phase) {
    case 'APOSTAS':
      return now + LIMITS.betTimeoutMs;
    case 'VAZAS':
      return now + LIMITS.playTimeoutMs;
    case 'RECOLHIMENTO':
      return now + LIMITS.trickPauseMs;
    case 'REVELACAO':
    case 'RESOLUCAO':
      return now + LIMITS.autoPhasePauseMs;
    case 'DISTRIBUICAO':
      // Distribuir não tem nada para o jogador ver. Resolve na hora, e este
      // prazo só existe como rede de segurança se algo escapar.
      return now;
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Comandos (`05` §4)
// ---------------------------------------------------------------------------

export function applyCommand(
  room: Room,
  playerId: PlayerId,
  command: Command,
  ctx: RoomCtx,
): RoomResult {
  const player = room.players.find((p) => p.id === playerId);
  if (!player || !isPresent(player)) return failWith('VALIDATION_FAILED', 'JOGADOR_DESCONHECIDO');

  const isHost = room.hostId === playerId;
  const hostOnly = command.type.startsWith('host:');
  if (hostOnly && !isHost) return failWith('NOT_HOST', 'COMANDO_EXIGE_HOST');

  switch (command.type) {
    case 'room:resync':
      return { ok: true, room, emissions: [to(playerId, snapshotFor(room, playerId))] };

    case 'player:leave':
      return leave(room, playerId, ctx);

    case 'player:setProfile': {
      if (room.status !== 'LOBBY') return failWith('WRONG_STATUS', 'SO_NO_LOBBY');
      const players = replace(room.players, playerId, {
        nickname: command.payload.nickname,
        avatar: command.payload.avatar,
      });
      const updated = players.find((p) => p.id === playerId)!;
      return commit({ ...room, players }, ctx, [
        all({ type: 'room:playerUpdated', payload: { player: toPublicPlayer(updated) } }),
      ]);
    }

    case 'chat:send': {
      // Sala encerrada não recebe mensagem: não há para quem falar, e o
      // histórico morre junto com ela (CA-331, CA-341).
      if (room.status === 'ENCERRADA') return failWith('WRONG_STATUS', 'SALA_ENCERRADA');

      // Bot não fala (CA-336). Estruturalmente ele nem tem socket por onde
      // mandar; a guarda existe porque "impossível hoje" e "impossível" são
      // coisas diferentes, e a barata é conferir.
      if (player.bot !== null) return failWith('VALIDATION_FAILED', 'BOT_NAO_FALA');

      // Aparar antes de medir: 280 espaços não são uma mensagem, e " oi " e
      // "oi" são a mesma (RNF-014).
      const texto = command.payload.text.trim();
      if (texto.length === 0 || texto.length > LIMITS.chatTextMax) {
        return failWith('VALIDATION_FAILED', 'MENSAGEM_INVALIDA');
      }

      const mensagem: ChatMessage = {
        id: ctx.newId(),
        playerId,
        // Copiado agora, de propósito — ver `ChatMessage` em `04`.
        nickname: player.nickname,
        text: texto,
        at: ctx.now,
      };

      // A mais antiga cai quando entra a que passa do teto (RNF-015).
      const chat = [...room.chat, mensagem].slice(-LIMITS.chatHistoryMax);

      return commit({ ...room, chat }, ctx, [
        all({ type: 'chat:message', payload: { message: mensagem } }),
      ]);
    }

    case 'host:kick': {
      if (room.status !== 'LOBBY') return failWith('WRONG_STATUS', 'SO_NO_LOBBY');
      const target = command.payload.playerId;
      if (target === playerId) return failWith('VALIDATION_FAILED', 'HOST_NAO_SE_EXPULSA');
      if (!room.players.some((p) => p.id === target && isPresent(p))) {
        return failWith('VALIDATION_FAILED', 'JOGADOR_DESCONHECIDO');
      }
      return commit(
        { ...room, players: replace(room.players, target, { connection: 'REMOVIDO' }) },
        ctx,
        [all({ type: 'room:playerLeft', payload: { playerId: target, reason: 'KICKED' } })],
      );
    }

    case 'host:addBot': {
      if (room.status !== 'LOBBY') return failWith('WRONG_STATUS', 'SO_NO_LOBBY');
      if (botsOf(room).length >= LIMITS.maxBots) {
        return failWith('ROOM_FULL', 'BOTS_DEMAIS');
      }
      if (seatedPlayers(room).length >= LIMITS.maxPlayers) {
        return failWith('ROOM_FULL', 'SALA_LOTADA');
      }
      const bot = newBot(room, command.payload.difficulty, ctx.now, ctx);
      return commit({ ...room, players: [...room.players, bot] }, ctx, [
        all({ type: 'room:playerJoined', payload: { player: toPublicPlayer(bot) } }),
      ]);
    }

    case 'host:removeBot': {
      if (room.status !== 'LOBBY') return failWith('WRONG_STATUS', 'SO_NO_LOBBY');
      const alvo = room.players.find((p) => p.id === command.payload.playerId && isPresent(p));
      // Só bot sai por aqui. Gente sai por `host:kick`, que é um gesto
      // diferente e merece confirmação diferente.
      if (!alvo || alvo.bot === null) return failWith('VALIDATION_FAILED', 'NAO_E_BOT');
      return commit(
        { ...room, players: room.players.filter((p) => p.id !== alvo.id) },
        ctx,
        [all({ type: 'room:playerLeft', payload: { playerId: alvo.id, reason: 'LEFT' } })],
      );
    }

    case 'host:setOptions': {
      if (room.status !== 'LOBBY') return failWith('WRONG_STATUS', 'SO_NO_LOBBY');
      return commit({ ...room, options: command.payload.options }, ctx, [
        all({ type: 'room:optionsChanged', payload: { options: command.payload.options } }),
      ]);
    }

    case 'host:startMatch':
      return startMatch(room, ctx);

    case 'host:endMatch': {
      if (room.status !== 'EM_PARTIDA' && room.status !== 'PAUSADA') {
        return failWith('WRONG_STATUS', 'SEM_PARTIDA');
      }
      return finishMatch(room, ctx, 'ENCERRADA_PELO_HOST');
    }

    case 'host:rematch': {
      if (room.status !== 'FIM_DE_PARTIDA') return failWith('WRONG_STATUS', 'SEM_FIM_DE_PARTIDA');
      // Espectadores viram jogadores na volta ao lobby (RF-014).
      const players = room.players.map((p) => (isPresent(p) ? { ...p, isSpectator: false } : p));
      const lobby: Room = { ...room, status: 'LOBBY', match: null, pause: null, phaseDeadline: null, players };
      return startMatch(lobby, ctx);
    }

    case 'host:toLobby': {
      // Só do fim de partida. No meio dela o caminho é `host:endMatch`, que é
      // um gesto diferente e com consequência diferente — encerrar sem
      // vencedor não é a mesma coisa que arrumar a mesa depois que acabou.
      if (room.status !== 'FIM_DE_PARTIDA') return failWith('WRONG_STATUS', 'SEM_FIM_DE_PARTIDA');
      // Espectadores viram jogadores na volta ao lobby (RF-014), como na
      // revanche: quem chegou no meio da partida passada joga a próxima.
      const players = room.players.map((p) => (isPresent(p) ? { ...p, isSpectator: false } : p));
      const lobby: Room = {
        ...room, status: 'LOBBY', match: null, pause: null, phaseDeadline: null, players,
      };
      return commit(lobby, ctx, [
        all({ type: 'room:statusChanged', payload: { status: 'LOBBY' } }),
      ]);
    }

    case 'host:resolveAbsence':
      return resolveAbsence(room, command.payload.action, ctx);

    case 'move:bet':
    case 'move:playCard':
      return applyGameMove(room, playerId, command, ctx);

    default:
      return failWith('VALIDATION_FAILED', 'COMANDO_DESCONHECIDO');
  }
}

/**
 * Roda a distribuição na hora.
 *
 * Sem isto, `match:started` sairia antes de existir carta, e o primeiro
 * apostador só apareceria um tick depois — a mesa ficaria três segundos sem
 * saber de quem é a vez.
 */
export function dealNow(room: Room, ctx: RoomCtx, emissions: Emission[]): Room {
  let current = room;
  let guard = 0;
  while (
    current.match !== null &&
    current.match.endReason === null &&
    current.match.round.phase === 'DISTRIBUICAO' &&
    guard++ < 4
  ) {
    const result = advance(current.match, ctx);
    if (!result.ok) break;
    const next: Room = { ...current, match: result.state };
    current = { ...next, phaseDeadline: deadlineFor(next, ctx.now) };
    emissions.push(...translate(result.events, current));
  }
  return current;
}

function startMatch(room: Room, ctx: RoomCtx): RoomResult {
  if (room.status !== 'LOBBY') return failWith('WRONG_STATUS', 'SO_NO_LOBBY');

  const seated = seatedPlayers(room);
  if (seated.length < LIMITS.minPlayers) return failWith('WRONG_STATUS', 'JOGADORES_INSUFICIENTES');

  const match = createMatch({
    matchId: ctx.newId(),
    seed: ctx.randomSeed(),
    playerIds: seated.map((p) => p.id),
    options: room.options,
  });

  const emissions: Emission[] = [
    all({ type: 'room:statusChanged', payload: { status: 'EM_PARTIDA' } }),
    all({
      type: 'match:started',
      payload: {
        matchId: match.id,
        playerOrder: match.playerOrder,
        lives: match.lives,
        options: match.options,
      },
    }),
  ];

  const started = dealNow(
    { ...room, status: 'EM_PARTIDA', match, phaseDeadline: null },
    ctx,
    emissions,
  );

  return commit(started, ctx, emissions);
}

function applyGameMove(
  room: Room,
  playerId: PlayerId,
  command: Extract<Command, { type: 'move:bet' | 'move:playCard' }>,
  ctx: RoomCtx,
): RoomResult {
  if (room.status === 'PAUSADA') return failWith('MATCH_PAUSED', 'PARTIDA_PAUSADA');
  if (room.status !== 'EM_PARTIDA' || !room.match) return failWith('WRONG_STATUS', 'SEM_PARTIDA');
  if (command.payload.matchId !== room.match.id) return failWith('STALE_MOVE', 'PARTIDA_ANTIGA');

  const move =
    command.type === 'move:bet'
      ? {
          type: 'bet' as const,
          playerId,
          roundNumber: command.payload.roundNumber,
          trickNumber: command.payload.trickNumber,
          bet: command.payload.bet,
        }
      : {
          type: 'playCard' as const,
          playerId,
          roundNumber: command.payload.roundNumber,
          trickNumber: command.payload.trickNumber,
          cardId: command.payload.cardId,
        };

  const result = applyMove(room.match, move, ctx);
  if (!result.ok) return { ok: false, code: result.code, motivo: result.motivo };

  const withMove: Room = {
    ...room,
    match: result.state,
    phaseDeadline: deadlineFor({ ...room, match: result.state }, ctx.now),
  };
  const emissions = translate(result.events, withMove);

  return commit(dealNow(withMove, ctx, emissions), ctx, emissions);
}

function resolveAbsence(
  room: Room,
  action: 'CONTINUAR_SEM' | 'ENCERRAR',
  ctx: RoomCtx,
): RoomResult {
  if (room.status !== 'PAUSADA' || !room.pause) return failWith('WRONG_STATUS', 'SEM_PAUSA');
  // RJ-151: antes da carência não há decisão a tomar.
  if (ctx.now < room.pause.decisionUnlockedAt) {
    return failWith('DECISION_LOCKED', 'DECISAO_AINDA_BLOQUEADA');
  }

  if (action === 'ENCERRAR') return finishMatch(room, ctx, 'ENCERRADA_POR_AUSENCIA');

  const absent = absentMatchPlayers(room);
  if (absent.length === 0) return failWith('WRONG_STATUS', 'NINGUEM_AUSENTE');
  if (!room.match) return failWith('WRONG_STATUS', 'SEM_PARTIDA');

  const withdrawal = withdrawPlayers(room.match, absent, ctx);
  if (!withdrawal.ok) return failWith('WRONG_STATUS', withdrawal.motivo);

  let next: Room = {
    ...room,
    match: withdrawal.state,
    players: absent.reduce((acc, id) => replace(acc, id, { connection: 'REMOVIDO' }), room.players),
    status: 'EM_PARTIDA',
    pause: null,
    phaseDeadline: deadlineFor({ ...room, match: withdrawal.state }, ctx.now),
  };

  const emissions: Emission[] = [
    all({ type: 'round:aborted', payload: { roundNumber: withdrawal.state.roundNumber, withdrawnPlayerIds: absent } }),
    ...absent.map((id) => all({ type: 'room:playerLeft' as const, payload: { playerId: id, reason: 'WITHDRAWN' as const } })),
    all({ type: 'room:statusChanged', payload: { status: 'EM_PARTIDA' } }),
  ];

  if (withdrawal.state.endReason !== null) {
    next = { ...next, status: 'FIM_DE_PARTIDA', phaseDeadline: null };
    emissions.push(all({
      type: 'match:ended',
      payload: {
        winnerIds: withdrawal.state.winnerIds ?? [],
        lives: withdrawal.state.lives,
        endReason: withdrawal.state.endReason,
      },
    }));
  }

  next = succeedHost(next, emissions);
  return commit(next, ctx, emissions);
}

function finishMatch(
  room: Room,
  ctx: RoomCtx,
  reason: 'ENCERRADA_PELO_HOST' | 'ENCERRADA_POR_AUSENCIA',
): RoomResult {
  const match = room.match ? endMatch(room.match, reason) : null;
  const next: Room = {
    ...room,
    status: 'FIM_DE_PARTIDA',
    match,
    pause: null,
    phaseDeadline: null,
  };
  return commit(next, ctx, [
    all({ type: 'room:statusChanged', payload: { status: 'FIM_DE_PARTIDA' } }),
    all({
      type: 'match:ended',
      payload: { winnerIds: match?.winnerIds ?? [], lives: match?.lives ?? {}, endReason: reason },
    }),
  ]);
}

// ---------------------------------------------------------------------------
// Tradução motor → protocolo, já endereçada
// ---------------------------------------------------------------------------

/**
 * Converte eventos do motor em emissões endereçadas.
 *
 * Os eventos que carregam estado oculto são emitidos **um por destinatário**,
 * já projetados. A camada de transporte nunca precisa saber o que esconder —
 * e portanto nunca pode errar nisso.
 */
export function translate(events: readonly EngineEvent[], room: Room): Emission[] {
  const match = room.match;
  if (!match) return [];
  const emissions: Emission[] = [];

  for (const event of events) {
    switch (event.type) {
      case 'round:started': {
        // Rodada de testa: cada jogador recebe as cartas dos outros, nunca a
        // sua (RJ-100/RJ-101). Uma serialização por destinatário.
        for (const player of room.players.filter((p) => isPresent(p))) {
          const view = project(match, player.id);
          emissions.push(to(player.id, {
            type: 'round:started',
            payload: {
              roundNumber: event.roundNumber,
              cardsThisRound: event.cardsThisRound,
              deckCount: event.deckCount,
              isForeheadRound: event.isForeheadRound,
              firstBidderId: event.firstBidderId,
              foreheadCards: view.foreheadCards,
            },
          }));
          if (!event.isForeheadRound && !player.isSpectator && view.hand.length > 0) {
            emissions.push(to(player.id, { type: 'round:dealt', payload: { hand: view.hand } }));
          }
        }
        break;
      }

      case 'move:betPlaced':
        emissions.push(all({
          type: 'move:betPlaced',
          payload: {
            playerId: event.playerId,
            bet: event.bet,
            betsSoFar: match.round.bets,
            forbiddenBet: event.forbiddenBet,
          },
        }));
        break;

      case 'round:phaseChanged':
        // `forbiddenBet` vai só para quem está na vez: enviar a todos
        // entregaria de graça uma conta que cada um deveria fazer sozinho.
        for (const player of room.players.filter((p) => isPresent(p))) {
          const view = project(match, player.id);
          emissions.push(to(player.id, {
            type: 'round:phaseChanged',
            payload: {
              phase: event.phase,
              activePlayerId: event.activePlayerId,
              deadline: room.phaseDeadline,
              forbiddenBet: view.forbiddenBet,
              // Entrar em VAZAS cria a primeira vaza, com líder e ordem de
              // jogo. Sem mandá-la aqui, o cliente não tem como montar esse
              // estado sem derivar regra — e regra não se decide no cliente.
              currentTrick: view.currentTrick,
              // A vaza corrente vem com o número dela: entrar em VAZAS não é
              // só mudar de fase, é começar a vaza 1.
              trickNumber: view.trickNumber,
            },
          }));
        }
        break;

      case 'move:cardPlayed': {
        const card = match.hidden.cards[event.cardId];
        if (card) {
          emissions.push(all({
            type: 'move:cardPlayed',
            payload: {
              playerId: event.playerId,
              card,
              trickNumber: event.trickNumber,
              nextPlayerId: match.round.activePlayerId,
              // O prazo da vez que COMEÇA agora. Entre as cartas de uma vaza
              // não há `round:phaseChanged` — a fase não muda —, então sem
              // isto o cliente fica com o prazo do turno anterior e a barra
              // do turno mente.
              deadline: room.phaseDeadline,
            },
          }));
        }
        break;
      }

      case 'trick:resolved': {
        // Aqui `match` já é o estado DEPOIS da resolução: `currentTrick` é a
        // vaza SEGUINTE, e `null` quando a rodada acabou. As duas informações
        // que faltavam ao cliente — quem lidera e em que ordem se joga — vêm
        // dentro dela. As cartas de uma vaza são públicas (RJ-066), então esta
        // projeção é a mesma para todo mundo.
        const publica = project(match, match.playerOrder[0]!);
        emissions.push(all({
          type: 'trick:resolved',
          payload: {
            trickNumber: event.trickNumber,
            winnerId: event.winnerId,
            annulled: event.winnerId === null,
            annulledValue: event.annulledValue,
            nextLeaderId: event.nextLeaderId,
            tricksWon: match.round.tricksWon,
            nextTrick: publica.currentTrick,
            nextTrickNumber: publica.trickNumber,
            // Quem já não tem salvação. É informação PÚBLICA (RJ-009): a mesa
            // inteira faria essa conta, e a interface mostra "☠ já era" para
            // todos. Muda exatamente quando uma vaza fecha.
            mortoEmVaza: publica.mortoEmVaza,
          },
        }));
        break;
      }

      case 'round:revealed': {
        const cards: Record<PlayerId, Card> = {};
        for (const pid of Object.keys(event.cards)) {
          const card = match.hidden.cards[event.cards[pid]!];
          if (card) cards[pid] = card;
        }
        emissions.push(all({ type: 'round:revealed', payload: { cards } }));
        break;
      }

      case 'round:resolved':
        emissions.push(all({
          type: 'round:resolved',
          payload: {
            summary: event.summary,
            lives: match.lives,
            eliminated: event.summary.eliminatedThisRound,
          },
        }));
        break;

      case 'match:ended':
        emissions.push(all({
          type: 'match:ended',
          payload: { winnerIds: event.winnerIds, lives: match.lives, endReason: event.endReason },
        }));
        break;

      case 'round:aborted':
        emissions.push(all({
          type: 'round:aborted',
          payload: { roundNumber: event.roundNumber, withdrawnPlayerIds: event.withdrawnPlayerIds },
        }));
        break;

      case 'round:decidedEarly':
        // Sem isto a mesa pula da vaza para a tela de fim sem explicação, e
        // quem está jogando conclui que o jogo bugou — a partida acabou com
        // cartas ainda na mão de todo mundo.
        emissions.push(all({
          type: 'system:notice',
          payload: {
            code: 'MATCH_DECIDED_EARLY',
            params: { trickNumber: event.trickNumber, skippedTricks: event.skippedTricks },
          },
        }));
        break;

      case 'player:doomed':
        // Derivável de apostas e vazas, que já são públicas (RJ-013).
        emissions.push(all({
          type: 'system:notice',
          payload: { code: 'PLAYER_DOOMED', params: { playerId: event.playerId, trickNumber: event.trickNumber } },
        }));
        break;

      default:
        break;
    }
  }

  return emissions;
}

/** `EV-001`: retrato completo do que aquele jogador tem direito de ver. */
export function snapshotFor(room: Room, viewerId: PlayerId): Emission['event'] {
  return {
    type: 'room:snapshot',
    payload: {
      code: room.code,
      status: room.status,
      hostId: room.hostId,
      options: room.options,
      stateVersion: room.stateVersion,
      players: room.players.filter(isPresent).map(toPublicPlayer),
      pause: room.pause
        ? {
            since: room.pause.since,
            absentPlayerIds: absentMatchPlayers(room),
            decisionUnlockedAt: room.pause.decisionUnlockedAt,
            hardDeadline: room.pause.hardDeadline,
          }
        : null,
      phaseDeadline: room.phaseDeadline,
      // O histórico no retrato é o que o faz sobreviver a recarregar a página e
      // a reconectar, e o que dá a conversa inteira a quem chega depois
      // (CA-334, CA-335).
      chat: room.chat,
      match: room.match ? project(room.match, viewerId) : null,
    },
  };
}

export { activePlayers };
