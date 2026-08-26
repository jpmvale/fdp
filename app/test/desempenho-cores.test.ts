/**
 * A paleta da nota, que ficou no cliente quando o CÁLCULO foi para o motor
 * (plano 01 §9.1).
 *
 * Cor de faixa é token de CSS: o motor não tem — nem deve ter — opinião sobre
 * tinta. O que ele exporta é a `Faixa`, que é classificação.
 */

import { describe, expect, it } from 'vitest';
import { faixaDe, type Faixa } from '@fdp/rules';
import { CORES } from '../src/desempenho';
import { contraste, hexParaRgb } from './daltonismo';

const FAIXAS: Faixa[] = ['baixa', 'media', 'alta', 'excelente'];

describe('nota: toda faixa tem cor E palavra (RNF-031)', () => {
  it('nenhuma faixa depende só da cor', () => {
    for (const faixa of FAIXAS) {
      expect(CORES[faixa].cor.length).toBeGreaterThan(0);
      // A palavra é o segundo canal: quem não distingue a cor lê "excelente".
      expect(CORES[faixa].rotulo.length).toBeGreaterThan(0);
    }
  });

  it('a faixa da nota tem cor definida', () => {
    for (const nota of [0, 3.9, 4, 6.4, 6.5, 7.9, 8, 10]) {
      expect(CORES[faixaDe(nota)]).toBeDefined();
    }
  });
});

describe('nota: as cores são legíveis (RNF-030)', () => {
  it('toda cor de nota passa de 4,5:1 contra o fundo', () => {
    // As cores vivem no CSS; aqui vale o mesmo princípio da paleta de avatares
    // (CA-345): número afirmado sem medição é número que envelhece errado.
    const paleta: Record<string, string> = {
      baixa: '#ef4d5a', media: '#e0a33a', alta: '#3fb98a', excelente: '#6594fa',
    };
    const fundo = hexParaRgb('#0d121c'); // --poco, o fundo do cartão
    for (const [faixa, hex] of Object.entries(paleta)) {
      const razao = contraste(hexParaRgb(hex), fundo);
      expect(razao, `${faixa} (${hex}): ${razao.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
    }
  });
});
