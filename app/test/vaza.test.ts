/**
 * O momento em que as cartas começam a viajar (`07` §2.4 e §3).
 *
 * Este é o pedaço que não dá para verificar olhando: a viagem dura 300 ms
 * dentro de uma pausa de 1,8 s, e num ambiente automatizado os
 * temporizadores são estrangulados o bastante para a janela sumir entre duas
 * amostras. Então ele vira teste.
 */

import { describe, expect, it } from 'vitest';
import { LIMITS } from '@fdp/protocol';
import { esperaAteViajar } from '../src/components/Vaza';

const AGORA = 1_700_000_000_000;

describe('CA-346: quando as cartas começam a viajar até o vencedor', () => {
  it('fora do recolhimento, nada viaja', () => {
    expect(esperaAteViajar(false, AGORA + 1800, AGORA)).toBeNull();
  });

  it('sem prazo do servidor, nada viaja', () => {
    // Prazo nulo é sala pausada ou fase sem relógio. Chutar um tempo aqui faria
    // as cartas sumirem no meio de uma pausa, com a mesa parada.
    expect(esperaAteViajar(true, null, AGORA)).toBeNull();
  });

  it('a viagem termina exatamente quando o servidor recolhe', () => {
    const prazo = AGORA + LIMITS.trickPauseMs;
    const espera = esperaAteViajar(true, prazo, AGORA);

    expect(espera).toBe(LIMITS.trickPauseMs - LIMITS.trickCollectMs);
    // O que importa: começar a viagem + durar a viagem = o instante do prazo.
    expect(AGORA + espera! + LIMITS.trickCollectMs).toBe(prazo);
  });

  it('a sobra parada é a que `07` §2.4 exige, de 1,5 a 3 s', () => {
    const espera = esperaAteViajar(true, AGORA + LIMITS.trickPauseMs, AGORA)!;
    expect(espera).toBeGreaterThanOrEqual(1_500);
    expect(espera).toBeLessThanOrEqual(3_000);
  });

  it('chegando atrasado, viaja na hora em vez de esperar o próximo prazo', () => {
    // Reconexão no meio da pausa, ou aba que voltou do segundo plano: o prazo
    // já passou. Um `setTimeout` negativo dispararia na hora de qualquer jeito,
    // mas devolver 0 explicitamente é o que impede alguém de "consertar" isso
    // com um valor mínimo e reintroduzir o atraso.
    expect(esperaAteViajar(true, AGORA - 500, AGORA)).toBe(0);
    expect(esperaAteViajar(true, AGORA + 100, AGORA)).toBe(0);
  });

  it('contar a partir de quando a fase começa é o erro que isto evita', () => {
    // A primeira versão fazia `trickPauseMs − trickCollectMs` a partir do
    // momento em que o cliente via a mudança. Com 400 ms de atraso — latência,
    // granularidade do relógio da sala, um resync no meio — a viagem começaria
    // 400 ms depois do fim da pausa, ou seja, nunca apareceria.
    const atraso = 400;
    const prazo = AGORA + LIMITS.trickPauseMs - atraso;

    const ingenuo = LIMITS.trickPauseMs - LIMITS.trickCollectMs;
    expect(AGORA + ingenuo).toBeGreaterThan(prazo - LIMITS.trickCollectMs);

    const correto = esperaAteViajar(true, prazo, AGORA)!;
    expect(AGORA + correto + LIMITS.trickCollectMs).toBe(prazo);
  });
});
