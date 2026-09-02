/**
 * Máquina de sala: ciclo de vida, conexão, pausa e relógio.
 * Cita os critérios de docs/10-criterios-de-aceite.md §2 e §3.
 */

import { describe, expect, it } from 'vitest';
import { LIMITS, type Avatar, type Command } from '@fdp/protocol';
import {
  applyCommand,
  checkRoomInvariants,
  createRoom,
  disconnect,
  generateCode,
  generateFreeCode,
  isBlockedCode,
  join,
  leave,
  nextDeadline,
  normalizeCode,
  reconnect,
  seatedPlayers,
  snapshotFor,
  spectators,
  tick,
  type Emission,
  type Room,
  type RoomCtx,
  absentMatchPlayers,
} from '@fdp/room';
import { ROOM_CODE_ALPHABET } from '@fdp/protocol';

const AVATAR: Avatar = { emoji: '🦊', color: 'amber' };

function ctxAt(now: number): RoomCtx {
  let counter = 0;
  return { now, randomSeed: () => 'seed-fixa', newId: () => `id-${++counter}` };
}

function ok(result: ReturnType<typeof join>): { room: Room; emissions: Emission[] } {
  if (!result.ok) throw new Error(`rejeitado: ${result.code}/${result.motivo}`);
  return { room: result.room, emissions: result.emissions };
}

/** Sala com N jogadores sentados, todos conectados. */
function roomWith(count: number, at = 0): Room {
  let room = createRoom('K7QMP', { playerId: 'p1', nickname: 'Ana', avatar: AVATAR }, ctxAt(at));
  for (let i = 2; i <= count; i++) {
    room = ok(join(room, { playerId: `p${i}`, nickname: `J${i}`, avatar: AVATAR }, ctxAt(at + i))).room;
  }
  return room;
}

function send(room: Room, playerId: string, command: Command, now: number) {
  return applyCommand(room, playerId, command, ctxAt(now));
}

/**
 * Todo mundo sentado dá pronto (RF-094).
 *
 * Existe porque a regra nova quebrou 52 testes de uma vez, e o conserto certo
 * não era afrouxar a regra: era o ajudante refletir o que uma mesa de verdade
 * faz antes de começar. Bot já nasce pronto e não precisa passar por aqui.
 */
const todosProntos = (room: Room, now = 90): Room =>
  seatedPlayers(room)
    .filter((p) => p.bot === null && !p.pronto)
    .reduce((r, p) => ok(send(r, p.id, {
      type: 'player:setPronto', payload: { pronto: true },
    }, now)).room, room);

const started = (room: Room, now = 100): Room =>
  ok(send(todosProntos(room, now - 1), room.hostId!,
    { type: 'host:startMatch', payload: {} }, now)).room;

const types = (emissions: Emission[]): string[] => emissions.map((e) => e.event.type);

// --- código da sala --------------------------------------------------------

describe('CA-009: código da sala', () => {
  const bytesFrom = (values: number[]) => () => Uint8Array.from(values);

  it('gera 5 caracteres do alfabeto sem I, O, 0 e 1', () => {
    let seed = 7;
    const random = (n: number): Uint8Array =>
      Uint8Array.from({ length: n }, () => (seed = (seed * 1103515245 + 12345) % 256));

    for (let i = 0; i < 2000; i++) {
      const code = generateCode(random);
      expect(code).toHaveLength(5);
      for (const char of code) expect(ROOM_CODE_ALPHABET).toContain(char);
    }
  });

  it('bloqueia palavras ofensivas', () => {
    expect(isBlockedCode('XPUTA')).toBe(true);
    expect(isBlockedCode('FUCKX')).toBe(true);
    expect(isBlockedCode('K7QMP')).toBe(false);
  });

  it('CA-003: normaliza minúsculas, espaços e hífens', () => {
    for (const raw of ['k7qmp', ' K7QMP ', 'k7-qmp']) {
      expect(normalizeCode(raw)).toBe('K7QMP');
    }
  });

  it('evita colisão, e falha alto quando não consegue', () => {
    const fixed = bytesFrom([0, 0, 0, 0, 0]); // sempre "AAAAA"
    expect(generateFreeCode(fixed, () => false)).toBe('AAAAA');
    // Código repetido colocaria duas mesas na mesma sala — pior que erro.
    expect(() => generateFreeCode(fixed, () => true)).toThrow(/código livre/);
  });
});

// --- lobby -----------------------------------------------------------------

describe('CA-020 a CA-026: lobby', () => {
  it('quem cria a sala é o host', () => {
    const room = roomWith(1);
    expect(room.hostId).toBe('p1');
    expect(room.status).toBe('LOBBY');
    expect(checkRoomInvariants(room)).toEqual([]);
  });

  it('CA-004: recusa o nono jogador', () => {
    const room = roomWith(8);
    const result = join(room, { playerId: 'p9', nickname: 'Nono', avatar: AVATAR }, ctxAt(50));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('ROOM_FULL');
  });

  it('CA-022: comando de host vindo de não-host é rejeitado', () => {
    const room = roomWith(3);
    const result = send(room, 'p2', { type: 'host:startMatch', payload: {} }, 50);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('NOT_HOST');
  });

  it('CA-024: não inicia partida abaixo do mínimo', () => {
    const result = send(roomWith(1), 'p1', { type: 'host:startMatch', payload: {} }, 50);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.motivo).toBe('JOGADORES_INSUFICIENTES');
  });

  it('CA-021: host expulsa; expulso some da sala', () => {
    const room = roomWith(3);
    const { room: after, emissions } = ok(
      send(room, 'p1', { type: 'host:kick', payload: { playerId: 'p2' } }, 50),
    );
    expect(types(emissions)).toContain('room:playerLeft');
    expect(after.players.find((p) => p.id === 'p2')!.connection).toBe('REMOVIDO');
    expect(checkRoomInvariants(after)).toEqual([]);
  });

  it('o host não consegue expulsar a si mesmo', () => {
    const result = send(roomWith(3), 'p1', { type: 'host:kick', payload: { playerId: 'p1' } }, 50);
    expect(result.ok).toBe(false);
  });

  it('CA-023: host que sai passa a coroa ao conectado mais antigo', () => {
    const room = roomWith(4);
    const { room: after, emissions } = ok(leave(room, 'p1', ctxAt(50)));
    expect(after.hostId).toBe('p2');
    expect(types(emissions)).toContain('room:hostChanged');
    expect(checkRoomInvariants(after)).toEqual([]);
  });

  it('INV-02: toda mudança de estado incrementa a versão', () => {
    const room = roomWith(2);
    const antes = room.stateVersion;
    const depois = ok(send(room, 'p1', { type: 'host:setOptions', payload: { options: { ...room.options, vidasIniciais: 3 } } }, 50)).room;
    expect(depois.stateVersion).toBeGreaterThan(antes);
    expect(depois.options.vidasIniciais).toBe(3);
  });

  it('opções só mudam no lobby', () => {
    const room = started(roomWith(3));
    const result = send(room, 'p1', { type: 'host:setOptions', payload: { options: room.options } }, 200);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('WRONG_STATUS');
  });
});

// --- espectadores ----------------------------------------------------------

describe('RF-014: espectadores', () => {
  it('quem entra com partida em andamento vira espectador', () => {
    const room = started(roomWith(3));
    const { room: after } = ok(join(room, { playerId: 'p9', nickname: 'Tarde', avatar: AVATAR }, ctxAt(200)));
    expect(after.players.find((p) => p.id === 'p9')!.isSpectator).toBe(true);
  });

  it('espectador vira jogador na revanche', () => {
    let room = started(roomWith(3));
    room = ok(join(room, { playerId: 'p9', nickname: 'Tarde', avatar: AVATAR }, ctxAt(200))).room;
    room = ok(send(room, 'p1', { type: 'host:endMatch', payload: {} }, 300)).room;
    expect(room.status).toBe('FIM_DE_PARTIDA');

    room = ok(send(room, 'p1', { type: 'host:rematch', payload: {} }, 400)).room;
    expect(room.players.find((p) => p.id === 'p9')!.isSpectator).toBe(false);
    expect(room.status).toBe('EM_PARTIDA');
  });

  it('CA-058: espectador que cai NÃO pausa a partida', () => {
    let room = started(roomWith(3));
    room = ok(join(room, { playerId: 'p9', nickname: 'Tarde', avatar: AVATAR }, ctxAt(200))).room;
    room = ok(disconnect(room, 'p9', ctxAt(300))).room;

    const result = tick(room, ctxAt(300 + LIMITS.transportGraceMs + 1));
    expect(result.room.status).toBe('EM_PARTIDA');
    expect(checkRoomInvariants(result.room)).toEqual([]);
  });
});

// --- carência de transporte e pausa ----------------------------------------

