/**
 * CA-311: partidas completas com desconexões e decisões de ausência
 * aleatórias, verificando invariantes a cada passo.
 *
 * Este é o teste que prova que nenhuma sala fica presa em `PAUSADA` — o modo
 * de falha mais grave do produto (`00` §7) e o mais silencioso.
 */

import { describe, expect, it } from 'vitest';
import { LIMITS, type Avatar, type Command } from '@fdp/protocol';
import {
  applyCommand,
  checkRoomInvariants,
  createRoom,
  disconnect,
  join,
  nextDeadline,
  reconnect,
  seatedPlayers,
  tick,
  type Room,
  type RoomCtx,
} from '@fdp/room';

const AVATAR: Avatar = { emoji: '🦊', color: 'amber' };

/**
 * Todo mundo dá pronto antes de começar (RF-094).
 *
 * O teste de propriedade sorteia quedas e decisões, mas o começo da partida é
 * determinístico: sem isto, todas as mil sementes falhariam em `FALTA_PRONTO`
 * e o teste provaria só que a regra nova existe.
 */
function todosProntos(room: Room, now: number, ctx: (n: number) => RoomCtx): Room {
  return seatedPlayers(room)
    .filter((p) => p.bot === null && !p.pronto)
    .reduce((r, p) => {
      const res = applyCommand(r, p.id, { type: 'player:setPronto', payload: { pronto: true } }, ctx(now));
      return res.ok ? res.room : r;
    }, room);
}

/** LCG simples e determinístico: o caso falho é reproduzível pelo seed. */
function lcg(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1103515245) + 12345) >>> 0;
    return state / 0x100000000;
  };
}

function ctxAt(now: number, seed: string): RoomCtx {
  let counter = 0;
  return { now, randomSeed: () => seed, newId: () => `m-${seed}-${++counter}` };
}

interface Outcome {
  ended: boolean;
  pausedEver: boolean;
  stuckInPause: boolean;
  violations: string[];
  finalStatus: Room['status'];
}

function simulate(seed: number, playerCount: number): Outcome {
  const rand = lcg(seed);
  const seedStr = `prop-${seed}`;
  let now = 0;
  let room = createRoom('K7QMP', { playerId: 'p1', nickname: 'Ana', avatar: AVATAR }, ctxAt(now, seedStr));

  for (let i = 2; i <= playerCount; i++) {
    now += 10;
    const result = join(room, { playerId: `p${i}`, nickname: `J${i}`, avatar: AVATAR }, ctxAt(now, seedStr));
    if (result.ok) room = result.room;
  }

  const violations: string[] = [];
  const audit = (): void => {
    violations.push(...checkRoomInvariants(room));
  };

  now += 100;
  const start = applyCommand(todosProntos(room, now, (n) => ctxAt(n, seedStr)), room.hostId!, { type: 'host:startMatch', payload: {} }, ctxAt(now, seedStr));
  if (!start.ok) throw new Error(`startMatch falhou: ${start.motivo}`);
  room = start.room;
  audit();

  let pausedEver = false;
  const offline = new Set<string>();

  for (let step = 0; step < 6000; step++) {
    if (room.status === 'FIM_DE_PARTIDA' || room.status === 'ENCERRADA') break;
    if (room.status === 'PAUSADA') pausedEver = true;

    const roll = rand();

    // Derruba alguém de vez em quando.
    if (roll < 0.03 && offline.size < playerCount - 1) {
      const candidates = room.players.filter((p) => !offline.has(p.id) && p.connection === 'CONECTADO');
      const victim = candidates[Math.floor(rand() * candidates.length)];
      if (victim) {
        const result = disconnect(room, victim.id, ctxAt(now, seedStr));
        if (result.ok) { room = result.room; offline.add(victim.id); }
      }
    } else if (roll < 0.07 && offline.size > 0) {
      // E às vezes traz de volta.
      const victim = [...offline][Math.floor(rand() * offline.size)]!;
      const result = reconnect(room, victim, ctxAt(now, seedStr));
      if (result.ok) { room = result.room; offline.delete(victim); }
    }
    audit();

    // O host decide, quando pode e quando lembra.
    if (room.status === 'PAUSADA' && room.pause && now >= room.pause.decisionUnlockedAt && rand() < 0.25) {
      const action: 'CONTINUAR_SEM' | 'ENCERRAR' = rand() < 0.8 ? 'CONTINUAR_SEM' : 'ENCERRAR';
      const command: Command = { type: 'host:resolveAbsence', payload: { action } };
      const result = applyCommand(room, room.hostId!, command, ctxAt(now, seedStr));
      if (result.ok) {
        room = result.room;
        for (const id of absentIds(room)) offline.delete(id);
        // Retirados saem do conjunto de offline: não voltam mais.
        for (const w of room.match?.withdrawn ?? []) offline.delete(w.playerId);
      }
      audit();
    }

    // Avança o relógio até o próximo compromisso, com um empurrão para não
    // travar quando não há nada agendado.
    const deadline = nextDeadline(room);
    now = deadline !== null && deadline > now ? deadline + 1 : now + 1000;

    const ticked = tick(room, ctxAt(now, seedStr));
    room = ticked.room;
    audit();
  }

  return {
    ended: room.status === 'FIM_DE_PARTIDA' || room.status === 'ENCERRADA',
    pausedEver,
    stuckInPause: room.status === 'PAUSADA',
    violations,
    finalStatus: room.status,
  };
}

