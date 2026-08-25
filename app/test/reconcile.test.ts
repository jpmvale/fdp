/**
 * `05` §3 — reconciliação e resync. Cobre CA-043.
 */

import { describe, expect, it } from 'vitest';
import { createReconciler } from '../src/net/reconcile.js';

const frame = (type: string, stateVersion: number) => ({ type, stateVersion });

describe('reconciliação: sequência normal', () => {
  it('o snapshot é adotado inteiro e fixa a versão local', () => {
    const r = createReconciler();
    expect(r.version).toBe(0);

    expect(r.receive(frame('room:snapshot', 42))).toEqual({ action: 'APPLY', version: 42 });
    expect(r.version).toBe(42);
  });

  it('evento na sequência é aplicado e avança a versão', () => {
    const r = createReconciler();
    r.receive(frame('room:snapshot', 7));

    expect(r.receive(frame('move:betPlaced', 8))).toEqual({ action: 'APPLY', version: 8 });
    expect(r.receive(frame('move:cardPlayed', 9))).toEqual({ action: 'APPLY', version: 9 });
    expect(r.version).toBe(9);
  });

  it('vários eventos do mesmo commit chegam com a mesma versão e todos aplicam', () => {
    // `host:startMatch` emite status, partida, rodada e fase numa tacada só —
    // um `commit`, um incremento de versão, quatro eventos.
    const r = createReconciler();
    r.receive(frame('room:snapshot', 4));

    for (const type of ['room:statusChanged', 'match:started', 'round:started', 'round:phaseChanged']) {
      expect(r.receive(frame(type, 5))).toEqual({ action: 'APPLY', version: 5 });
    }
    expect(r.version).toBe(5);
  });

  it('ack e error não mexem na versão local', () => {
    const r = createReconciler();
    r.receive(frame('room:snapshot', 3));

    expect(r.receive(frame('ack', 9))).toEqual({ action: 'DISCARD', reason: 'CONTROL' });
    expect(r.receive(frame('error', 0))).toEqual({ action: 'DISCARD', reason: 'CONTROL' });
    expect(r.version).toBe(3);
  });
});

describe('reconciliação: descarte', () => {
  it('evento de versão anterior é descartado', () => {
    const r = createReconciler();
    r.receive(frame('room:snapshot', 10));

    expect(r.receive(frame('move:betPlaced', 9))).toEqual({ action: 'DISCARD', reason: 'STALE' });
    expect(r.version).toBe(10);
  });
});

describe('CA-043: buraco de versão vira resync', () => {
  it('evento adiantado pede resync e não avança a versão', () => {
    const r = createReconciler();
    r.receive(frame('room:snapshot', 5));

    expect(r.receive(frame('move:cardPlayed', 8))).toEqual({ action: 'RESYNC', missing: 2 });
    expect(r.version).toBe(5);
    expect(r.resyncing).toBe(true);
  });

  it('CA-043: um cliente em N que recebe N+2 converge para o estado do servidor', () => {
    const r = createReconciler();
    r.receive(frame('room:snapshot', 20));

    // O buraco é detectado uma vez; o que chega depois não constrói sobre base furada.
    expect(r.receive(frame('trick:resolved', 22))).toEqual({ action: 'RESYNC', missing: 1 });
    expect(r.receive(frame('round:phaseChanged', 23))).toEqual({ action: 'DISCARD', reason: 'STALE' });
    expect(r.resyncing).toBe(true);

    // O snapshot pedido chega e o cliente adota o estado do servidor.
    expect(r.receive(frame('room:snapshot', 23))).toEqual({ action: 'APPLY', version: 23 });
    expect(r.resyncing).toBe(false);
    expect(r.version).toBe(23);

    // E a sequência normal volta a valer.
    expect(r.receive(frame('move:betPlaced', 24))).toEqual({ action: 'APPLY', version: 24 });
  });

  it('não pede resync duas vezes pelo mesmo buraco', () => {
    const r = createReconciler();
    r.receive(frame('room:snapshot', 1));

    const decisions = [5, 6, 7].map((v) => r.receive(frame('move:betPlaced', v)).action);
    expect(decisions).toEqual(['RESYNC', 'DISCARD', 'DISCARD']);
  });
});

describe('reconciliação: socket novo', () => {
  it('reset zera a versão — reconectar é um resync (RF-010)', () => {
    const r = createReconciler();
    r.receive(frame('room:snapshot', 30));
    r.receive(frame('move:betPlaced', 33)); // buraco pendente

    r.reset();
    expect(r.version).toBe(0);
    expect(r.resyncing).toBe(false);

    // Sem caminho separado de recuperação: o snapshot do handshake resolve.
    expect(r.receive(frame('room:snapshot', 33))).toEqual({ action: 'APPLY', version: 33 });
  });
});
