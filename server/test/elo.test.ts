/**
 * O elo (plano 03 §4). CA-419, CA-420, CA-421.
 *
 * Testes exaustivos onde dá: a conta é pequena o bastante para varrer todas as
 * colocações de todas as mesas possíveis, e a propriedade que interessa — soma
 * zero — só se enxerga no conjunto.
 */

import { describe, expect, it } from 'vitest';
import { ELO_INICIAL } from '@fdp/protocol';
import {
  deltasDaMesa,
  ELO_MINIMO,
  faixaDoElo,
  pesoDe,
  PUNICAO_ABANDONO,
  relativa,
  type JogadorRanqueado,
} from '../src/elo.js';

/** Uma mesa de N contas, todas com o mesmo elo e a mesma experiência. */
function mesa(n: number, opcoes: Partial<JogadorRanqueado> = {}): JogadorRanqueado[] {
  return Array.from({ length: n }, (_, i) => ({
    contaId: `c${i + 1}`,
    colocacao: i + 1,
    eloAntes: ELO_INICIAL,
    partidasAntes: 50,
    abandonou: false,
    ...opcoes,
  }));
}

describe('CA-419: a conta por colocação', () => {
  it('o primeiro leva +K e o último −K, em qualquer tamanho de mesa', () => {
    for (let n = 2; n <= 8; n++) {
      const d = deltasDaMesa(mesa(n), n);
      expect(d[0]!.delta, `mesa de ${n}`).toBe(30);
      expect(d[n - 1]!.delta, `mesa de ${n}`).toBe(-30);
    }
  });

  it('o 2º ganha estritamente mais que o 3º — é o pedido', () => {
    for (let n = 4; n <= 8; n++) {
      const d = deltasDaMesa(mesa(n), n);
      expect(d[1]!.delta, `mesa de ${n}`).toBeGreaterThan(d[2]!.delta);
    }
  });

  it('a colocação é monótona: quem termina acima nunca leva menos', () => {
    for (let n = 2; n <= 8; n++) {
      const d = deltasDaMesa(mesa(n), n);
      for (let i = 1; i < n; i++) {
        expect(d[i - 1]!.delta, `mesa de ${n}, ${i}º vs ${i + 1}º`).toBeGreaterThan(d[i]!.delta);
      }
    }
  });

  it('a mesa é soma zero: o que sobe de um lado desce do outro', () => {
    for (let n = 2; n <= 8; n++) {
      const soma = deltasDaMesa(mesa(n), n).reduce((s, d) => s + d.delta, 0);
      expect(soma, `mesa de ${n}`).toBe(0);
    }
  });

  it('o meio de uma mesa ímpar é o ponto neutro: zero', () => {
    for (const n of [5, 7]) {
      const meio = deltasDaMesa(mesa(n), n)[(n - 1) / 2]!;
      expect(meio.delta, `mesa de ${n}`).toBe(0);
    }
  });

  it('a normalização é a mesma numa mesa de 4 e numa de 8', () => {
    // Primeiro é +1 e último é −1 nas duas; é isso que faz a regra valer sem
    // uma tabela por tamanho de mesa.
    expect(relativa(1, 4)).toBe(1);
    expect(relativa(4, 4)).toBe(-1);
    expect(relativa(1, 8)).toBe(1);
    expect(relativa(8, 8)).toBe(-1);
    expect(relativa(2, 4)).toBeCloseTo(1 / 3, 10);
    expect(relativa(2, 8)).toBeCloseTo(5 / 7, 10);
  });
});

describe('CA-420: o peso e o piso', () => {
  it('K cai com a experiência: 80, 50, 30', () => {
    expect(pesoDe(0)).toBe(80);
    expect(pesoDe(9)).toBe(80);
    expect(pesoDe(10)).toBe(50);
    expect(pesoDe(29)).toBe(50);
    expect(pesoDe(30)).toBe(30);
    expect(pesoDe(500)).toBe(30);
  });

  it('a primeira partida de uma conta usa o K da calibração', () => {
    const d = deltasDaMesa(mesa(4, { partidasAntes: 0 }), 4);
    expect(d[0]!.delta).toBe(80);
    expect(d[3]!.delta).toBe(-80);
  });

  it('o piso segura em zero, e o delta gravado bate com a diferença dos elos', () => {
    const jogadores = mesa(4, { eloAntes: 10 });
    const ultimo = deltasDaMesa(jogadores, 4)[3]!;

    expect(ultimo.eloDepois).toBe(ELO_MINIMO);
    // O delta é cortado junto com o resultado. Gravar −30 aqui faria a tela do
    // perfil mentir na conta mais simples que ela faz: 10 − 30 não é 0.
    expect(ultimo.delta).toBe(-10);
    expect(ultimo.eloAntes + ultimo.delta).toBe(ultimo.eloDepois);
  });

  it('o piso é a única coisa que quebra a soma zero, e só no fundo', () => {
    const soma = deltasDaMesa(mesa(4, { eloAntes: 5 }), 4).reduce((s, d) => s + d.delta, 0);
    expect(soma).toBeGreaterThan(0);
  });
});

describe('CA-421: abandono', () => {
  it('quem abandona leva o pior da mesa mais a punição fixa', () => {
    const jogadores = mesa(4);
    jogadores[0]!.abandonou = true; // terminou em 1º — e não importa
    const d = deltasDaMesa(jogadores, 4);
    expect(d[0]!.delta).toBe(-30 - PUNICAO_ABANDONO);
  });

  it('a colocação que o bot tirou no assento não conta para quem saiu', () => {
    const primeiro = deltasDaMesa([{ ...mesa(4)[0]!, abandonou: true, colocacao: 1 }], 4)[0]!;
    const ultimo = deltasDaMesa([{ ...mesa(4)[3]!, abandonou: true, colocacao: 4 }], 4)[0]!;
    expect(primeiro.delta).toBe(ultimo.delta);
  });

  it('quem NÃO abandonou não paga punição nenhuma', () => {
    const jogadores = mesa(4);
    jogadores[3]!.abandonou = false;
    expect(deltasDaMesa(jogadores, 4)[3]!.delta).toBe(-30);
  });

  it('a punição também respeita o piso', () => {
    const d = deltasDaMesa([{ ...mesa(4)[0]!, abandonou: true, eloAntes: 10 }], 4)[0]!;
    expect(d.eloDepois).toBe(0);
    expect(d.delta).toBe(-10);
  });
});

describe('faixas (D-3)', () => {
  it('cada faixa começa onde a de baixo termina', () => {
    expect(faixaDoElo(0)).toBe('Bronze');
    expect(faixaDoElo(899)).toBe('Bronze');
    expect(faixaDoElo(900)).toBe('Prata');
    expect(faixaDoElo(ELO_INICIAL)).toBe('Prata');
    expect(faixaDoElo(1199)).toBe('Prata');
    expect(faixaDoElo(1200)).toBe('Ouro');
    expect(faixaDoElo(1499)).toBe('Ouro');
    expect(faixaDoElo(1500)).toBe('Platina');
    expect(faixaDoElo(1799)).toBe('Platina');
    expect(faixaDoElo(1800)).toBe('Diamante');
    expect(faixaDoElo(99_999)).toBe('Diamante');
  });

  it('quem começa cai no meio: Prata é a faixa da maioria, por construção', () => {
    expect(faixaDoElo(ELO_INICIAL)).toBe('Prata');
  });
});
