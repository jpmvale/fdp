/**
 * Identidade única na mesa: apelido, emoji e cor. Cobre CA-374 e CA-375.
 *
 * A regra existia em três lugares com três implementações — entrada, bot, e
 * nenhuma na edição de perfil. A que faltava era a que valia: bastava abrir o
 * perfil no lobby para a mesa ter dois "Ana" da mesma cor. Estes testes existem
 * para a regra ser UMA, e para cada caminho de entrada ser cobrado por ela.
 */

import { describe, expect, it } from 'vitest';
import { AVATAR_COLORS, AVATAR_EMOJIS, LIMITS, type Avatar, type Command } from '@fdp/protocol';
import {
  applyCommand, conflitosDe, createRoom, join,
  type Room, type RoomCtx,
} from '@fdp/room';

const AVATAR: Avatar = { emoji: '🦊', color: 'amber' };

function ctxAt(now: number): RoomCtx {
  let n = 0;
  return { now, randomSeed: () => 'seed', newId: () => `id-${++n}` };
}

const ok = <T extends { ok: boolean }>(r: T): Extract<T, { ok: true }> => {
  if (!r.ok) throw new Error(`rejeitado: ${JSON.stringify(r)}`);
  return r as Extract<T, { ok: true }>;
};

/** Todo mundo pedindo exatamente a mesma identidade. */
function salaComTodosIguais(quantos: number): Room {
  let room = createRoom('K7QMP', { playerId: 'p1', nickname: 'Ana', avatar: AVATAR }, ctxAt(0));
  for (let i = 2; i <= quantos; i++) {
    room = ok(join(room, { playerId: `p${i}`, nickname: 'Ana', avatar: AVATAR }, ctxAt(i))).room;
  }
  return room;
}

const emojis = (room: Room) => room.players.map((p) => p.avatar.emoji);
const cores = (room: Room) => room.players.map((p) => p.avatar.color);
const apelidos = (room: Room) => room.players.map((p) => p.nickname);

describe('CA-374: a entrada desempata sozinha', () => {
  it('oito pessoas pedindo a mesma coisa entram todas, e distintas', () => {
    const room = salaComTodosIguais(LIMITS.maxPlayers);

    expect(room.players).toHaveLength(8);
    // CA-006: ninguém é barrado por causa do que outro escolheu antes.
    expect(new Set(apelidos(room)).size).toBe(8);
    expect(new Set(emojis(room)).size).toBe(8);
    expect(new Set(cores(room)).size).toBe(8);
  });

  it('quem chega primeiro fica com o que pediu', () => {
    const room = salaComTodosIguais(3);
    const primeiro = room.players[0]!;
    expect(primeiro.nickname).toBe('Ana');
    expect(primeiro.avatar).toEqual(AVATAR);
  });

  it('só a metade que colide é trocada', () => {
    // p2 pede o emoji do p1 mas uma cor livre: a cor que ele escolheu fica.
    let room = createRoom('K7QMP', { playerId: 'p1', nickname: 'Ana', avatar: AVATAR }, ctxAt(0));
    room = ok(join(room, {
      playerId: 'p2', nickname: 'Beto', avatar: { emoji: '🦊', color: 'teal' },
    }, ctxAt(1))).room;

    const p2 = room.players[1]!;
    expect(p2.avatar.color).toBe('teal');
    expect(p2.avatar.emoji).not.toBe('🦊');
  });

  it('os bots também respeitam a regra', () => {
    let room = createRoom('K7QMP', { playerId: 'p1', nickname: 'Ana', avatar: AVATAR }, ctxAt(0));
    const sentar: Command = { type: 'host:addBot', payload: { difficulty: 'FACIL' } };
    for (let i = 0; i < LIMITS.maxBots; i++) {
      room = ok(applyCommand(room, 'p1', sentar, ctxAt(10 + i))).room;
    }

    expect(room.players).toHaveLength(8);
    expect(new Set(emojis(room)).size).toBe(8);
    expect(new Set(cores(room)).size).toBe(8);
    expect(new Set(apelidos(room)).size).toBe(8);
  });

  it('com mais gente que cores, o emoji é o que ainda separa (`04` §2)', () => {
    // 8 assentos + espectadores passam das 8 cores. A cor repete; o PAR não.
    let room = salaComTodosIguais(LIMITS.maxPlayers);
    room = { ...room, status: 'EM_PARTIDA' };
    for (let i = 9; i <= 11; i++) {
      room = ok(join(room, { playerId: `e${i}`, nickname: 'Ana', avatar: AVATAR }, ctxAt(i))).room;
    }

    expect(room.players).toHaveLength(11);
    expect(new Set(emojis(room)).size).toBe(11);
    const pares = room.players.map((p) => `${p.avatar.emoji}|${p.avatar.color}`);
    expect(new Set(pares).size).toBe(11);
  });
});

