/**
 * O hub: registro de salas vivas, sockets e o **ponto único de escrita**.
 *
 * Tudo que muda uma sala passa por `commit`. Isso é o que dá sentido à regra de
 * `11` §5 — mutação de sala não contém `await`: aqui dentro não existe nenhum,
 * e por isso o laço de eventos do Node garante atomicidade sem lock, sem CAS e
 * sem retry. A persistência é agendada, nunca aguardada.
 */

import { randomUUID } from 'node:crypto';
import type { WebSocket } from 'ws';
import { PROTOCOL_VERSION, CLOSE_CODES, type ErrorPayload, type ServerEvent } from '@fdp/protocol';
import {
  nextDeadline,
  tick,
  type Emission,
  type Room,
  type RoomCtx,
  type RoomResult,
} from '@fdp/room';
import type { PlayerId } from '@fdp/rules';
import type { Persistence } from './persistence.js';

export interface Hub {
  get(code: string): Room | undefined;
  /** Registra uma sala nova (criação ou recarga na subida). */
  adopt(room: Room): void;
  /** Aplica um resultado da camada de sala: grava, entrega e agenda. */
  commit(result: RoomResult): void;
  attach(code: string, playerId: PlayerId, socket: WebSocket): void;
  detach(code: string, playerId: PlayerId, socket: WebSocket): void;
  socketOf(code: string, playerId: PlayerId): WebSocket | undefined;
  send(socket: WebSocket | undefined, event: ServerEvent, stateVersion: number): void;
  sendError(socket: WebSocket | undefined, payload: ErrorPayload, stateVersion: number): void;
  ctx(): RoomCtx;
  /** Um passo do relógio de `03` §2.1. Separado do timer para ser testável. */
  advance(now: number): void;
  /** RNF-065: fecha tudo pedindo reconexão. */
  closeAll(code: number): void;
  readonly roomCount: number;
}

export interface HubOptions {
  persistence: Persistence;
  now?: () => number;
  randomSeed: () => string;
  newId?: () => string;
}

export function createHub({
  persistence,
  now = Date.now,
  randomSeed,
  newId = randomUUID,
}: HubOptions): Hub {
  const rooms = new Map<string, Room>();
  const sockets = new Map<string, Map<PlayerId, WebSocket>>();

  const send: Hub['send'] = (socket, event, stateVersion) => {
    if (!socket || socket.readyState !== socket.OPEN) return;
    socket.send(JSON.stringify({ v: PROTOCOL_VERSION, id: newId(), ts: now(), stateVersion, ...event }));
  };

  const deliver = (room: Room, emissions: Emission[]): void => {
    const peers = sockets.get(room.code);
    if (!peers || emissions.length === 0) return;
    for (const emission of emissions) {
      if (emission.audience === 'ALL') {
        for (const socket of peers.values()) send(socket, emission.event, room.stateVersion);
      } else {
        send(peers.get(emission.audience.playerId), emission.event, room.stateVersion);
      }
    }
  };

  /** Sala encerrada some do processo e do store: não volta num reinício. */
  const retire = (code: string): void => {
    rooms.delete(code);
    sockets.delete(code);
    persistence.forget(code);
  };

  const settle = (room: Room, emissions: Emission[]): void => {
    rooms.set(room.code, room);
    deliver(room, emissions);
    if (room.status === 'ENCERRADA') retire(room.code);
    else persistence.schedule(room);
  };

  return {
    get: (code) => rooms.get(code),

    adopt(room) {
      rooms.set(room.code, room);
      if (!sockets.has(room.code)) sockets.set(room.code, new Map());
      persistence.schedule(room);
    },

    commit(result) {
      if (!result.ok) return;
      settle(result.room, result.emissions);
    },

    attach(code, playerId, socket) {
      const peers = sockets.get(code) ?? new Map<PlayerId, WebSocket>();
      peers.set(playerId, socket);
      sockets.set(code, peers);
    },

    detach(code, playerId, socket) {
      // Só desregistra se ainda for o socket corrente: um `close` atrasado do
      // socket antigo não pode derrubar o registro do novo (CA-044).
      if (sockets.get(code)?.get(playerId) === socket) sockets.get(code)?.delete(playerId);
    },

    socketOf: (code, playerId) => sockets.get(code)?.get(playerId),

    send,

    sendError(socket, payload, stateVersion) {
      send(socket, { type: 'error', payload }, stateVersion);
    },

    ctx: () => ({ now: now(), randomSeed, newId }),

    advance(at) {
      for (const [code, room] of [...rooms]) {
        // Só acorda quem tem compromisso vencido — não varre à toa.
        const deadline = nextDeadline(room);
        if (deadline !== null && at < deadline) continue;

        const result = tick(room, { now: at, randomSeed, newId });
        if (!result.changed) continue;
        if (rooms.get(code) !== room) continue; // sala já saiu debaixo do laço
        settle(result.room, result.emissions);
      }
    },

    closeAll(code) {
      for (const peers of sockets.values()) {
        for (const socket of peers.values()) {
          if (socket.readyState === socket.OPEN) socket.close(code, 'reconecte');
        }
      }
    },

    get roomCount() {
      return rooms.size;
    },
  };
}

export { CLOSE_CODES };
