/**
 * O que sai da mão sem ninguém tocar (`07` §2.4, `02` §3.7).
 *
 * Vale testar porque erra silencioso: uma carta que sai sozinha na hora errada
 * não dá erro em lugar nenhum — o servidor aceita, a rodada segue, e quem
 * jogou só descobre olhando a mesa.
 */

import { describe, expect, it } from 'vitest';
import { ESPERA_ULTIMA_CARTA, jogadaAutomatica, type PreJogada } from '../src/jogada';
import type { Card } from '@fdp/rules';

const carta = (id: string): Card =>
  ({ id, value: 7, rank: '7', suit: 'PAUS', deckIndex: 0 }) as unknown as Card;

const mesa = (over: Partial<{
  phase: string; activePlayerId: string | null; hand: Card[];
  roundNumber: number; trickNumber: number;
}> = {}) => ({
  phase: 'VAZAS',
  activePlayerId: 'eu',
  hand: [carta('c1'), carta('c2'), carta('c3')],
  roundNumber: 3,
  trickNumber: 2,
  ...over,
} as Parameters<typeof jogadaAutomatica>[0]);

const gatilho = (over: Partial<PreJogada> = {}): PreJogada => ({
  cardId: 'c2', roundNumber: 3, trickNumber: 2, ...over,
});

describe('CA-357: a carta engatilhada sai quando a vez chega', () => {
  it('fora da minha vez, nada sai', () => {
    const d = jogadaAutomatica(mesa({ activePlayerId: 'outro' }), 'eu', false, gatilho());
    expect(d.acao).toBe('nada');
  });

  it('na minha vez, a engatilhada sai na hora', () => {
    const d = jogadaAutomatica(mesa(), 'eu', false, gatilho());
    expect(d).toEqual({ acao: 'jogar', cardId: 'c2', atrasoMs: 0 });
  });

  it('sem gatilho, nada sai sozinho', () => {
    expect(jogadaAutomatica(mesa(), 'eu', false, null).acao).toBe('nada');
  });

  it('mesa pausada não recebe jogada', () => {
    expect(jogadaAutomatica(mesa(), 'eu', true, gatilho()).acao).toBe('nada');
  });

  it('fora da fase de vazas, nada sai', () => {
    expect(jogadaAutomatica(mesa({ phase: 'APOSTAS' }), 'eu', false, gatilho()).acao).toBe('nada');
  });

  it('a carta engatilhada saiu da mão: o gatilho é esquecido, não enviado', () => {
    const d = jogadaAutomatica(mesa({ hand: [carta('c1')] , }), 'eu', false, gatilho({ cardId: 'c9' }));
    // Mão de uma carta cai na regra da última carta antes; então uma mão maior:
    const d2 = jogadaAutomatica(
      mesa({ hand: [carta('c1'), carta('c3')] }),
      'eu', false, gatilho({ cardId: 'c9' }),
    );
    expect(d2).toEqual({ acao: 'esquecer' });
    expect(d.acao).toBe('jogar'); // a de uma carta só é outra regra
  });

  /**
   * O defeito que este teste existe para prender: o gatilho guardava só o
   * `cardId`. O baralho é redistribuído a cada rodada e o mesmo id volta a
   * existir noutra mão — um gatilho esquecido dispararia sozinho numa carta
   * que o jogador nunca escolheu.
   */
  it('gatilho de outra rodada não dispara', () => {
    const d = jogadaAutomatica(mesa(), 'eu', false, gatilho({ roundNumber: 2 }));
    expect(d).toEqual({ acao: 'esquecer' });
  });

  it('gatilho de outra mão da mesma rodada não dispara', () => {
    const d = jogadaAutomatica(mesa(), 'eu', false, gatilho({ trickNumber: 1 }));
    expect(d).toEqual({ acao: 'esquecer' });
  });
});

describe('CA-358: a última carta sai sozinha, mas não num piscar', () => {
  it('uma carta na mão, na minha vez: sai sozinha', () => {
    const d = jogadaAutomatica(mesa({ hand: [carta('c7')] }), 'eu', false, null);
    expect(d).toEqual({ acao: 'jogar', cardId: 'c7', atrasoMs: ESPERA_ULTIMA_CARTA });
  });

  it('com pausa suficiente para a mesa acompanhar', () => {
    // `07` §2.4 pede 1,5 a 3 s de leitura. Sair na hora seria a mão inteira
    // resolvendo antes de alguém ver.
    expect(ESPERA_ULTIMA_CARTA).toBeGreaterThanOrEqual(1_500);
    expect(ESPERA_ULTIMA_CARTA).toBeLessThanOrEqual(3_000);
  });

  it('duas cartas na mão ainda são escolha: nada sai sozinho', () => {
    const d = jogadaAutomatica(mesa({ hand: [carta('c1'), carta('c2')] }), 'eu', false, null);
    expect(d.acao).toBe('nada');
  });

  it('fora da minha vez, a última carta espera', () => {
    const d = jogadaAutomatica(
      mesa({ hand: [carta('c7')], activePlayerId: 'outro' }), 'eu', false, null,
    );
    expect(d.acao).toBe('nada');
  });
});
