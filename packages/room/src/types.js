/**
 * Estado da sala (`03` §1, `04` §1).
 *
 * A sala é a camada acima do motor de regras: cuida de quem está presente, de
 * quem manda, do relógio e da pausa. Ela **não** decide resultado de jogada —
 * isso é do motor, que ela chama.
 *
 * Como o motor, esta camada é determinística: o tempo entra por parâmetro
 * (`RoomCtx.now`), nunca de `Date.now()`. É o que permite testar 10 minutos de
 * pausa em microssegundos.
 */
export function toPublicPlayer(player) {
    return {
        id: player.id,
        nickname: player.nickname,
        avatar: player.avatar,
        // `RECONECTANDO` some do fio: para os outros, quem está reconectando
        // continua simplesmente conectado.
        connection: player.connection === 'RECONECTANDO' ? 'CONECTADO' : player.connection,
        isSpectator: player.isSpectator,
        joinedAt: player.joinedAt,
        // Só aparece quando É bot: um campo `bot: null` em todo jogador humano
        // seria ruído em cada quadro, e o cliente já lê a ausência como "humano".
        ...(player.bot ? { bot: { difficulty: player.bot.difficulty } } : {}),
    };
}
/** Bot nunca está ausente: não tem socket para cair. */
export const isBot = (player) => player.bot !== null;
/** Está na sala de verdade: nem saiu, nem foi removido. */
export function isPresent(player) {
    return player.connection !== 'SAIU' && player.connection !== 'REMOVIDO';
}
/** Tem socket agora, ou está dentro da carência de transporte. */
export function isOnline(player) {
    return player.connection === 'CONECTADO' || player.connection === 'RECONECTANDO';
}
/** Ausente para efeito de jogo: pausa a partida (RJ-117). */
export function isAbsent(player) {
    return player.connection === 'DESCONECTADO';
}
