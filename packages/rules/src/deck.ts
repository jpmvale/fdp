/**
 * Construção e embaralhamento do sabot (`02` §3.2).
 */

import { RANKS, SUITS, type Card, type CardId, type Rank } from './types.js';
import type { Rng } from './rng.js';

/** RJ-021: 2..10 valem o número; J=11, Q=12, K=13, A=14. */
export function rankValue(rank: Rank): number {
  const index = RANKS.indexOf(rank);
  return index + 2;
}

/** RJ-024: `ceil(jogadores × cartas / 52)`, mínimo 1. */
export function deckCountFor(activePlayers: number, cardsThisRound: number): number {
  const needed = activePlayers * cardsThisRound;
  return Math.max(1, Math.ceil(needed / 52));
}

/**
 * Monta o sabot de `deckCount` baralhos e embaralha (RJ-025, RJ-040).
 *
 * Os `CardId` são opacos e sorteados **antes** do embaralhamento: não revelam
 * nem o valor da carta nem a posição dela no sabot. Um cliente que veja um id
 * não consegue derivar rank/naipe, o que é pré-requisito da rodada de testa
 * (RJ-100).
 */
export function buildShoe(deckCount: number, rng: Rng): Card[] {
  const cards: Card[] = [];
  const usedIds = new Set<CardId>();

  for (let deckIndex = 0; deckIndex < deckCount; deckIndex++) {
    for (const suit of SUITS) {
      for (const rank of RANKS) {
        let id = `k${rng.nextHex(8)}`;
        while (usedIds.has(id)) id = `k${rng.nextHex(8)}`;
        usedIds.add(id);
        cards.push({ id, rank, suit, value: rankValue(rank), deckIndex });
      }
    }
  }

  return shuffle(cards, rng);
}

/** Fisher-Yates. Não muta a entrada. */
export function shuffle<T>(items: readonly T[], rng: Rng): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = rng.nextInt(i + 1);
    const a = out[i]!;
    const b = out[j]!;
    out[i] = b;
    out[j] = a;
  }
  return out;
}

export function cardCatalog(cards: readonly Card[]): Record<CardId, Card> {
  const catalog: Record<CardId, Card> = {};
  for (const card of cards) catalog[card.id] = card;
  return catalog;
}
