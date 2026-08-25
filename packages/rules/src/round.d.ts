/**
 * Progressão de rodadas, ordem de aposta e a regra da soma proibida.
 * Normativo: `02` §3.3, §3.4 e §3.5.2.
 */
import type { PlayerId } from './types.js';
/** RJ-035/RJ-036: serrote `1,2,…,M,1,2,…`. Nunca vai-e-volta. */
export declare function nextCardsThisRound(previous: number, max: number): number;
/**
 * RJ-038/RJ-039: o primeiro apostador avança um jogador **ativo** por rodada.
 *
 * As duas regras colapsam numa implementação só: parte-se sempre da posição do
 * apostador anterior em `playerOrder` (que é fixo, RJ-030) e avança-se até achar
 * alguém ativo. Se o anterior saiu da partida, sua posição continua ali servindo
 * de âncora — é exatamente o que RJ-039 pede.
 */
export declare function nextFirstBidder(playerOrder: readonly PlayerId[], previousFirstBidder: PlayerId, isActive: (id: PlayerId) => boolean): PlayerId;
/** Ativos em ordem horária a partir de `startId` (RJ-050, RJ-062). */
export declare function orderFrom(playerOrder: readonly PlayerId[], startId: PlayerId, isActive: (id: PlayerId) => boolean): PlayerId[];
/**
 * RJ-054/RJ-055: valor proibido do **último** apostador.
 *
 * Só existe se cair dentro de `[0, cardsThisRound]`; fora disso a soma já não
 * pode fechar e o último aposta livremente. Como o intervalo tem no mínimo dois
 * valores e no máximo um é proibido, sempre sobra jogada legal — a fase nunca
 * trava.
 */
export declare function forbiddenBetFor(cardsThisRound: number, previousBets: readonly number[]): number | null;
/** Apostas legais de quem está na vez. `isLastBidder` decide se RJ-054 incide. */
export declare function legalBets(cardsThisRound: number, previousBets: readonly number[], isLastBidder: boolean): number[];
