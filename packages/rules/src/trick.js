/**
 * Resolução de vaza, empates e o registro de morte.
 * Normativo: `02` §3.6.
 */
/**
 * `02` §3.6.1.
 *
 * `EMPATE_ANULA_VAZA`: empate no topo → ninguém leva.
 * `EMPATE_ANULA_CARTAS`: as empatadas se anulam e a disputa desce para a maior
 * carta restante, em cascata, até sobrar uma única — ou nada.
 */
export function resolveTrick(plays, cards, rule) {
    if (plays.length === 0)
        return { winnerId: null, annulledValue: null };
    const valueOf = (play) => {
        const card = cards[play.cardId];
        if (!card)
            throw new Error(`carta ${play.cardId} fora do catálogo da rodada`);
        return card.value;
    };
    let remaining = plays.slice();
    let annulledValue = null;
    while (remaining.length > 0) {
        const top = Math.max(...remaining.map(valueOf));
        const tied = remaining.filter((play) => valueOf(play) === top);
        if (tied.length === 1) {
            return { winnerId: tied[0].playerId, annulledValue };
        }
        // Só o primeiro grupo anulado — o de maior valor — interessa a RJ-087.
        if (annulledValue === null)
            annulledValue = top;
        if (rule === 'EMPATE_ANULA_VAZA') {
            return { winnerId: null, annulledValue };
        }
        remaining = remaining.filter((play) => valueOf(play) !== top);
    }
    return { winnerId: null, annulledValue };
}
/**
 * RJ-085/RJ-086/RJ-087: quem puxa a vaza seguinte.
 *
 * Com vencedor, é ele. Sem vencedor, é **o responsável pelo empate**: o último
 * jogador, na ordem de jogada daquela vaza, a ter jogado carta do valor empatado
 * mais alto.
 */
export function nextLeaderOf(plays, cards, resolution) {
    if (resolution.winnerId !== null)
        return resolution.winnerId;
    const { annulledValue } = resolution;
    if (annulledValue === null) {
        throw new Error('vaza sem vencedor e sem valor empatado é estado impossível');
    }
    for (let i = plays.length - 1; i >= 0; i--) {
        const play = plays[i];
        if (cards[play.cardId].value === annulledValue)
            return play.playerId;
    }
    throw new Error('nenhuma carta com o valor empatado registrado');
}
/**
 * RJ-007: desvio mínimo garantido.
 *
 * É o piso de `|aposta − vazasGanhas|` no fim da rodada, dado o que já se sabe.
 * Ultrapassou a aposta, o excesso só cresce. Não dá mais para alcançá-la, a
 * falta só cresce. Nos demais casos ainda dá para zerar.
 */
export function minGuaranteedDeviation(bet, tricksWon, tricksRemaining) {
    if (tricksWon > bet)
        return tricksWon - bet;
    const maxReachable = tricksWon + tricksRemaining;
    if (maxReachable < bet)
        return bet - maxReachable;
    return 0;
}
/** RJ-008: morreu quando o desvio mínimo garantido alcança as vidas. */
export function isDoomed(bet, tricksWon, tricksRemaining, lives) {
    return minGuaranteedDeviation(bet, tricksWon, tricksRemaining) >= lives;
}
