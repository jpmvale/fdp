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
  snapshotFor,
  tick,
  type Emission,
  type Room,
  type RoomCtx,
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

const started = (room: Room, now = 100): Room =>
  ok(send(room, room.hostId!, { type: 'host:startMatch', payload: {} }, now)).room;

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
    room = ok(applyCommand(room, 'p1', { type: 'host:startMatch', payload: {} }, ctxAt(20))).room;
    const recusado = applyCommand(room, 'p1', addBot('FACIL'), ctxAt(30));
    expect(recusado.ok).toBe(false);
  });
});

describe('CA-327: o bot joga sozinho quando é a vez dele', () => {
  it('uma partida de humano + 2 bots caminha só com o relógio', () => {
    let room = roomWith(1);
    room = ok(applyCommand(room, 'p1', { type: 'host:addBot', payload: { difficulty: 'MEDIO' } }, ctxAt(10))).room;
    room = ok(applyCommand(room, 'p1', { type: 'host:addBot', payload: { difficulty: 'FACIL' } }, ctxAt(11))).room;
    room = ok(applyCommand(room, 'p1', { type: 'host:startMatch', payload: {} }, ctxAt(20))).room;

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
    room = ok(applyCommand(room, 'p1', { type: 'host:startMatch', payload: {} }, ctxAt(20))).room;

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

describe('CA-330 a CA-341: chat da mesa', () => {
  const dizer = (text: string): Command => ({ type: 'chat:send', payload: { text } });
  const mensagens = (r: Room) => r.chat;

  it('CA-330: a mensagem sai para TODOS, inclusive quem enviou', () => {
    const { room, emissions } = ok(applyCommand(roomWith(3), 'p2', dizer('boa noite'), ctxAt(50)));
    const evento = emissions.find((e) => e.event.type === 'chat:message');

    expect(evento).toBeDefined();
    expect(evento!.audience).toBe('ALL');
    expect(mensagens(room)).toHaveLength(1);
    expect(mensagens(room)[0]!.text).toBe('boa noite');
  });

  it('CA-338: o payload tem exatamente os cinco campos, e nada da partida', () => {
    const { room, emissions } = ok(applyCommand(roomWith(2), 'p1', dizer('oi'), ctxAt(50)));
    const payload = (emissions.find((e) => e.event.type === 'chat:message')!.event as
      { payload: { message: Record<string, unknown> } }).payload;

    // A lista fechada é o critério: um campo a mais aqui — "quantas cartas o
    // autor tem na mão", para enfeitar a bolha — é como a rodada de testa
    // vazaria, e o payload é opaco demais para alguém notar em revisão.
    expect(Object.keys(payload.message).sort()).toEqual(['at', 'id', 'nickname', 'playerId', 'text']);
    expect(mensagens(room)[0]).toEqual(payload.message);
  });

  it('CA-331: vale no lobby, na partida, na pausa e no fim — e não em ENCERRADA', () => {
    let room = roomWith(2);
    expect(applyCommand(room, 'p1', dizer('no lobby'), ctxAt(50)).ok).toBe(true);

    room = ok(applyCommand(room, 'p1', { type: 'host:startMatch', payload: {} }, ctxAt(60))).room;
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
    for (let i = 0; i < LIMITS.chatHistoryMax + 5; i++) {
      room = ok(applyCommand(room, 'p1', dizer(`msg ${i}`), ctxAt(100 + i))).room;
    }
    expect(mensagens(room)).toHaveLength(LIMITS.chatHistoryMax);
    expect(mensagens(room)[0]!.text).toBe('msg 5');
    expect(mensagens(room).at(-1)!.text).toBe(`msg ${LIMITS.chatHistoryMax + 4}`);
  });

  it('CA-334/CA-335: o histórico vai no retrato, para quem recarrega e para quem chega depois', () => {
    let room = roomWith(2);
    room = ok(applyCommand(room, 'p1', dizer('antes de você chegar'), ctxAt(50))).room;
    room = ok(applyCommand(room, 'p1', { type: 'host:startMatch', payload: {} }, ctxAt(60))).room;

    // Entrar com partida em andamento = espectador (RF-014).
    const comEspectador = ok(join(room, { playerId: 'p9', nickname: 'Tarde', avatar: AVATAR }, ctxAt(70))).room;
    const retrato = snapshotFor(comEspectador, 'p9') as { payload: { chat: unknown[] } };

    expect(retrato.payload.chat).toHaveLength(1);
    // E o espectador pode escrever.
    expect(applyCommand(comEspectador, 'p9', dizer('cheguei'), ctxAt(80)).ok).toBe(true);
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
    room = ok(applyCommand(
      room, 'p2', { type: 'player:setProfile', payload: { nickname: 'OutroNome', avatar: AVATAR } }, ctxAt(60),
    )).room;
    room = ok(applyCommand(room, 'p2', dizer('agora sou OutroNome'), ctxAt(70))).room;

    expect(mensagens(room)[0]!.nickname).toBe('J2');
    expect(mensagens(room)[1]!.nickname).toBe('OutroNome');

    // E sair não reescreve o que já foi dito.
    const depoisDeSair = ok(leave(room, 'p2', ctxAt(80))).room;
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
