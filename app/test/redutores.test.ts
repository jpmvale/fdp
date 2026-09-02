/**
 * Equivalência dos redutores com o retrato do servidor.
 *
 * Este é o teste que torna os redutores seguros. Um redutor errado não quebra:
 * ele diverge em silêncio, e a tela fica *plausível* — mostrando uma vaza que
 * não aconteceu, ou uma carta que já foi jogada. Nenhum teste de unidade por
 * evento pega isso, porque cada um passa sozinho.
 *
 * Então a régua é a única que importa: joga uma partida inteira na sala de
 * verdade e, depois de cada comando, compara o estado reduzido com
 * `snapshotFor` — o que o servidor mandaria. Qualquer divergência, em qualquer
 * campo, derruba o teste.
 */

import { describe, expect, it } from 'vitest';
import { LIMITS, type Avatar, type Command } from '@fdp/protocol';
import {
  applyCommand, createRoom, join, snapshotFor, tick,
  type Emission, type Room, type RoomCtx,
} from '@fdp/room';
import { reduzir } from '../src/state/redutores';
import type { Retrato } from '../src/state/tipos';

const AVATAR: Avatar = { emoji: '🦊', color: 'amber' };

function ctxAt(now: number, seq = { n: 0 }): RoomCtx {
  return { now, randomSeed: () => `seed-${now}`, newId: () => `id-${++seq.n}` };
}

const ok = <T extends { ok: boolean }>(r: T): Extract<T, { ok: true }> => {
  if (!r.ok) throw new Error(`rejeitado: ${JSON.stringify(r)}`);
  return r as Extract<T, { ok: true }>;
};

const retratoDe = (room: Room, viewer: string): Retrato =>
  (snapshotFor(room, viewer) as { payload: Retrato }).payload;

/** As emissões que chegam a este jogador, na ordem. */
const para = (emissions: Emission[], viewer: string) =>
  emissions.filter((e) => e.audience === 'ALL' || e.audience.playerId === viewer).map((e) => e.event);

