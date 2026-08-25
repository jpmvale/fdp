/**
 * Resolução de vaza, empates e o registro de morte.
 * Normativo: `02` §3.6.
 */
import type { Card, CardId, PlayerId, TieRule, TrickPlay } from './types.js';
export interface TrickResolution {
    winnerId: PlayerId | null;
    /** Valor empatado mais alto, se houve empate. Base de RJ-086/RJ-087. */
    annulledValue: number | null;
}
/**
 * `02` §3.6.1.
 *
 * `EMPATE_ANULA_VAZA`: empate no topo → ninguém leva.
 * `EMPATE_ANULA_CARTAS`: as empatadas se anulam e a disputa desce para a maior
 * carta restante, em cascata, até sobrar uma única — ou nada.
 */
export declare function resolveTrick(plays: readonly TrickPlay[], cards: Readonly<Record<CardId, Card>>, rule: TieRule): TrickResolution;
/**
 * RJ-085/RJ-086/RJ-087: quem puxa a vaza seguinte.
 *
 * Com vencedor, é ele. Sem vencedor, é **o responsável pelo empate**: o último
 * jogador, na ordem de jogada daquela vaza, a ter jogado carta do valor empatado
 * mais alto.
 */
export declare function nextLeaderOf(plays: readonly TrickPlay[], cards: Readonly<Record<CardId, Card>>, resolution: TrickResolution): PlayerId;
/**
 * RJ-007: desvio mínimo garantido.
 *
 * É o piso de `|aposta − vazasGanhas|` no fim da rodada, dado o que já se sabe.
 * Ultrapassou a aposta, o excesso só cresce. Não dá mais para alcançá-la, a
 * falta só cresce. Nos demais casos ainda dá para zerar.
 */
export declare function minGuaranteedDeviation(bet: number, tricksWon: number, tricksRemaining: number): number;
/** RJ-008: morreu quando o desvio mínimo garantido alcança as vidas. */
export declare function isDoomed(bet: number, tricksWon: number, tricksRemaining: number, lives: number): boolean;