describe('CA-375: editar o perfil não rouba identidade', () => {
  const perfil = (nickname: string, avatar: Avatar): Command =>
    ({ type: 'player:setProfile', payload: { nickname, avatar } });

  it('o apelido de outra pessoa é recusado', () => {
    const room = salaComTodosIguais(2);
    const p1 = room.players[0]!;
    const p2 = room.players[1]!;

    const r = applyCommand(room, 'p2', perfil(p1.nickname, p2.avatar), ctxAt(50));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toBe('APELIDO_TOMADO');
  });

  it('o emoji de outra pessoa é recusado', () => {
    const room = salaComTodosIguais(2);
    const p1 = room.players[0]!;
    const p2 = room.players[1]!;

    const r = applyCommand(room, 'p2', perfil('Beto', { ...p2.avatar, emoji: p1.avatar.emoji }), ctxAt(50));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toBe('EMOJI_TOMADO');
  });

  it('a cor de outra pessoa é recusada', () => {
    const room = salaComTodosIguais(2);
    const p1 = room.players[0]!;
    const p2 = room.players[1]!;

    const r = applyCommand(room, 'p2', perfil('Beto', { ...p2.avatar, color: p1.avatar.color }), ctxAt(50));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toBe('COR_TOMADA');
  });

  it('trocar para o que está livre passa', () => {
    const room = salaComTodosIguais(2);
    const p1 = room.players[0]!;
    const livre = {
      emoji: AVATAR_EMOJIS.find((e) => !room.players.some((p) => p.avatar.emoji === e))!,
      color: AVATAR_COLORS.find((c) => !room.players.some((p) => p.avatar.color === c))!,
    };

    const r = ok(applyCommand(room, 'p2', perfil('Beto', livre), ctxAt(50)));
    const p2 = r.room.players.find((p) => p.id === 'p2')!;
    expect(p2.nickname).toBe('Beto');
    expect(p2.avatar).toEqual(livre);
    // E não mexeu em ninguém.
    expect(r.room.players[0]!.avatar).toEqual(p1.avatar);
  });

  it('manter a própria identidade não conta como conflito', () => {
    // O caso que uma checagem ingênua quebra: trocar só o apelido, mantendo o
    // próprio avatar, colidiria com o próprio jogador.
    const room = salaComTodosIguais(2);
    const p2 = room.players[1]!;

    const r = ok(applyCommand(room, 'p2', perfil('Beto', p2.avatar), ctxAt(50)));
    expect(r.room.players.find((p) => p.id === 'p2')!.nickname).toBe('Beto');
  });

  it('quem saiu da sala não segura mais identidade nenhuma', () => {
    let room = salaComTodosIguais(2);
    const p1 = room.players[0]!;
    room = ok(applyCommand(room, 'p1', { type: 'player:leave', payload: {} }, ctxAt(40))).room;

    const r = ok(applyCommand(room, 'p2', perfil(p1.nickname, p1.avatar), ctxAt(50)));
    expect(r.room.players.find((p) => p.id === 'p2')!.nickname).toBe(p1.nickname);
  });

  it('`conflitosDe` aponta exatamente o que colide', () => {
    const room = salaComTodosIguais(2);
    const p1 = room.players[0]!;
    const p2 = room.players[1]!;

    expect(conflitosDe(room, 'p2', p1.nickname, p2.avatar))
      .toEqual({ apelido: true, emoji: false, cor: false });
    expect(conflitosDe(room, 'p2', 'Beto', p1.avatar))
      .toEqual({ apelido: false, emoji: true, cor: true });
  });
});