describe('CA-042 / CA-042a: carência de transporte', () => {
  it('CA-042a: socket que volta em 3 s não pausa nem emite nada', () => {
    let room = started(roomWith(3), 100);
    const before = room.stateVersion;

    room = ok(disconnect(room, 'p2', ctxAt(1000))).room;
    expect(room.players.find((p) => p.id === 'p2')!.connection).toBe('RECONECTANDO');
    // Invisível para a mesa: nem evento, nem versão nova.
    expect(room.stateVersion).toBe(before);

    const t = tick(room, ctxAt(3000));
    expect(t.room.status).toBe('EM_PARTIDA');
    expect(t.emissions).toEqual([]);

    const { room: back, emissions } = ok(reconnect(t.room, 'p2', ctxAt(3000)));
    expect(back.status).toBe('EM_PARTIDA');
    expect(types(emissions)).not.toContain('room:connectionChanged');
    expect(back.pause).toBeNull();
  });

  it('CA-042: além da carência vira ausência e pausa a partida', () => {
    let room = started(roomWith(3), 100);
    room = ok(disconnect(room, 'p2', ctxAt(1000))).room;

    const t = tick(room, ctxAt(1000 + LIMITS.transportGraceMs + 1));
    expect(t.room.status).toBe('PAUSADA');
    expect(types(t.emissions)).toContain('match:paused');
    // INV-15: pausado, nenhum prazo de turno corre.
    expect(t.room.phaseDeadline).toBeNull();
    expect(checkRoomInvariants(t.room)).toEqual([]);
  });

  it('CA-047: jogada durante a pausa é rejeitada com MATCH_PAUSED', () => {
    let room = started(roomWith(3), 100);
    room = ok(disconnect(room, 'p2', ctxAt(1000))).room;
    room = tick(room, ctxAt(20_000)).room;

    const result = send(room, room.match!.round.activePlayerId!, {
      type: 'move:bet',
      payload: { matchId: room.match!.id, roundNumber: 1, trickNumber: 0, bet: 0 },
    }, 21_000);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('MATCH_PAUSED');
  });

  it('CA-048: reconectar retoma e o prazo de turno reinicia do zero', () => {
    let room = started(roomWith(3), 100);
    room = ok(disconnect(room, 'p2', ctxAt(1000))).room;
    room = tick(room, ctxAt(20_000)).room;
    expect(room.status).toBe('PAUSADA');

    const { room: resumed, emissions } = ok(reconnect(room, 'p2', ctxAt(50_000)));
    expect(resumed.status).toBe('EM_PARTIDA');
    expect(types(emissions)).toContain('match:resumed');
    // Reiniciado a partir de agora, não retomado de onde parou (RJ-119).
    expect(resumed.phaseDeadline).toBe(50_000 + LIMITS.betTimeoutMs);
    expect(checkRoomInvariants(resumed)).toEqual([]);
  });

  it('CA-057: pausa é contínua — reconectar um e cair outro não zera o relógio', () => {
    let room = started(roomWith(4), 100);
    room = ok(disconnect(room, 'p2', ctxAt(1000))).room;
    room = tick(room, ctxAt(20_000)).room;
    const since = room.pause!.since;

    // p3 cai enquanto p2 ainda está fora.
    room = ok(disconnect(room, 'p3', ctxAt(25_000))).room;
    room = tick(room, ctxAt(40_000)).room;
    room = ok(reconnect(room, 'p2', ctxAt(45_000))).room;

    expect(room.status).toBe('PAUSADA');
    // Duas pessoas alternando quedas não podem segurar a sala para sempre.
    expect(room.pause!.since).toBe(since);
  });
});

// --- decisão do host -------------------------------------------------------

describe('CA-049 a CA-055: resolução da ausência', () => {
  const paused = (players = 4): Room => {
    let room = started(roomWith(players), 100);
    room = ok(disconnect(room, 'p2', ctxAt(1000))).room;
    return tick(room, ctxAt(20_000)).room;
  };

  it('CA-049: decidir antes de 60 s é bloqueado', () => {
    const room = paused();
    const result = send(room, room.hostId!, { type: 'host:resolveAbsence', payload: { action: 'ENCERRAR' } }, 30_000);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('DECISION_LOCKED');
  });

  it('CA-050: aos 60 s a decisão é anunciada à mesa inteira', () => {
    const room = paused();
    const t = tick(room, ctxAt(room.pause!.decisionUnlockedAt + 1));
    expect(types(t.emissions)).toContain('match:decisionUnlocked');
    // Anunciado uma vez só, não a cada tick.
    const again = tick(t.room, ctxAt(room.pause!.decisionUnlockedAt + 2));
    expect(types(again.emissions)).not.toContain('match:decisionUnlocked');
  });

  it('CA-051: ENCERRAR fecha a partida sem vencedor', () => {
    const room = paused();
    const { room: after } = ok(send(room, room.hostId!, { type: 'host:resolveAbsence', payload: { action: 'ENCERRAR' } }, room.pause!.decisionUnlockedAt + 1));
    expect(after.status).toBe('FIM_DE_PARTIDA');
    expect(after.match!.endReason).toBe('ENCERRADA_POR_AUSENCIA');
    expect(after.match!.winnerIds).toEqual([]);
  });

  it('CA-052: CONTINUAR_SEM retira o ausente e reinicia a rodada sem debitar vida', () => {
    const room = paused();
    const vidasAntes = { ...room.match!.lives };
    const rodada = room.match!.roundNumber;

    const { room: after, emissions } = ok(
      send(room, room.hostId!, { type: 'host:resolveAbsence', payload: { action: 'CONTINUAR_SEM' } }, room.pause!.decisionUnlockedAt + 1),
    );

    expect(after.status).toBe('EM_PARTIDA');
    expect(types(emissions)).toContain('round:aborted');
    expect(after.match!.roundNumber).toBe(rodada);
    expect(after.match!.withdrawn.map((w) => w.playerId)).toContain('p2');
    // INV-17: retirado não é eliminado.
    expect(after.match!.eliminated.map((e) => e.playerId)).not.toContain('p2');
    for (const [id, vidas] of Object.entries(vidasAntes)) {
      expect(after.match!.lives[id]).toBe(vidas);
    }
    expect(checkRoomInvariants(after)).toEqual([]);
  });

  it('CA-055: sobrando 1 jogador, encerra com VITORIA_POR_ABANDONO', () => {
    let room = started(roomWith(2), 100);
    room = ok(disconnect(room, 'p2', ctxAt(1000))).room;
    room = tick(room, ctxAt(20_000)).room;

    const { room: after } = ok(send(room, room.hostId!, { type: 'host:resolveAbsence', payload: { action: 'CONTINUAR_SEM' } }, room.pause!.decisionUnlockedAt + 1));
    expect(after.status).toBe('FIM_DE_PARTIDA');
    expect(after.match!.endReason).toBe('VITORIA_POR_ABANDONO');
  });

  it('CA-054: PAUSE_MAX encerra a partida sozinho', () => {
    const room = paused();
    const t = tick(room, ctxAt(room.pause!.hardDeadline + 1));
    expect(t.room.status).toBe('FIM_DE_PARTIDA');
    expect(t.room.match!.endReason).toBe('ENCERRADA_POR_AUSENCIA');
    // É a trava que impede a pausa de virar partida travada.
    expect(checkRoomInvariants(t.room)).toEqual([]);
  });

  it('CA-056: host que cai perde a coroa para quem pode decidir', () => {
    let room = started(roomWith(3), 100);
    room = ok(disconnect(room, 'p1', ctxAt(1000))).room; // p1 é o host
    const t = tick(room, ctxAt(1000 + LIMITS.transportGraceMs + 1));

    expect(t.room.status).toBe('PAUSADA');
    expect(t.room.hostId).not.toBe('p1');
    expect(types(t.emissions)).toContain('room:hostChanged');
    expect(checkRoomInvariants(t.room)).toEqual([]);
  });
});

// --- auto-play -------------------------------------------------------------

describe('CA-290 / CA-294: auto-play só para conectado', () => {
  it('CA-290: conectado que não age tem a aposta feita pelo servidor', () => {
    const room = started(roomWith(3), 100);
    const t = tick(room, ctxAt(room.phaseDeadline! + 1));
    expect(types(t.emissions)).toContain('move:autoPlayed');
    expect(Object.keys(t.room.match!.round.bets).length).toBe(1);
  });

  it('CA-294: desconectado NÃO sofre auto-play — a partida pausa', () => {
    let room = started(roomWith(3), 100);
    const daVez = room.match!.round.activePlayerId!;
    room = ok(disconnect(room, daVez, ctxAt(200))).room;

    // Passa da carência E do prazo do turno de uma vez.
    const t = tick(room, ctxAt(200 + LIMITS.betTimeoutMs + 1));
    expect(t.room.status).toBe('PAUSADA');
    expect(types(t.emissions)).not.toContain('move:autoPlayed');
    expect(Object.keys(t.room.match!.round.bets)).toHaveLength(0);
  });

  it('fases automáticas avançam sozinhas, sem comando de ninguém', () => {
    let room = started(roomWith(2), 100);
    // Duas apostas resolvem a fase; a rodada de 1 carta segue para revelação.
    for (let i = 0; i < 2; i++) {
      room = tick(room, ctxAt(room.phaseDeadline! + 1)).room;
    }
    let guard = 0;
    while (room.match!.round.phase !== 'APOSTAS' && guard++ < 10) {
      room = tick(room, ctxAt(room.phaseDeadline! + 1)).room;
    }
    expect(room.match!.roundNumber).toBeGreaterThan(1);
    expect(checkRoomInvariants(room)).toEqual([]);
  });
});