describe('CA-342: o estado reduzido não diverge do retrato do servidor', () => {
  it('uma partida inteira, comando a comando, para todos os jogadores', () => {
    const seq = { n: 0 };
    let agora = 0;
    const passo = () => ctxAt((agora += 1000), seq);

    let room = createRoom('K7QMP', { playerId: 'p1', nickname: 'Ana', avatar: AVATAR }, passo());
    room = ok(join(room, { playerId: 'p2', nickname: 'Beto', avatar: AVATAR }, passo())).room;
    room = ok(join(room, { playerId: 'p3', nickname: 'Duda', avatar: AVATAR }, passo())).room;

    const jogadores = ['p1', 'p2', 'p3'];
    // Cada jogador tem o seu retrato local, como teria no navegador.
    const local = new Map(jogadores.map((id) => [id, retratoDe(room, id)]));

    let reduzidos = 0;
    let resyncs = 0;

    /** Aplica um lote de emissões e confere contra o servidor. */
    const aplicar = (emissions: Emission[], depois: Room) => {
      for (const viewer of jogadores) {
        let estado = local.get(viewer)!;
        for (const evento of para(emissions, viewer)) {
          if (evento.type === 'room:snapshot') { estado = (evento as { payload: Retrato }).payload; continue; }
          const r = reduzir(estado, { ...evento, stateVersion: depois.stateVersion });
          if (r) { estado = r; reduzidos++; }
          else { estado = retratoDe(depois, viewer); resyncs++; }
        }
        local.set(viewer, estado);

        // A régua: depois do lote, o local tem de ser exatamente o do servidor.
        expect(estado).toEqual(retratoDe(depois, viewer));
      }
    };

    const comando = (autor: string, cmd: Command) => {
      const r = ok(applyCommand(room, autor, cmd, passo()));
      room = r.room;
      aplicar(r.emissions, room);
    };

    const relogio = () => {
      const r = tick(room, ctxAt((agora += 4000), seq));
      if (r.changed) { room = r.room; aplicar(r.emissions, room); }
    };

    comando('p1', { type: 'chat:send', payload: { text: 'bora' } });
    // RF-094: todo mundo confirma antes de o host começar.
    for (const id of ['p1', 'p2', 'p3']) {
      comando(id, { type: 'player:setPronto', payload: { pronto: true } });
    }
    comando('p1', { type: 'host:startMatch', payload: {} });
    relogio();

    // Joga até acabar, ou até 400 passos — o que vier primeiro.
    for (let i = 0; i < 400 && room.match?.endReason === null; i++) {
      const m = room.match;
      if (!m) break;
      const daVez = m.round.activePlayerId;

      if (daVez === null) { relogio(); continue; }

      const visao = local.get(daVez)!.match!;
      if (visao.phase === 'APOSTAS') {
        let v = 0;
        while (v === visao.forbiddenBet) v++;
        comando(daVez, {
          type: 'move:bet',
          payload: { matchId: visao.matchId, roundNumber: visao.roundNumber, trickNumber: visao.trickNumber, bet: v },
        });
      } else if (visao.phase === 'VAZAS' && visao.hand.length > 0) {
        comando(daVez, {
          type: 'move:playCard',
          payload: {
            matchId: visao.matchId, roundNumber: visao.roundNumber,
            trickNumber: visao.trickNumber, cardId: visao.hand[0]!.id,
          },
        });
      } else {
        relogio();
      }

      if (i % 7 === 0) comando(daVez, { type: 'chat:send', payload: { text: `jogada ${i}` } });
    }

    expect(room.match?.endReason).not.toBeNull();
    // Se nada foi reduzido, o teste passaria por acidente — resync sempre bate.
    expect(reduzidos).toBeGreaterThan(0);

    // Registrado para a próxima pessoa saber o que esperar, e para uma queda
    // brusca aqui virar sinal em vez de surpresa.
    const proporcao = reduzidos / (reduzidos + resyncs);
    expect(proporcao).toBeGreaterThan(0.75);
  });
});

describe('CA-343: em dúvida, o redutor pede o retrato', () => {
  const base = (): Retrato => ({
    code: 'K7QMP', status: 'LOBBY', hostId: 'p1', options: {} as never,
    stateVersion: 1, players: [], pause: null, phaseDeadline: null, chat: [], match: null,
  });

  it('evento desconhecido não é aplicado às cegas', () => {
    expect(reduzir(base(), { type: 'algo:que:nao:existe', payload: {} })).toBeNull();
  });

  it('as transições estruturais pedem o retrato', () => {
    for (const type of [
      'match:started', 'round:started', 'round:dealt', 'round:resolved',
      'match:ended', 'match:paused', 'match:resumed', 'round:aborted', 'room:statusChanged',
    ]) {
      expect(reduzir(base(), { type, payload: {} })).toBeNull();
    }
  });

  it('jogada sem partida, ou carta sem vaza corrente, pedem o retrato', () => {
    expect(reduzir(base(), { type: 'move:betPlaced', payload: { betsSoFar: {} } })).toBeNull();
    const comPartida = { ...base(), match: { currentTrick: null } as never };
    expect(reduzir(comPartida, { type: 'move:cardPlayed', payload: { playerId: 'p1' } })).toBeNull();
  });

  it('o chat respeita o teto do histórico', () => {
    let r = base();
    for (let i = 0; i < LIMITS.chatHistoryMax + 3; i++) {
      r = reduzir(r, {
        type: 'chat:message',
        payload: { message: { id: `m${i}`, playerId: 'p1', nickname: 'Ana', text: `${i}`, at: i } },
      })!;
    }
    expect(r.chat).toHaveLength(LIMITS.chatHistoryMax);
    expect(r.chat[0]!.text).toBe('3');
  });
});
