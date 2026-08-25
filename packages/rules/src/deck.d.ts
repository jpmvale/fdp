/**
 * Construção e embaralhamento do sabot (`02` §3.2).
 */
import { type Card, type CardId, type Rank } from './types.js';
import type { Rng } from './rng.js';
/** RJ-021: 2..10 valem o número; J=11, Q=12, K=13, A=14. */
export declare function rankValue(rank: Rank): number;
/** RJ-024: `ceil(jogadores × cartas / 52)`, mínimo 1. */
export declare function deckCountFor(activePlayers: number, cardsThisRound: number): number;
/**
 * Monta o sabot de `deckCount` baralhos e embaralha (RJ-025, RJ-040).
 *
 * Os `CardId` são opacos e sorteados **antes** do embaralhamento: não revelam
 * nem o valor da carta nem a posição dela no sabot. Um cliente que veja um id
 * não consegue derivar rank/naipe, o que é pré-requisito da rodada de testa
 * (RJ-100).
 */
export declare function buildShoe(deckCount: number, rng: Rng): Card[];
/** Fisher-Yates. Não muta a entrada. */
export declare function shuffle<T>(items: readonly T[], rng: Rng): T[];
export declare function cardCatalog(cards: readonly Card[]): Record<CardId, Card>;