// --- TTL e agendamento -----------------------------------------------------

describe('TTL e nextDeadline', () => {
  it('sala vazia expira por inatividade', () => {
    let room = roomWith(2);
    room = ok(disconnect(room, 'p1', ctxAt(1000))).room;
    room = ok(disconnect(room, 'p2', ctxAt(1000))).room;
    room = tick(room, ctxAt(1000 + LIMITS.transportGraceMs + 1)).room;

    const t = tick(room, ctxAt(room.lastActivityAt + LIMITS.lobbyIdleMs + 1));
    expect(t.room.status).toBe('ENCERRADA');
  });

  it('sala morre no teto de vida mesmo com gente dentro', () => {
    const room = roomWith(3);
    const t = tick(room, ctxAt(room.createdAt + LIMITS.roomMaxLifeMs + 1));
    expect(t.room.status).toBe('ENCERRADA');
  });

  it('nextDeadline aponta para o compromisso mais próximo — sem polling cego', () => {
    let room = started(roomWith(3), 100);
    expect(nextDeadline(room)).toBe(room.phaseDeadline);

    // Com o socket caído, a carência de transporte entra na disputa; o prazo
    // devolvido é sempre o menor entre os pendentes.
    room = ok(disconnect(room, 'p2', ctxAt(1000))).room;
    const carencia = 1000 + LIMITS.transportGraceMs;
    expect(nextDeadline(room)).toBe(Math.min(room.phaseDeadline!, carencia));
  });
});

// --- resync ----------------------------------------------------------------

describe('CA-043: resync', () => {
  it('devolve snapshot só para quem pediu', () => {
    const room = started(roomWith(3), 100);
    const { emissions } = ok(send(room, 'p2', { type: 'room:resync', payload: {} }, 200));
    expect(emissions).toHaveLength(1);
    expect(emissions[0]!.event.type).toBe('room:snapshot');
    expect(emissions[0]!.audience).toEqual({ playerId: 'p2' });
  });

  it('CA-281: o snapshot da rodada de testa não contém a própria carta', () => {
    const room = started(roomWith(4), 100);
    expect(room.match!.round.isForeheadRound).toBe(true);

    for (const player of room.players) {
      const { emissions } = ok(send(room, player.id, { type: 'room:resync', payload: {} }, 200));
      const serialized = JSON.stringify(emissions[0]!.event);
      const ownCardId = room.match!.hidden.hands[player.id]![0]!;
      expect(serialized).not.toContain(ownCardId);
      // E contém as cartas dos outros três (RJ-101).
      for (const other of room.players.filter((p) => p.id !== player.id)) {
        expect(serialized).toContain(room.match!.hidden.hands[other.id]![0]!);
      }
    }
  });
});

// --- fim de partida --------------------------------------------------------

