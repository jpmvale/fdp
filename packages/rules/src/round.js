/**
 * Progressão de rodadas, ordem de aposta e a regra da soma proibida.
 * Normativo: `02` §3.3, §3.4 e §3.5.2.
 */
/** RJ-035/RJ-036: serrote `1,2,…,M,1,2,…`. Nunca vai-e-volta. */
export function nextCardsThisRound(previous, max) {
    return previous >= max ? 1 : previous + 1;
}
/**
 * RJ-038/RJ-039: o primeiro apostador avança um jogador **ativo** por rodada.
 *
 * As duas regras colapsam numa implementação só: parte-se sempre da posição do
 * apostador anterior em `playerOrder` (que é fixo, RJ-030) e avança-se até achar
 * alguém ativo. Se o anterior saiu da partida, sua posição continua ali servindo
 * de âncora — é exatamente o que RJ-039 pede.
 */
export function nextFirstBidder(playerOrder, previousFirstBidder, isActive) {
    const anchor = playerOrder.indexOf(previousFirstBidder);
    if (anchor < 0) {
        throw new Error(`primeiro apostador ${previousFirstBidder} não está em playerOrder`);
    }
    for (let step = 1; step <= playerOrder.length; step++) {
        const candidate = playerOrder[(anchor + step) % playerOrder.length];
        if (isActive(candidate))
            return candidate;
    }
    throw new Error('não há jogador ativo para abrir as apostas');
}
/** Ativos em ordem horária a partir de `startId` (RJ-050, RJ-062). */
export function orderFrom(playerOrder, startId, isActive) {
    const anchor = playerOrder.indexOf(startId);
    if (anchor < 0)
        throw new Error(`${startId} não está em playerOrder`);
    const out = [];
    for (let step = 0; step < playerOrder.length; step++) {
        const candidate = playerOrder[(anchor + step) % playerOrder.length];
        if (isActive(candidate))
            out.push(candidate);
    }
    return out;
}
/**
 * RJ-054/RJ-055: valor proibido do **último** apostador.
 *
 * Só existe se cair dentro de `[0, cardsThisRound]`; fora disso a soma já não
 * pode fechar e o último aposta livremente. Como o intervalo tem no mínimo dois
 * valores e no máximo um é proibido, sempre sobra jogada legal — a fase nunca
 * trava.
 */
export function forbiddenBetFor(cardsThisRound, previousBets) {
    const sum = previousBets.reduce((a, b) => a + b, 0);
    const forbidden = cardsThisRound - sum;
    return forbidden >= 0 && forbidden <= cardsThisRound ? forbidden : null;
}
/** Apostas legais de quem está na vez. `isLastBidder` decide se RJ-054 incide. */
export function legalBets(cardsThisRound, previousBets, isLastBidder) {
    const forbidden = isLastBidder ? forbiddenBetFor(cardsThisRound, previousBets) : null;
    const bets = [];
    for (let bet = 0; bet <= cardsThisRound; bet++) {
        if (bet !== forbidden)
            bets.push(bet);
    }
    return bets;
}
