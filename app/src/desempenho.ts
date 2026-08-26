import type { Faixa } from '@fdp/rules';

/**
 * A tinta da nota. O CÁLCULO mora em `@fdp/rules` (plano 01 §9.1).
 *
 * Ficou aqui só o que é apresentação: cor de faixa é token de CSS, e o motor
 * não tem — nem deve ter — opinião sobre paleta. O que veio de lá é a `Faixa`,
 * que é classificação, não cor.
 *
 * Cor E palavra: a cor nunca é o único canal (RNF-031).
 */
export const CORES: Record<Faixa, { cor: string; rotulo: string }> = {
  baixa: { cor: 'var(--nota-baixa)', rotulo: 'fraco' },
  media: { cor: 'var(--nota-media)', rotulo: 'regular' },
  alta: { cor: 'var(--nota-alta)', rotulo: 'bom' },
  excelente: { cor: 'var(--nota-otima)', rotulo: 'excelente' },
};