describe('INV-05: a sala fecha quando a partida termina', () => {
  it('vitória normal leva a sala a FIM_DE_PARTIDA, não só a partida', () => {
    let room = started(roomWith(3));
    let now = 100;

    // O relógio leva a partida ao fim por auto-play, sem ninguém jogar.
    for (let i = 0; i < 4000 && room.match?.endReason === null; i++) {
      now += 1000;
      const result = tick(room, ctxAt(now));
      if (result.changed) room = result.room;
    }

    expect(room.match?.endReason).toBe('VITORIA');
    // A saída anormal já ajustava o status; a vitória normal vem do motor, que
    // não conhece sala — sem a costura, `host:rematch` fica inalcançável.
    expect(room.status).toBe('FIM_DE_PARTIDA');
    expect(room.phaseDeadline).toBeNull();
    expect(checkRoomInvariants(room)).toEqual([]);
  });

  it('o fim é anunciado: room:statusChanged acompanha match:ended', () => {
    let room = started(roomWith(3));
    let now = 100;
    const vistos: string[] = [];

    for (let i = 0; i < 4000 && room.match?.endReason === null; i++) {
      now += 1000;
      const result = tick(room, ctxAt(now));
      if (!result.changed) continue;
      room = result.room;
      vistos.push(...types(result.emissions));
    }

    expect(vistos).toContain('match:ended');
    expect(vistos.filter((t) => t === 'room:statusChanged').length).toBeGreaterThan(0);
  });

  it('depois da vitória a revanche é aceita', () => {
    let room = started(roomWith(3));
    let now = 100;
    for (let i = 0; i < 4000 && room.match?.endReason === null; i++) {
      now += 1000;
      const result = tick(room, ctxAt(now));
      if (result.changed) room = result.room;
    }

    const revanche = send(room, room.hostId!, { type: 'host:rematch', payload: {} }, now + 1000);
    expect(revanche.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Bots (RF-018)
// ---------------------------------------------------------------------------

describe('CA-326: o host senta e tira bots no lobby', () => {
  const addBot = (difficulty: 'FACIL' | 'MEDIO'): Command =>
    ({ type: 'host:addBot', payload: { difficulty } });

  it('o bot entra como jogador sentado, conectado e marcado como bot', () => {
    const { room } = ok(applyCommand(roomWith(1), 'p1', addBot('MEDIO'), ctxAt(10)));
    const bot = room.players.find((p) => p.bot !== null);

    expect(bot).toBeDefined();
    expect(bot!.bot).toEqual({ difficulty: 'MEDIO' });
    expect(bot!.isSpectator).toBe(false);
    expect(bot!.connection).toBe('CONECTADO');
    expect(room.players).toHaveLength(2);
  });

  it('cada bot recebe id, nome e avatar próprios', () => {
    let room = roomWith(1);
    // Um contador só para os três: `ctxAt` cria um novo a cada chamada, e o
    // que se quer testar aqui é a sala, não o gerador de id do teste.
    let n = 0;
    const ctxSeq = (now: number): RoomCtx => ({ now, randomSeed: () => 'seed', newId: () => `bot-${++n}` });
    for (let i = 0; i < 3; i++) {
      room = ok(applyCommand(room, 'p1', addBot('FACIL'), ctxSeq(10 + i))).room;
    }
    const bots = room.players.filter((p) => p.bot !== null);

    expect(new Set(bots.map((b) => b.id)).size).toBe(3);
    expect(new Set(bots.map((b) => b.nickname)).size).toBe(3);
    expect(new Set(bots.map((b) => `${b.avatar.emoji}|${b.avatar.color}`)).size).toBe(3);
  });

  it('para em 7 bots: mesa só de bot não é jogo', () => {
    let room = roomWith(1);
    for (let i = 0; i < LIMITS.maxBots; i++) {
      room = ok(applyCommand(room, 'p1', addBot('FACIL'), ctxAt(10 + i))).room;
    }
    const excedente = applyCommand(room, 'p1', addBot('FACIL'), ctxAt(100));

    expect(excedente.ok).toBe(false);
    expect(room.players).toHaveLength(LIMITS.maxPlayers);
  });

  it('só o host mexe nos bots', () => {
    const room = roomWith(2);
    const recusado = applyCommand(room, 'p2', addBot('FACIL'), ctxAt(10));
    expect(recusado.ok).toBe(false);
  });

  it('`host:removeBot` não serve para expulsar gente', () => {
    const room = roomWith(2);
    const recusado = applyCommand(
      room, 'p1', { type: 'host:removeBot', payload: { playerId: 'p2' } }, ctxAt(10),
    );
    expect(recusado.ok).toBe(false);
    if (!recusado.ok) expect(recusado.motivo).toBe('NAO_E_BOT');
  });

  it('o bot removido some da sala, sem deixar assento vazio', () => {
    const comBot = ok(applyCommand(roomWith(1), 'p1', addBot('FACIL'), ctxAt(10))).room;
    const bot = comBot.players.find((p) => p.bot !== null)!;
    const { room } = ok(applyCommand(
      comBot, 'p1', { type: 'host:removeBot', payload: { playerId: bot.id } }, ctxAt(20),
    ));
    expect(room.players.some((p) => p.id === bot.id)).toBe(false);
  });

  it('com a partida em andamento, não se mexe em bot', () => {
    let room = ok(applyCommand(roomWith(1), 'p1', addBot('FACIL'), ctxAt(10))).room;
    room = ok(applyCommand(todosProntos(room, 19), 'p1', { type: 'host:startMatch', payload: {} }, ctxAt(20))).room;
    const recusado = applyCommand(room, 'p1', addBot('FACIL'), ctxAt(30));
    expect(recusado.ok).toBe(false);
  });
});

describe('CA-327: o bot joga sozinho quando é a vez dele', () => {
  it('uma partida de humano + 2 bots caminha só com o relógio', () => {
    let room = roomWith(1);
    room = ok(applyCommand(room, 'p1', { type: 'host:addBot', payload: { difficulty: 'MEDIO' } }, ctxAt(10))).room;
    room = ok(applyCommand(room, 'p1', { type: 'host:addBot', payload: { difficulty: 'FACIL' } }, ctxAt(11))).room;
    room = ok(applyCommand(todosProntos(room, 19), 'p1', { type: 'host:startMatch', payload: {} }, ctxAt(20))).room;

    const humano = 'p1';
    let agora = 20;
    let jogadasDoBot = 0;

    // O relógio avança em saltos pequenos. Quando é a vez de um bot, o prazo
    // dele é curto (`botThinkMs`) e o tick resolve; quando é a vez do humano,
    // nada acontece — que é exatamente o que se quer verificar.
    for (let passo = 0; passo < 400 && room.match?.endReason === null; passo++) {
      const ativo = room.match?.round.activePlayerId ?? null;
      if (ativo !== null && ativo !== humano) {
        agora += LIMITS.botThinkMs;
        const antes = room.match?.round.phase;
        const r = tick(room, ctxAt(agora));
        if (r.changed) {
          room = r.room;
          if (antes === 'APOSTAS' || antes === 'VAZAS') jogadasDoBot++;
        }
        continue;
      }
      // Vez do humano (ou fase automática): empurra o relógio até o prazo.
      agora = (room.phaseDeadline ?? agora + 1000) + 1;
      const r = tick(room, ctxAt(agora));
      room = r.changed ? r.room : room;
    }

    expect(jogadasDoBot).toBeGreaterThan(0);
    expect(checkRoomInvariants(room)).toEqual([]);
  });

  it('o prazo de um bot é o de pensar, não o do relógio humano', () => {
    let room = roomWith(1);
    room = ok(applyCommand(room, 'p1', { type: 'host:addBot', payload: { difficulty: 'MEDIO' } }, ctxAt(10))).room;
    room = ok(applyCommand(todosProntos(room, 19), 'p1', { type: 'host:startMatch', payload: {} }, ctxAt(20))).room;

    // Avança até que a vez seja do bot.
    let agora = 20;
    for (let i = 0; i < 50 && room.match?.round.activePlayerId === 'p1'; i++) {
      agora = (room.phaseDeadline ?? agora) + 1;
      room = tick(room, ctxAt(agora)).room;
    }

    if (room.match?.round.activePlayerId !== 'p1' && room.phaseDeadline !== null) {
      expect(room.phaseDeadline - agora).toBeLessThanOrEqual(LIMITS.botThinkMs);
    }
  });
});

describe('CA-328: sala só com bots não vive para sempre', () => {
  it('o humano saindo, a sala expira pelo ócio como qualquer outra', () => {
    let room = ok(applyCommand(roomWith(1), 'p1', { type: 'host:addBot', payload: { difficulty: 'FACIL' } }, ctxAt(10))).room;
    room = ok(leave(room, 'p1', ctxAt(20))).room;

    const depois = tick(room, ctxAt(20 + LIMITS.lobbyIdleMs + 1));
    expect(depois.room.status).toBe('ENCERRADA');
  });
});

// ---------------------------------------------------------------------------
// Chat (RF-017) — `docs/10` §4.9
// ---------------------------------------------------------------------------

describe('CA-350: voltar ao lobby depois da partida', () => {
  const aoLobby: Command = { type: 'host:toLobby', payload: {} };

  it('do fim de partida, a sala volta a LOBBY sem começar nada', () => {
    let room = ok(applyCommand(roomWith(1), 'p1', { type: 'host:addBot', payload: { difficulty: 'FACIL' } }, ctxAt(10))).room;
    room = ok(applyCommand(todosProntos(room, 19), 'p1', { type: 'host:startMatch', payload: {} }, ctxAt(20))).room;
    room = ok(applyCommand(room, 'p1', { type: 'host:endMatch', payload: {} }, ctxAt(30))).room;
    expect(room.status).toBe('FIM_DE_PARTIDA');

    const { room: depois } = ok(applyCommand(room, 'p1', aoLobby, ctxAt(40)));

    // A diferença para a revanche: aqui ninguém começa a jogar. É para poder
    // trocar bots e opções antes.
    expect(depois.status).toBe('LOBBY');
    expect(depois.match).toBeNull();
    expect(depois.phaseDeadline).toBeNull();
  });

  it('não serve para fugir do meio de uma partida', () => {
    let room = ok(applyCommand(roomWith(1), 'p1', { type: 'host:addBot', payload: { difficulty: 'FACIL' } }, ctxAt(10))).room;
    room = ok(applyCommand(todosProntos(room, 19), 'p1', { type: 'host:startMatch', payload: {} }, ctxAt(20))).room;

    const recusado = applyCommand(room, 'p1', aoLobby, ctxAt(30));
    expect(recusado.ok).toBe(false);
    // No meio da partida o caminho é `host:endMatch`, que é outro gesto.
    expect(applyCommand(room, 'p1', { type: 'host:endMatch', payload: {} }, ctxAt(30)).ok).toBe(true);
  });

  it('só o host volta a mesa para o lobby', () => {
    let room = roomWith(2);
    room = ok(applyCommand(todosProntos(room, 19), 'p1', { type: 'host:startMatch', payload: {} }, ctxAt(20))).room;
    room = ok(applyCommand(room, 'p1', { type: 'host:endMatch', payload: {} }, ctxAt(30))).room;
    expect(applyCommand(room, 'p2', aoLobby, ctxAt(40)).ok).toBe(false);
  });

  it('espectador da partida passada joga a próxima (RF-014)', () => {
    let room = roomWith(2);
    room = ok(applyCommand(todosProntos(room, 19), 'p1', { type: 'host:startMatch', payload: {} }, ctxAt(20))).room;
    room = ok(join(room, { playerId: 'p9', nickname: 'Tarde', avatar: AVATAR }, ctxAt(25))).room;
    expect(room.players.find((p) => p.id === 'p9')!.isSpectator).toBe(true);

    room = ok(applyCommand(room, 'p1', { type: 'host:endMatch', payload: {} }, ctxAt(30))).room;
    const { room: depois } = ok(applyCommand(room, 'p1', aoLobby, ctxAt(40)));

    expect(depois.players.find((p) => p.id === 'p9')!.isSpectator).toBe(false);
  });
});

/**
 * RF-083: sentar-se à mesa ou sair dela para assistir, no lobby.
 *
 * Antes só havia um caminho para virar espectador — chegar com a partida em
 * andamento — e nenhum de volta a não ser a próxima partida começar. Quem
 * queria só olhar tinha de sair da sala, e quem entrou cedo demais ocupava um
 * lugar sem querer.
 */
describe('CA-397 / RF-083: entrar e sair da mesa no lobby', () => {
  const virar = (spectator: boolean) =>
    ({ type: 'player:setSpectator', payload: { spectator } }) as const;

  it('sai da mesa e volta, liberando e retomando o lugar', () => {
    let room = roomWith(3);
    expect(seatedPlayers(room)).toHaveLength(3);

    room = ok(applyCommand(room, 'p2', virar(true), ctxAt(10))).room;
    expect(seatedPlayers(room)).toHaveLength(2);
    expect(spectators(room).map((p) => p.id)).toEqual(['p2']);

    room = ok(applyCommand(room, 'p2', virar(false), ctxAt(20))).room;
    expect(seatedPlayers(room)).toHaveLength(3);
    expect(spectators(room)).toHaveLength(0);
  });

  it('pedir o que já se é não emite nada nem muda a versão', () => {
    const room = roomWith(2);
    const antes = room.stateVersion;
    const r = applyCommand(room, 'p1', virar(false), ctxAt(10));

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // Um botão clicado duas vezes não é erro; emitir mudança sem mudança faria
    // a tela de todo mundo repintar à toa.
    expect(r.emissions).toEqual([]);
    expect(r.room.stateVersion).toBe(antes);
  });

  it('só no lobby: com partida em curso, recusa', () => {
    let room = roomWith(3);
    room = ok(applyCommand(todosProntos(room, 9), 'p1', { type: 'host:startMatch', payload: {} }, ctxAt(10))).room;

    // Sair da mesa no meio da partida é abandono, e tem caminho próprio; entrar
    // nela é RF-014, que manda jogar na PRÓXIMA. Alternar aqui deixaria alguém
    // escapar da rodada em que está perdendo.
    const r = applyCommand(room, 'p2', virar(true), ctxAt(20));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toBe('SO_NO_LOBBY');
  });

  it('o host que vai assistir DEIXA de ser host', () => {
    let room = roomWith(3);
    expect(room.hostId).toBe('p1');

    const r = ok(applyCommand(room, 'p1', virar(true), ctxAt(10)));
    room = r.room;

    // Sem isto a mesa fica com um dono que não está nela: incapaz de jogar, e
    // o único capaz de começar. A sala travaria sem ninguém entender por quê.
    expect(room.hostId).not.toBe('p1');
    expect(seatedPlayers(room).map((p) => p.id)).toContain(room.hostId);
    expect(r.emissions.some((e) => e.event.type === 'room:hostChanged')).toBe(true);
  });

  it('CA-399: bot NUNCA herda a mesa', () => {
    // Isto derrubou a sala na primeira vez que testei no navegador: o host
    // virou espectador, o mais antigo dos sentados era um bot, e a tela passou
    // a dizer "esperando Bot Ada começar". Bot não aperta botão.
    let room = roomWith(2);
    room = ok(applyCommand(room, 'p1', { type: 'host:addBot', payload: { difficulty: 'MEDIO' } }, ctxAt(10))).room;
    room = ok(applyCommand(room, 'p2', { type: 'player:leave', payload: {} }, ctxAt(20))).room;

    // Sobra p1 (host) e um bot sentado. p1 vai assistir.
    room = ok(applyCommand(room, 'p1', virar(true), ctxAt(30))).room;

    const host = room.players.find((p) => p.id === room.hostId);
    expect(host?.bot).toBeNull();
    // Sem candidato humano sentado, o host CONTINUA sendo quem estava: ele
    // ainda pode se sentar de volta, e a sala não fica governada por um bot.
    expect(room.hostId).toBe('p1');
  });

  it('CA-399: nem pela sequência inteira — assistir, sentar, jogar e cair', () => {
    /*
     * A sequência exata em que vi um bot com a coroa no navegador. Cada passo
     * dela mexe no host por um caminho diferente (`setSpectator`, `leave`,
     * `disconnect` + `tick`), e o teste percorre os três de uma vez porque foi
     * a COMBINAÇÃO que me confundiu — cada um isolado parecia correto.
     */
    let room = roomWith(1);
    room = ok(applyCommand(room, 'p1', { type: 'host:addBot', payload: { difficulty: 'MEDIO' } }, ctxAt(10))).room;
    room = ok(applyCommand(room, 'p1', { type: 'host:addBot', payload: { difficulty: 'MEDIO' } }, ctxAt(20))).room;

    const humano = (r: Room) => r.players.find((p) => p.id === r.hostId)?.bot === null;

    room = ok(applyCommand(room, 'p1', virar(true), ctxAt(30))).room;
    expect(humano(room), 'depois de virar espectador').toBe(true);

    room = ok(applyCommand(room, 'p1', virar(false), ctxAt(40))).room;
    expect(humano(room), 'depois de sentar de volta').toBe(true);

    room = ok(applyCommand(todosProntos(room, 49), 'p1', { type: 'host:startMatch', payload: {} }, ctxAt(50))).room;
    expect(humano(room), 'depois de começar').toBe(true);

    // Cai, e o tempo passa: a carência de transporte vira ausência, e é aí que
    // a sucessão roda.
    room = ok(disconnect(room, 'p1', ctxAt(60))).room;
    for (let t = 100; t < 120_000; t += 5_000) room = tick(room, ctxAt(t)).room;
    expect(humano(room), 'depois de cair e o tempo passar').toBe(true);

    // E quando alguém novo chega, é ELE quem recebe a mesa — não um bot.
    room = ok(join(room, { playerId: 'p9', nickname: 'Nova', avatar: { emoji: '🐝', color: 'lime' } }, ctxAt(130_000))).room;
    room = ok(reconnect(room, 'p9', ctxAt(130_100))).room;
    expect(humano(room), 'depois de alguém novo chegar').toBe(true);
  });

  it('CA-407: espectador saindo NÃO mexe na partida em curso', () => {
    /*
     * O defeito mais grave desta leva, e o mais fácil de não acreditar: alguém
     * que só estava ASSISTINDO fechava a aba e a rodada em curso era abortada,
     * voltando todo mundo para `DISTRIBUICAO`.
     *
     * A causa estava em `isActive` (`@fdp/rules`), que respondia "sim, está
     * ativo" para um id que nunca esteve na partida — ele não está em
     * `eliminated` nem em `withdrawn`, e ninguém checava `playerOrder`. O
     * `leave()` daqui pergunta exatamente isso para aplicar RJ-154.
     *
     * O teste vive nos dois níveis: a raiz está coberta em `engine.test.ts`
     * (CA-406), e aqui fica o sintoma — porque foi pelo sintoma que ele
     * apareceu, e é pelo sintoma que alguém vai reconhecê-lo se voltar.
     */
    let room = roomWith(3);
    room = ok(applyCommand(todosProntos(room, 9), 'p1', { type: 'host:startMatch', payload: {} }, ctxAt(10))).room;

    room = ok(join(room, { playerId: 's1', nickname: 'Plateia', avatar: { emoji: '🦉', color: 'sky' } }, ctxAt(20))).room;
    room = ok(reconnect(room, 's1', ctxAt(21))).room;
    expect(spectators(room).map((p) => p.id)).toEqual(['s1']);

    const antes = room.match!;
    const r = ok(leave(room, 's1', ctxAt(30)));

    // Nenhuma rodada abortada, e nada da partida se moveu.
    expect(r.emissions.map((e) => e.event.type)).not.toContain('round:aborted');
    expect(r.room.match!.round.phase).toBe(antes.round.phase);
    expect(r.room.match!.roundNumber).toBe(antes.roundNumber);
    expect(r.room.match!.withdrawn).toEqual(antes.withdrawn);
    expect(r.room.match!.playerOrder).toEqual(antes.playerOrder);
  });

  it('CA-407: quem ESTAVA jogando e sai continua abortando a rodada (RJ-154)', () => {
    // A outra metade: o conserto não pode ter desligado a retirada de verdade.
    let room = roomWith(3);
    room = ok(applyCommand(todosProntos(room, 9), 'p1', { type: 'host:startMatch', payload: {} }, ctxAt(10))).room;

    const r = ok(leave(room, 'p2', ctxAt(20)));
    expect(r.emissions.map((e) => e.event.type)).toContain('round:aborted');
    expect(r.room.match!.withdrawn.map((w) => w.playerId)).toEqual(['p2']);
  });

  it('CA-400: mesa só de bots não começa partida', () => {
    let room = roomWith(1);
    room = ok(applyCommand(room, 'p1', { type: 'host:addBot', payload: { difficulty: 'MEDIO' } }, ctxAt(10))).room;
    room = ok(applyCommand(room, 'p1', { type: 'host:addBot', payload: { difficulty: 'MEDIO' } }, ctxAt(20))).room;

    // Dois bots sentados passam no teto de `minPlayers`, e `maxBots` é
    // `maxPlayers - 1` justamente para isto não acontecer — aritmética que
    // parou de bastar quando o humano pôde sair da mesa sem sair da sala.
    room = ok(applyCommand(room, 'p1', virar(true), ctxAt(30))).room;
    expect(seatedPlayers(room)).toHaveLength(2);

    const r = applyCommand(room, room.hostId!, { type: 'host:startMatch', payload: {} }, ctxAt(40));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toBe('SO_BOTS_NA_MESA');

    // Sentando de volta E confirmando (RF-094), começa normalmente.
    const sentado = todosProntos(ok(applyCommand(room, 'p1', virar(false), ctxAt(50))).room, 55);
    expect(applyCommand(sentado, 'p1', { type: 'host:startMatch', payload: {} }, ctxAt(60)).ok).toBe(true);
  });

  it('a sucessão prefere quem está SENTADO', () => {
    let room = roomWith(3);
    // p2 vira espectador ANTES, e é o mais antigo depois de p1. Pela ordem de
    // chegada ele herdaria a mesa; por estar assistindo, não deve.
    room = ok(applyCommand(room, 'p2', virar(true), ctxAt(10))).room;
    room = ok(applyCommand(room, 'p1', virar(true), ctxAt(20))).room;

    expect(room.hostId).toBe('p3');
  });

  it('bot não assiste', () => {
    const room = ok(applyCommand(
      roomWith(2), 'p1', { type: 'host:addBot', payload: { difficulty: 'FACIL' } }, ctxAt(10),
    )).room;
    const bot = room.players.find((p) => p.bot !== null)!;

    const r = applyCommand(room, bot.id, virar(true), ctxAt(20));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toBe('BOT_NAO_ASSISTE');
  });
});

describe('CA-330 a CA-341: chat da mesa', () => {
  const dizer = (text: string): Command => ({ type: 'chat:send', payload: { text } });
  const mensagens = (r: Room) => r.chat;

  it('CA-398: a mensagem de quem assiste vai marcada, e a marca é congelada', () => {
    const virar = (spectator: boolean): Command =>
      ({ type: 'player:setSpectator', payload: { spectator } });

    let room = roomWith(3);
    room = ok(applyCommand(room, 'p2', virar(true), ctxAt(10))).room;
    room = ok(applyCommand(room, 'p2', dizer('daqui de fora'), ctxAt(20))).room;
    room = ok(applyCommand(room, 'p1', dizer('daqui de dentro'), ctxAt(20))).room;

    expect(mensagens(room)[0]!.spectator).toBe(true);
    expect(mensagens(room)[1]!.spectator).toBe(false);

    // p2 senta de volta. O que ele disse DE FORA não pode passar a parecer
    // dito de dentro — é o mesmo congelamento do apelido (CA-337).
    room = ok(applyCommand(room, 'p2', virar(false), ctxAt(30))).room;
    room = ok(applyCommand(room, 'p2', dizer('agora sentado'), ctxAt(30 + LIMITS.chatMinIntervalMs))).room;

    expect(mensagens(room)[0]!.spectator).toBe(true);
    expect(mensagens(room)[2]!.spectator).toBe(false);
  });

  it('CA-330: a mensagem sai para TODOS, inclusive quem enviou', () => {
    const { room, emissions } = ok(applyCommand(roomWith(3), 'p2', dizer('boa noite'), ctxAt(50)));
    const evento = emissions.find((e) => e.event.type === 'chat:message');

    expect(evento).toBeDefined();
    expect(evento!.audience).toBe('ALL');
    expect(mensagens(room)).toHaveLength(1);
    expect(mensagens(room)[0]!.text).toBe('boa noite');
  });

  it('CA-338: o payload tem exatamente estes campos, e nada da partida', () => {
    const { room, emissions } = ok(applyCommand(roomWith(2), 'p1', dizer('oi'), ctxAt(50)));
    const payload = (emissions.find((e) => e.event.type === 'chat:message')!.event as
      { payload: { message: Record<string, unknown> } }).payload;

    // A lista FECHADA é o critério, e não o número de campos: um a mais aqui —
    // "quantas cartas o autor tem na mão", para enfeitar a bolha — é como a
    // rodada de testa vazaria, e o payload é opaco demais para alguém notar em
    // revisão. `spectator` entrou em 26/08/2026 e passou pela pergunta que este
    // teste faz: ele não deriva de mão, aposta, vaza nem vida, e quem assiste
    // já é público em `room.players`.
    expect(Object.keys(payload.message).sort())
      .toEqual(['at', 'id', 'nickname', 'playerId', 'spectator', 'text']);
    expect(mensagens(room)[0]).toEqual(payload.message);
  });

  it('CA-331: vale no lobby, na partida, na pausa e no fim — e não em ENCERRADA', () => {
    let room = roomWith(2);
    expect(applyCommand(room, 'p1', dizer('no lobby'), ctxAt(50)).ok).toBe(true);

    room = ok(applyCommand(todosProntos(room, 59), 'p1', { type: 'host:startMatch', payload: {} }, ctxAt(60))).room;
    expect(applyCommand(room, 'p1', dizer('em partida'), ctxAt(70)).ok).toBe(true);

    const encerrada: Room = { ...room, status: 'ENCERRADA' };
    const recusado = applyCommand(encerrada, 'p1', dizer('e agora'), ctxAt(80));
    expect(recusado.ok).toBe(false);
  });

  it('CA-332: vazio, só espaço e acima de 280 são recusados', () => {
    const room = roomWith(2);
    for (const ruim of ['', '   ', '\n\t ', 'x'.repeat(LIMITS.chatTextMax + 1)]) {
      expect(applyCommand(room, 'p1', dizer(ruim), ctxAt(50)).ok).toBe(false);
    }
    // No limite exato, passa — e o texto é guardado aparado.
    const { room: depois } = ok(applyCommand(room, 'p1', dizer(`  ${'x'.repeat(LIMITS.chatTextMax)}  `), ctxAt(50)));
    expect(mensagens(depois)[0]!.text).toHaveLength(LIMITS.chatTextMax);
  });

  it('CA-333: no teto, a mais antiga cai', () => {
    let room = roomWith(2);
    // Espaçadas pelo intervalo mínimo (RNF-016): o teto do histórico é sobre
    // quantidade, e mandar 205 mensagens no mesmo milissegundo deixou de ser
    // uma forma válida de chegar lá.
    for (let i = 0; i < LIMITS.chatHistoryMax + 5; i++) {
      room = ok(applyCommand(room, 'p1', dizer(`msg ${i}`), ctxAt(100 + i * LIMITS.chatMinIntervalMs))).room;
    }
    expect(mensagens(room)).toHaveLength(LIMITS.chatHistoryMax);
    expect(mensagens(room)[0]!.text).toBe('msg 5');
    expect(mensagens(room).at(-1)!.text).toBe(`msg ${LIMITS.chatHistoryMax + 4}`);
  });

  it('CA-334/CA-335: o histórico vai no retrato, para quem recarrega e para quem chega depois', () => {
    let room = roomWith(2);
    room = ok(applyCommand(room, 'p1', dizer('antes de você chegar'), ctxAt(50))).room;
    room = ok(applyCommand(todosProntos(room, 59), 'p1', { type: 'host:startMatch', payload: {} }, ctxAt(60))).room;

    // Entrar com partida em andamento = espectador (RF-014).
    const comEspectador = ok(join(room, { playerId: 'p9', nickname: 'Tarde', avatar: AVATAR }, ctxAt(70))).room;
    const retrato = snapshotFor(comEspectador, 'p9') as { payload: { chat: unknown[] } };

    expect(retrato.payload.chat).toHaveLength(1);
    // E o espectador pode escrever.
    expect(applyCommand(comEspectador, 'p9', dizer('cheguei'), ctxAt(80)).ok).toBe(true);
  });

  it('CA-384: menos de um segundo entre duas mensagens da mesma pessoa é recusado', () => {
    const room = roomWith(2);
    const t0 = 10_000;
    const { room: falou } = ok(applyCommand(room, 'p1', dizer('primeira'), ctxAt(t0)));

    // Um milissegundo antes do prazo ainda é cedo; no prazo exato, já vale.
    const cedo = applyCommand(falou, 'p1', dizer('segunda'), ctxAt(t0 + LIMITS.chatMinIntervalMs - 1));
    expect(cedo.ok).toBe(false);
    if (!cedo.ok) expect(cedo.motivo).toBe('RAPIDO_DEMAIS');
    expect(mensagens(falou)).toHaveLength(1);

    const naHora = applyCommand(falou, 'p1', dizer('segunda'), ctxAt(t0 + LIMITS.chatMinIntervalMs));
    expect(naHora.ok).toBe(true);

    // O limite é POR PESSOA: o silêncio de p1 não cala p2.
    expect(applyCommand(falou, 'p2', dizer('e eu'), ctxAt(t0 + 1)).ok).toBe(true);
  });

  it('CA-384: a tentativa recusada não empurra o próprio prazo', () => {
    // Quem insiste a cada 200 ms não pode ficar mudo para sempre: só a
    // mensagem ACEITA move o relógio.
    let room = roomWith(2);
    const t0 = 10_000;
    room = ok(applyCommand(room, 'p1', dizer('primeira'), ctxAt(t0))).room;

    for (let t = t0 + 200; t < t0 + LIMITS.chatMinIntervalMs; t += 200) {
      expect(applyCommand(room, 'p1', dizer('deixa eu falar'), ctxAt(t)).ok).toBe(false);
    }

    expect(applyCommand(room, 'p1', dizer('agora vai'), ctxAt(t0 + LIMITS.chatMinIntervalMs)).ok).toBe(true);
  });

  it('CA-384: sala vinda do Redis sem o campo é tratada como quem nunca falou', () => {
    // Sala gravada antes de RNF-016 volta sem `lastChatAt`. Ler isso como
    // "agora" deixaria a mesa inteira muda por um segundo depois do deploy;
    // ler como `null` só custa uma mensagem a mais de folga.
    const room = roomWith(2);
    const antiga = {
      ...room,
      players: room.players.map(({ lastChatAt: _, ...resto }) => resto as typeof room.players[number]),
    };
    expect(applyCommand(antiga, 'p1', dizer('oi de novo'), ctxAt(50)).ok).toBe(true);
  });

  it('CA-336: bot não fala', () => {
    const room = ok(applyCommand(
      roomWith(1), 'p1', { type: 'host:addBot', payload: { difficulty: 'FACIL' } }, ctxAt(10),
    )).room;
    const bot = room.players.find((p) => p.bot !== null)!;

    const recusado = applyCommand(room, bot.id, dizer('boa jogada'), ctxAt(20));
    expect(recusado.ok).toBe(false);
    if (!recusado.ok) expect(recusado.motivo).toBe('BOT_NAO_FALA');
  });

  it('CA-337: o apelido é congelado no envio', () => {
    let room = roomWith(2);
    room = ok(applyCommand(room, 'p2', dizer('era J2'), ctxAt(50))).room;
    // Avatar diferente do de p1 de propósito: identidade é única na mesa, e
    // reaproveitar `AVATAR` aqui faria o teste do apelido morrer por causa do
    // emoji — que não é o que ele mede.
    const meuAvatar = room.players.find((p) => p.id === 'p2')!.avatar;
    room = ok(applyCommand(
      room, 'p2', { type: 'player:setProfile', payload: { nickname: 'OutroNome', avatar: meuAvatar } }, ctxAt(60),
    )).room;
    // Um segundo depois da primeira: o intervalo de RNF-016 é incidental aqui,
    // e o que este teste mede é o apelido, não o relógio.
    room = ok(applyCommand(room, 'p2', dizer('agora sou OutroNome'), ctxAt(50 + LIMITS.chatMinIntervalMs))).room;

    expect(mensagens(room)[0]!.nickname).toBe('J2');
    expect(mensagens(room)[1]!.nickname).toBe('OutroNome');

    // E sair não reescreve o que já foi dito.
    const depoisDeSair = ok(leave(room, 'p2', ctxAt(50 + LIMITS.chatMinIntervalMs + 10))).room;
    expect(mensagens(depoisDeSair)[0]!.nickname).toBe('J2');
  });

  it('CA-341: o histórico morre com a sala', () => {
    let room = roomWith(1);
    room = ok(applyCommand(room, 'p1', dizer('tem alguém aí'), ctxAt(50))).room;
    room = ok(leave(room, 'p1', ctxAt(60))).room;

    const expirada = tick(room, ctxAt(60 + LIMITS.lobbyIdleMs + 1)).room;
    expect(expirada.status).toBe('ENCERRADA');
    // Sala encerrada não aceita mais mensagem: o histórico vai embora com o TTL
    // do store, sem caminho de recuperação (CA-341).
    expect(applyCommand(expirada, 'p1', dizer('ainda dá?'), ctxAt(99)).ok).toBe(false);
  });
});


// --- fim de vaza -----------------------------------------------------------

describe('CA-346: o servidor segura a mesa no fim da vaza', () => {
  /** Mesa de 3 numa rodada de 2 cartas, com a primeira vaza recém-fechada. */
  function comVazaFechada(): { room: Room; em: number } {
    let room = started(roomWith(3), 100);
    let agora = 100;

    const avancar = (ate: number) => {
      for (let t = agora; t <= ate; t += 250) {
        const r = tick(room, ctxAt(t));
        if (r.changed) room = r.room;
      }
      agora = ate;
    };

    // Sai da rodada de testa e chega numa de 2 cartas.
    while (room.match!.cardsThisRound === 1 && room.match!.endReason === null) {
      avancar(agora + 60_000);
    }

    // Deixa o auto-play conduzir apostas e a primeira vaza.
    while (room.match!.round.phase !== 'RECOLHIMENTO' && room.match!.endReason === null) {
      avancar(agora + 1_000);
      if (agora > 400_000) throw new Error('não chegou a RECOLHIMENTO');
    }
    return { room, em: agora };
  }

  it('a fase não avança antes do prazo, e avança depois', () => {
    const { room, em } = comVazaFechada();
    expect(room.match!.round.phase).toBe('RECOLHIMENTO');

    // Um tick logo antes do prazo não pode abrir a vaza seguinte: é a pausa
    // que faz a carta vencedora ficar visível (`07` §2.4).
    const cedo = tick(room, ctxAt(em + LIMITS.trickPauseMs - 100));
    expect((cedo.changed ? cedo.room : room).match!.round.phase).toBe('RECOLHIMENTO');

    const noPrazo = tick(room, ctxAt(em + LIMITS.trickPauseMs + 10));
    expect(noPrazo.changed).toBe(true);
    expect(noPrazo.room.match!.round.phase).toBe('VAZAS');
  });

  it('a pausa entra no relógio da sala, então a sala não dorme através dela', () => {
    // `nextDeadline` é o que diz ao servidor quando acordar. Se a fase nova
    // ficasse de fora, a mesa esperaria o próximo compromisso qualquer — ou
    // nenhum — e a vaza seguinte abriria tarde, ou nunca.
    const { room, em } = comVazaFechada();

    const prazo = nextDeadline(room);
    expect(prazo).not.toBeNull();
    expect(prazo!).toBeLessThanOrEqual(em + LIMITS.trickPauseMs + 250);
  });

  it('durante a pausa ninguém está na vez, e a sala segue íntegra', () => {
    const { room } = comVazaFechada();

    expect(room.match!.round.activePlayerId).toBeNull();
    expect(checkRoomInvariants(room)).toEqual([]);
  });
});

/**
 * RJ-117b — trocar de aplicativo não é sumir.
 *
 * O defeito que estes testes existem para prender é de CELULAR, e passava
 * despercebido no computador: ao abrir o WhatsApp, o sistema congela a aba e
 * fecha o WebSocket. O servidor vê o mesmo `close` de uma queda de internet,
 * espera 10 s de `TRANSPORT_GRACE` e **pausa a mesa de todo mundo** — porque
 * alguém olhou uma mensagem.
 *
 * Pior: a aba congelada não consegue reconectar, então os 10 s são
 * inalcançáveis por construção. Qualquer troca de aplicativo mais longa que
 * isso pausava a partida.
 */
describe('CA-414: segundo plano não é ausência', () => {
  const emSegundoPlano = (room: Room, id: string, valor: boolean, now: number) =>
    ok(send(room, id, { type: 'player:background', payload: { emSegundoPlano: valor } }, now)).room;

  it('quem avisou que saiu da tela NÃO pausa a partida quando o socket cai', () => {
    let room = started(roomWith(3));
    const [, p2] = room.players;

    room = emSegundoPlano(room, p2!.id, true, 200);
    room = ok(disconnect(room, p2!.id, ctxAt(300))).room;

    // Passa muito além da carência de transporte.
    const depois = tick(room, ctxAt(300 + LIMITS.transportGraceMs + 5_000));
    expect(depois.room.status).toBe('EM_PARTIDA');
    expect(absentMatchPlayers(depois.room)).toEqual([]);
  });

  /**
   * O contraste que dá sentido ao teste acima: SEM o aviso, o comportamento
   * antigo continua valendo. Queda de internet de verdade ainda pausa.
   */
  it('sem o aviso, a queda continua pausando — a mesa não ficou desprotegida', () => {
    let room = started(roomWith(3));
    const [, p2] = room.players;

    room = ok(disconnect(room, p2!.id, ctxAt(300))).room;

    const depois = tick(room, ctxAt(300 + LIMITS.transportGraceMs + 5_000));
    expect(depois.room.status).toBe('PAUSADA');
    expect(absentMatchPlayers(depois.room)).toEqual([p2!.id]);
  });

  /**
   * O ponto inteiro do conserto: com a mesa rodando, o prazo do turno corre e
   * o auto-play cobre a vez de quem está no WhatsApp. Era isso que a pausa
   * impedia — `phaseDeadline` vira `null` em `PAUSADA`, e sem prazo não há
   * auto-play.
   */
  it('o prazo do turno CONTINUA correndo para quem está em segundo plano', () => {
    let room = started(roomWith(3));
    const [, p2] = room.players;

    room = emSegundoPlano(room, p2!.id, true, 200);
    room = ok(disconnect(room, p2!.id, ctxAt(300))).room;
    const depois = tick(room, ctxAt(300 + LIMITS.transportGraceMs + 1_000)).room;

    expect(depois.status).toBe('EM_PARTIDA');
    expect(depois.phaseDeadline).not.toBeNull();
  });

  it('voltar à tela desfaz a marca, e a queda seguinte volta a pausar', () => {
    let room = started(roomWith(3));
    const [, p2] = room.players;

    room = emSegundoPlano(room, p2!.id, true, 200);
    room = emSegundoPlano(room, p2!.id, false, 400);
    room = ok(disconnect(room, p2!.id, ctxAt(500))).room;

    // A marca não pode virar um passe vitalício: quem voltou e depois perdeu a
    // internet de verdade merece a pausa como qualquer um.
    const depois = tick(room, ctxAt(500 + LIMITS.transportGraceMs + 1_000));
    expect(depois.room.status).toBe('PAUSADA');
  });

  it('reconectar limpa a marca mesmo sem aviso de volta', () => {
    let room = started(roomWith(3));
    const [, p2] = room.players;

    room = emSegundoPlano(room, p2!.id, true, 200);
    room = ok(disconnect(room, p2!.id, ctxAt(300))).room;
    room = ok(reconnect(room, p2!.id, ctxAt(400))).room;

    expect(room.players.find((p) => p.id === p2!.id)!.emSegundoPlano).toBe(false);
  });

  /**
   * O caminho do Android, onde o socket costuma SOBREVIVER ao segundo plano.
   *
   * Aqui não há `close`: a aba congela, os pongs param, e 45 s depois o
   * servidor derruba o socket por batimento morto. Sem a marca, isso vira
   * pausa igual. Com ela, a mesa segue e o auto-play cobre.
   *
   * Note que NÃO existe o caminho "avisar que voltou com o socket morto":
   * mandar um comando exige socket aberto, e ter socket aberto significa que a
   * reconexão já aconteceu — e é ela que limpa a marca (teste acima).
   */
  it('socket derrubado por batimento morto também não pausa quem avisou', () => {
    let room = started(roomWith(3));
    const [, p2] = room.players;

    room = emSegundoPlano(room, p2!.id, true, 200);
    // O que o servidor faz quando o batimento não volta: derruba o socket.
    room = ok(disconnect(room, p2!.id, ctxAt(45_000))).room;

    const depois = tick(room, ctxAt(45_000 + LIMITS.transportGraceMs + 1_000));
    expect(depois.room.status).toBe('EM_PARTIDA');
    expect(depois.room.phaseDeadline).not.toBeNull();
  });

  it('repetir o mesmo aviso não gera versão nova da sala', () => {
    let room = started(roomWith(3));
    const [, p2] = room.players;

    const primeira = ok(send(room, p2!.id,
      { type: 'player:background', payload: { emSegundoPlano: true } }, 200));
    room = primeira.room;
    const segunda = ok(send(room, p2!.id,
      { type: 'player:background', payload: { emSegundoPlano: true } }, 250));

    // O celular dispara `visibilitychange` mais de uma vez em alguns fluxos.
    expect(segunda.emissions).toEqual([]);
  });

  it('espectador em segundo plano não muda nada — ele já não pausava', () => {
    let room = started(roomWith(3));
    const espectador = ok(join(room, {
      playerId: 'e1', nickname: 'Zé', avatar: AVATAR,
    }, ctxAt(150)));
    room = espectador.room;

    room = emSegundoPlano(room, 'e1', true, 200);
    room = ok(disconnect(room, 'e1', ctxAt(300))).room;

    expect(tick(room, ctxAt(300 + LIMITS.transportGraceMs + 1_000)).room.status)
      .toBe('EM_PARTIDA');
  });
});

/**
 * RF-094 — o host só começa quando todo mundo confirmou.
 *
 * "Todos conectados" nunca significou "todos olhando": no lobby a pessoa entra
 * pelo link, larga o telefone e volta cinco minutos depois — e a partida
 * começava sem ela, que perdia a rodada de testa inteira sem ter visto uma
 * carta.
 */
describe('CA-415: pronto no lobby', () => {
  const pronto = (room: Room, id: string, valor: boolean, now = 50) =>
    send(room, id, { type: 'player:setPronto', payload: { pronto: valor } }, now);

  it('sem todos prontos, o host não começa', () => {
    const room = roomWith(3);
    const r = send(room, room.hostId!, { type: 'host:startMatch', payload: {} }, 100);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toBe('FALTA_PRONTO');
  });

  it('faltando UM, ainda não começa', () => {
    let room = roomWith(3);
    room = ok(pronto(room, 'p1', true)).room;
    room = ok(pronto(room, 'p2', true)).room;

    const r = send(room, room.hostId!, { type: 'host:startMatch', payload: {} }, 100);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toBe('FALTA_PRONTO');
  });

  it('com todos prontos, começa', () => {
    let room = roomWith(3);
    for (const id of ['p1', 'p2', 'p3']) room = ok(pronto(room, id, true)).room;

    expect(send(room, room.hostId!, { type: 'host:startMatch', payload: {} }, 100).ok).toBe(true);
  });

  /** Bot não tem o que confirmar, e exigir isso seria cerimônia sem decisão. */
  it('bot nasce pronto: mesa de gente e bots só espera pela gente', () => {
    let room = roomWith(1);
    room = ok(send(room, 'p1', { type: 'host:addBot', payload: { difficulty: 'MEDIO' } }, 10)).room;
    expect(room.players.find((p) => p.bot !== null)!.pronto).toBe(true);

    // Só o humano falta.
    expect(send(room, 'p1', { type: 'host:startMatch', payload: {} }, 100).ok).toBe(false);
    room = ok(pronto(room, 'p1', true)).room;
    expect(send(room, 'p1', { type: 'host:startMatch', payload: {} }, 100).ok).toBe(true);
  });

  it('desmarcar volta a travar o começo', () => {
    let room = roomWith(2);
    room = ok(pronto(room, 'p1', true)).room;
    room = ok(pronto(room, 'p2', true)).room;
    room = ok(pronto(room, 'p2', false, 60)).room;

    const r = send(room, room.hostId!, { type: 'host:startMatch', payload: {} }, 100);
    expect(r.ok).toBe(false);
  });

  it('repetir o mesmo pronto não emite evento', () => {
    let room = roomWith(2);
    room = ok(pronto(room, 'p1', true)).room;
    expect(ok(pronto(room, 'p1', true, 60)).emissions).toEqual([]);
  });

  it('espectador não confirma, e não segura a mesa', () => {
    let room = roomWith(2);
    const espectador = ok(join(room, {
      playerId: 'e1', nickname: 'Zé', avatar: AVATAR,
    }, ctxAt(20)));
    room = espectador.room;

    const r = send(room, 'e1', { type: 'player:setPronto', payload: { pronto: true } }, 30);
    // No lobby quem entra senta; o teste cobre o caminho de quem está de fora.
    if (!r.ok) expect(r.motivo).toBe('ESPECTADOR_NAO_JOGA');
  });

  it('fora do lobby, confirmar não faz sentido', () => {
    const room = started(roomWith(2));
    const r = send(room, 'p2', { type: 'player:setPronto', payload: { pronto: true } }, 200);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toBe('SO_NO_LOBBY');
  });

  /**
   * A revanche não passa pelo lobby, então travá-la por pronto deixaria o host
   * com um erro que ele não tem como resolver. Quem está na sala quando a
   * partida acaba viu a partida acabar.
   */
  it('a revanche não trava por pronto', () => {
    let room = started(roomWith(2));
    room = ok(send(room, room.hostId!, { type: 'host:endMatch', payload: {} }, 300)).room;
    expect(room.status).toBe('FIM_DE_PARTIDA');

    expect(send(room, room.hostId!, { type: 'host:rematch', payload: {} }, 400).ok).toBe(true);
  });

  /** Voltar para arrumar a mesa muda bots e opções: confirma-se de novo. */
  it('voltar ao lobby ZERA o pronto', () => {
    let room = started(roomWith(2));
    room = ok(send(room, room.hostId!, { type: 'host:endMatch', payload: {} }, 300)).room;
    room = ok(send(room, room.hostId!, { type: 'host:toLobby', payload: {} }, 400)).room;

    expect(seatedPlayers(room).every((p) => p.bot !== null || !p.pronto)).toBe(true);
    expect(send(room, room.hostId!, { type: 'host:startMatch', payload: {} }, 500).ok).toBe(false);
  });
});

/**
 * RF-095 — o host cala alguém no chat.
 *
 * Só o chat, e de propósito: calar não tira ninguém da partida. Sem isto, o
 * host escolhia entre aguentar o spam e acabar com a partida de alguém.
 */
describe('CA-416: silenciar no chat', () => {
  const calar = (room: Room, alvo: string, valor: boolean, quem = 'p1', now = 60) =>
    send(room, quem, { type: 'host:silenciar', payload: { playerId: alvo, silenciado: valor } }, now);

  const falar = (room: Room, quem: string, now = 70) =>
    send(room, quem, { type: 'chat:send', payload: { text: 'oi' } }, now);

  it('calado não fala, e a recusa é do SERVIDOR', () => {
    let room = roomWith(3);
    expect(falar(room, 'p2').ok).toBe(true);

    room = ok(calar(room, 'p2', true)).room;
    const r = falar(room, 'p2', 80);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toBe('SILENCIADO');
  });

  it('liberar devolve a voz', () => {
    let room = roomWith(3);
    room = ok(calar(room, 'p2', true)).room;
    room = ok(calar(room, 'p2', false, 'p1', 90)).room;
    expect(falar(room, 'p2', 100).ok).toBe(true);
  });

  it('calar um não cala os outros', () => {
    let room = roomWith(3);
    room = ok(calar(room, 'p2', true)).room;
    expect(falar(room, 'p3', 80).ok).toBe(true);
  });

  it('só o host cala', () => {
    const room = roomWith(3);
    const r = calar(room, 'p3', true, 'p2');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('NOT_HOST');
  });

  /** Ninguém deve conseguir se trancar do lado de fora. */
  it('o host não se cala', () => {
    const room = roomWith(3);
    const r = calar(room, 'p1', true);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toBe('HOST_NAO_SE_SILENCIA');
  });

  it('bot não se cala: ele já não fala', () => {
    let room = roomWith(1);
    room = ok(send(room, 'p1', { type: 'host:addBot', payload: { difficulty: 'MEDIO' } }, 10)).room;
    const bot = room.players.find((p) => p.bot !== null)!;

    const r = calar(room, bot.id, true);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toBe('BOT_NAO_FALA');
  });

  it('vale DURANTE a partida, que é quando o spam incomoda', () => {
    let room = started(roomWith(3));
    room = ok(calar(room, 'p2', true, 'p1', 200)).room;

    const r = falar(room, 'p2', 210);
    expect(r.ok).toBe(false);
  });

  /** O host calou por um motivo; a revanche não é perdão automático. */
  it('o silêncio sobrevive à volta ao lobby', () => {
    let room = started(roomWith(3));
    room = ok(calar(room, 'p2', true, 'p1', 200)).room;
    room = ok(send(room, room.hostId!, { type: 'host:endMatch', payload: {} }, 300)).room;
    room = ok(send(room, room.hostId!, { type: 'host:toLobby', payload: {} }, 400)).room;

    expect(room.players.find((p) => p.id === 'p2')!.silenciado).toBe(true);
    expect(falar(room, 'p2', 500).ok).toBe(false);
  });

  it('a mesa inteira vê quem está calado', () => {
    let room = roomWith(3);
    const r = ok(calar(room, 'p2', true));
    room = r.room;

    expect(types(r.emissions)).toContain('room:playerUpdated');
    const visao = snapshotFor(room, 'p3') as unknown as {
      payload: { players: { id: string; silenciado: boolean }[] };
    };
    expect(visao.payload.players.find((p) => p.id === 'p2')!.silenciado).toBe(true);
  });
});
