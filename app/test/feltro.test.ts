/**
 * De quem parte a mão que está aberta (`07` §2.4).
 *
 * É informação que muda decisão — quem joga por último aposta sabendo o que
 * já caiu — e a tela não a mostrava. Testa aqui porque a alternativa é
 * conferir de olho, rodada a rodada, quem puxou.
 */

import { describe, expect, it } from 'vitest';
import {
  ALTURA_DO_AVISO,
  AVISO_DA_VEZ,
  OCUPADO,
  PANO,
  puxadorDaMao,
  topoDoMeuAssento,
} from '../src/components/Feltro';
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

// --- CA-362: o aviso "É A SUA VEZ!" não embola a mesa ----------------------

/**
 * O aviso mora numa faixa apertada, e não por descuido.
 *
 * Quando a vez é minha e eu jogo por último, há exatamente 7 cartas na mesa —
 * ou seja, o momento em que o aviso aparece é o mesmo em que a pilha do centro
 * está mais funda. Sobra pouco entre o fundo das cartas e o topo do meu
 * assento, e "pouco" só é seguro enquanto alguém estiver medindo.
 *
 * As faixas de `OCUPADO` foram medidas com `getBoundingClientRect` na mesa de
 * 8 em 360 px, não calculadas. Se um assento ganhar uma linha, se a carta
 * mudar de tamanho ou se a fileira quebrar mais cedo, é aqui que se descobre —
 * e não na tela de quem está jogando.
 */
describe('CA-362: o aviso da vez cabe onde foi posto', () => {
  const fim = AVISO_DA_VEZ + ALTURA_DO_AVISO;

  const cruza = (a: { de: number; ate: number }) =>
    !(a.ate <= AVISO_DA_VEZ || a.de >= fim);

  it('fica abaixo das cartas jogadas, mesmo com a mesa cheia', () => {
    expect(AVISO_DA_VEZ).toBeGreaterThanOrEqual(OCUPADO.cartasNaMesa.ate);
    expect(cruza(OCUPADO.cartasNaMesa)).toBe(false);
  });

  it('não encosta nos assentos de cima nem no contador do centro', () => {
    expect(cruza(OCUPADO.assentosDeCima)).toBe(false);
    expect(cruza(OCUPADO.contadorDoCentro)).toBe(false);
  });

  /**
   * Este é o lado que a aritmética defende sozinha: o meu assento sai de
   * `posicoes`, então o teste acompanha qualquer mudança de layout sem
   * ninguém precisar re-medir.
   */
  it('fica acima do meu assento, com 2 a 8 jogadores', () => {
    for (let total = 2; total <= 8; total++) {
      expect(fim).toBeLessThanOrEqual(topoDoMeuAssento(total));
    }
  });

  it('e dentro do pano — aviso fora do feltro não é aviso na mesa', () => {
    expect(AVISO_DA_VEZ).toBeGreaterThanOrEqual(PANO.de);
    expect(fim).toBeLessThanOrEqual(PANO.ate);
  });

  it('a folga existe, mas é pequena: se encolher, alguém tem de saber', () => {
    const acima = AVISO_DA_VEZ - OCUPADO.cartasNaMesa.ate;
    const abaixo = topoDoMeuAssento(8) - fim;
    expect(acima).toBeGreaterThanOrEqual(4);
    expect(abaixo).toBeGreaterThanOrEqual(4);
  });
});
