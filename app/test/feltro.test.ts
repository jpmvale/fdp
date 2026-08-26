/**
 * De quem parte a mão que está aberta (`07` §2.4).
 *
 * É informação que muda decisão — quem joga por último aposta sabendo o que
 * já caiu — e a tela não a mostrava. Testa aqui porque a alternativa é
 * conferir de olho, rodada a rodada, quem puxou.
 */

import { describe, expect, it } from 'vitest';
import { puxadorDaMao } from '../src/components/Feltro';
import type { PlayerView } from '@fdp/rules';

const vista = (over: Partial<PlayerView>): PlayerView => ({
  phase: 'VAZAS',
  firstBidderId: 'ana',
  currentTrick: null,
  ...over,
} as PlayerView);

describe('CA-359: a mesa mostra quem inicia a mão', () => {
  it('na aposta, quem puxa é quem abre a rodada (RJ-038)', () => {
    expect(puxadorDaMao(vista({ phase: 'APOSTAS', firstBidderId: 'beto' }))).toBe('beto');
  });

  it('na vaza, quem puxa é o líder da vaza corrente (RJ-065)', () => {
    const v = vista({
      phase: 'VAZAS',
      firstBidderId: 'ana',
      currentTrick: { leaderId: 'caio', playOrder: [], plays: [], winnerId: null, annulledValue: null, nextLeaderId: null },
    });
    // Repare que NÃO é o `firstBidderId`: quem levou a vaza anterior puxa a
    // seguinte, e o puxador muda de mão em mão dentro da mesma rodada.
    expect(puxadorDaMao(v)).toBe('caio');
  });

  it('sem vaza aberta, ninguém está puxando', () => {
    expect(puxadorDaMao(vista({ phase: 'RECOLHIMENTO', currentTrick: null }))).toBeNull();
  });

  it('na resolução também não há mão a puxar', () => {
    expect(puxadorDaMao(vista({ phase: 'RESOLUCAO', currentTrick: null }))).toBeNull();
  });
});