function absentIds(room: Room): string[] {
  return room.players.filter((p) => p.connection === 'DESCONECTADO').map((p) => p.id);
}

describe('CA-311: propriedade da sala sob desconexão', () => {
  it('300 partidas com quedas aleatórias terminam sem violar invariante', () => {
    let ended = 0;
    let paused = 0;

    for (let seed = 1; seed <= 300; seed++) {
      const playerCount = 2 + (seed % 7);
      let outcome: Outcome;
      try {
        outcome = simulate(seed, playerCount);
      } catch (error) {
        throw new Error(`seed ${seed} (${playerCount} jogadores): ${String(error)}`);
      }

      if (outcome.violations.length > 0) {
        throw new Error(
          `seed ${seed} (${playerCount} jogadores) violou: ${[...new Set(outcome.violations)].slice(0, 3).join('; ')}`,
        );
      }

      // A trava de RJ-157 garante que nenhuma pausa é eterna.
      expect(outcome.stuckInPause, `seed ${seed} ficou preso em PAUSADA`).toBe(false);
      expect(outcome.ended, `seed ${seed} não terminou`).toBe(true);

      if (outcome.ended) ended++;
      if (outcome.pausedEver) paused++;
    }

    expect(ended).toBe(300);
    // O corpus precisa exercitar a pausa de verdade, senão não prova nada.
    expect(paused).toBeGreaterThan(50);
  }, 120_000);

  it('a pausa nunca sobrevive ao PAUSE_MAX, mesmo sem ninguém decidir', () => {
    let room = createRoom('K7QMP', { playerId: 'p1', nickname: 'Ana', avatar: AVATAR }, ctxAt(0, 's'));
    for (const id of ['p2', 'p3']) {
      room = (join(room, { playerId: id, nickname: id, avatar: AVATAR }, ctxAt(10, 's')) as { room: Room }).room;
    }
    const start = applyCommand(todosProntos(room, 100, (n) => ctxAt(n, 's')), 'p1', { type: 'host:startMatch', payload: {} }, ctxAt(100, 's'));
    if (!start.ok) throw new Error('falhou');
    room = start.room;

    const dropped = disconnect(room, 'p2', ctxAt(200, 's'));
    if (!dropped.ok) throw new Error('falhou');
    room = dropped.room;

    // Ninguém reconecta, ninguém decide: o relógio resolve sozinho.
    room = tick(room, ctxAt(200 + LIMITS.transportGraceMs + 1, 's')).room;
    expect(room.status).toBe('PAUSADA');

    room = tick(room, ctxAt(room.pause!.hardDeadline + 1, 's')).room;
    expect(room.status).toBe('FIM_DE_PARTIDA');
    expect(checkRoomInvariants(room)).toEqual([]);
  });
});
