/**
 * Projeção do estado para um jogador específico (`04` §5, `02` §3.7).
 *
 * A visão é montada **do zero, por allowlist** — nunca clonando o estado e
 * apagando campos. Um campo novo em `MatchState` fica invisível ao cliente até
 * alguém decidir expô-lo aqui, e não o contrário. É a diferença entre esquecer
 * de esconder e esquecer de mostrar.
 */
import { isActive } from './engine.js';
export function project(state, viewerId) {
    const { round, hidden } = state;
    const isSpectator = !state.playerOrder.includes(viewerId);
    const handCounts = {};
    for (const [playerId, cards] of Object.entries(hidden.hands)) {
        handCounts[playerId] = cards.length;
    }
    // A rodada de testa inverte a visibilidade: o servidor manda a carta de todo
    // mundo, menos a de quem está olhando.
    const foreheadCards = {};
    let hand = [];
    if (round.isForeheadRound && round.phase !== 'RESOLUCAO') {
        for (const [playerId, cardIds] of Object.entries(hidden.hands)) {
            if (playerId === viewerId)
                continue; // RJ-100
            const cardId = cardIds[0];
            if (cardId)
                foreheadCards[playerId] = hidden.cards[cardId];
        }
    }
    else if (!round.isForeheadRound && !isSpectator) {
        hand = (hidden.hands[viewerId] ?? []).map((id) => hidden.cards[id]);
    }
    // Depois da revelação as cartas já estão na mesa e chegam a todos — inclusive
    // ao dono — através de `resolvedTricks`, que é público (RJ-066).
    const toPublicTrick = (trick) => trick === null
        ? null
        : {
            leaderId: trick.leaderId,
            playOrder: [...trick.playOrder],
            // Carta jogada é pública (RJ-066).
            plays: trick.plays.map((p) => ({
                playerId: p.playerId,
                card: hidden.cards[p.cardId],
            })),
            winnerId: trick.winnerId,
            annulledValue: trick.annulledValue,
            nextLeaderId: trick.nextLeaderId,
        };
    const isViewersTurn = round.activePlayerId === viewerId;
    return {
        matchId: state.id,
        options: state.options,
        playerOrder: [...state.playerOrder],
        lives: { ...state.lives },
        eliminated: state.eliminated.map((e) => ({ ...e })),
        withdrawn: state.withdrawn.map((w) => ({ ...w })),
        roundNumber: state.roundNumber,
        cardsThisRound: state.cardsThisRound,
        deckCount: state.deckCount,
        firstBidderId: state.firstBidderId,
        phase: round.phase,
        activePlayerId: round.activePlayerId,
        isForeheadRound: round.isForeheadRound,
        bets: { ...round.bets },
        bidOrder: [...round.bidOrder],
        tricksWon: { ...round.tricksWon },
        mortoEmVaza: { ...round.mortoEmVaza },
        trickNumber: round.trickNumber,
        handCounts,
        hand,
        foreheadCards,
        stockCount: hidden.stock.length,
        currentTrick: toPublicTrick(round.currentTrick),
        resolvedTricks: round.resolvedTricks
            .map(toPublicTrick)
            .filter((t) => t !== null),
        history: state.history.map((h) => ({ ...h })),
        winnerIds: state.winnerIds ? [...state.winnerIds] : null,
        endReason: state.endReason,
        // Enviar o valor proibido a quem não está na vez entregaria de graça uma
        // conta que cada jogador deveria fazer sozinho.
        forbiddenBet: isViewersTurn ? round.forbiddenBet : null,
        viewerId,
        isSpectator,
    };
}
/** Classificação final (RJ-012, RJ-129). Vencedores primeiro. */
export function ranking(state) {
    const winners = state.winnerIds ?? [];
    const eliminated = state.eliminated
        .filter((e) => !winners.includes(e.playerId))
        .slice()
        .sort((a, b) => b.roundNumber !== a.roundNumber
        ? b.roundNumber - a.roundNumber // caiu mais tarde, melhor colocado
        : b.mortoEmVaza - a.mortoEmVaza)
        .map((e) => e.playerId);
    // Retirados por ausência ficam abaixo de todos os eliminados (RJ-129).
    const withdrawn = state.withdrawn
        .filter((w) => !winners.includes(w.playerId))
        .slice()
        .sort((a, b) => b.roundNumber - a.roundNumber)
        .map((w) => w.playerId);
    const survivors = state.playerOrder.filter((id) => !winners.includes(id) &&
        !eliminated.includes(id) &&
        !withdrawn.includes(id));
    return [...winners, ...survivors, ...eliminated, ...withdrawn];
}
