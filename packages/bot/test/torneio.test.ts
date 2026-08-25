/**
 * O torneio: as dificuldades valem o que prometem?
 *
 * Um bot "difícil" que não ganha mais que um médio é código a mais e nada
 * além disso. Aqui as quatro se enfrentam em partidas completas, com o motor
 * de regras de verdade, e a escada é verificada em vez de afirmada.
 *
 * As partidas são determinísticas por semente: o mesmo torneio roda igual toda
 * vez, e uma regressão numa dificuldade aparece como queda de vitórias.
 */

import { describe, expect, it } from 'vitest';
import {
  applyMove, advance, createMatch, createRng, project,
  type MatchState, type PlayerId,
} from '@fdp/rules';
import { decidirAposta, decidirCarta, type Dificuldade } from '@fdp/bot';

const CTX = { now: 0 };

/** Uma partida inteira entre bots; devolve quem venceu. */
function partida(mesa: Record<PlayerId, Dificuldade>, semente: string): PlayerId[] {
  const ids = Object.keys(mesa);
  let estado: MatchState = createMatch({ matchId: 'm', seed: semente, playerIds: ids });
  const rng = createRng(semente);

  for (let passo = 0; passo < 4000 && estado.endReason === null; passo++) {
    const fase = estado.round.phase;

    if (fase === 'DISTRIBUICAO' || fase === 'REVELACAO' || fase === 'RECOLHIMENTO' || fase === 'RESOLUCAO') {
      const r = advance(estado, CTX);
      if (!r.ok) break;
      estado = r.state;
      continue;
    }

    const quem = estado.round.activePlayerId;
    if (quem === null) break;

    const visao = project(estado, quem);
    const base = {
      playerId: quem,
      roundNumber: estado.roundNumber,
      trickNumber: estado.round.trickNumber,
    };

    const jogada = fase === 'APOSTAS'
      ? { ...base, type: 'bet' as const, bet: decidirAposta(visao, mesa[quem]!, rng) }
      : { ...base, type: 'playCard' as const, cardId: decidirCarta(visao, mesa[quem]!, rng) };

    const r = applyMove(estado, jogada, CTX);
    if (!r.ok) throw new Error(`jogada recusada de ${mesa[quem]}: ${JSON.stringify(r)}`);
    estado = r.state;
  }

  return estado.winnerIds ?? [];
}

/** Quantas vezes cada dificuldade venceu, em `rodadas` partidas. */
function torneio(mesa: Record<PlayerId, Dificuldade>, rodadas: number): Record<string, number> {
  const vitorias: Record<string, number> = {};
  for (const d of Object.values(mesa)) vitorias[d] = 0;

  for (let i = 0; i < rodadas; i++) {
    for (const vencedor of partida(mesa, `torneio-${i}`)) {
      const nivel = mesa[vencedor];
      if (nivel) vitorias[nivel] = (vitorias[nivel] ?? 0) + 1;
    }
  }
  return vitorias;
}

describe('CA-348: a escada de dificuldade se sustenta na mesa', () => {
  it('médio ganha mais que fácil', () => {
    const v = torneio({ a: 'FACIL', b: 'MEDIO', c: 'FACIL', d: 'MEDIO' }, 120);
    expect(v['MEDIO']).toBeGreaterThan(v['FACIL']!);
  });

  it('difícil ganha mais que médio', () => {
    const v = torneio({ a: 'MEDIO', b: 'DIFICIL', c: 'MEDIO', d: 'DIFICIL' }, 120);
    expect(v['DIFICIL']).toBeGreaterThan(v['MEDIO']!);
  });

  it('realista ganha mais que difícil', () => {
    const v = torneio({ a: 'DIFICIL', b: 'REALISTA', c: 'DIFICIL', d: 'REALISTA' }, 120);
    expect(v['REALISTA']).toBeGreaterThan(v['DIFICIL']!);
  });

  it('a mesa mista respeita a escada de ponta a ponta', () => {
    const v = torneio({ a: 'FACIL', b: 'MEDIO', c: 'DIFICIL', d: 'REALISTA' }, 200);
    // A ordem entre vizinhos pode oscilar numa amostra; os extremos, não.
    expect(v['REALISTA']).toBeGreaterThan(v['FACIL']!);
    expect(v['DIFICIL']).toBeGreaterThan(v['FACIL']!);
  });
});

describe('CA-349: nenhuma dificuldade produz jogada ilegal', () => {
  it('quatro mesas completas, uma por nível, sem recusa do motor', () => {
    // `partida` lança se o motor recusar qualquer jogada — é o teste.
    for (const nivel of ['FACIL', 'MEDIO', 'DIFICIL', 'REALISTA'] as Dificuldade[]) {
      for (let i = 0; i < 8; i++) {
        expect(() => partida({ a: nivel, b: nivel, c: nivel }, `legal-${nivel}-${i}`)).not.toThrow();
      }
    }
  });
});
