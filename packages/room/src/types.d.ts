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
import type { Avatar, BotDifficulty, ChatMessage, ConnectionStatus, ErrorCode, PublicPlayer, RoomStatus, ServerEvent } from '@fdp/protocol';
import type { MatchOptions, MatchState, PlayerId } from '@fdp/rules';
/**
 * `RECONECTANDO` é interno: o socket caiu mas a carência de transporte ainda
 * corre (RJ-117a). Nunca é transmitido ao cliente — reconexão de transporte
 * precisa ser invisível ao jogador (RNF-066).
 */
export type InternalConnection = ConnectionStatus | 'RECONECTANDO';
export interface RoomPlayer {
    id: PlayerId;
    nickname: string;
    avatar: Avatar;
    connection: InternalConnection;
    /** Entrou com partida em andamento; joga na próxima (RF-014). */
    isSpectator: boolean;
    joinedAt: number;
    lastSeenAt: number;
    /** Quando o socket caiu. Base de `TRANSPORT_GRACE`. */
    socketLostAt: number | null;
    /**
     * Presente só em bot (RF-018). Um bot é um jogador como outro qualquer para
     * o motor de regras: senta, aposta, joga e perde vida do mesmo jeito. O que
     * muda é quem decide — e que ele nunca cai, então nunca pausa a mesa.
     */
    bot: {
        difficulty: BotDifficulty;
    } | null;
}
export interface PauseState {
    /** Início da pausa **contínua**. Ver `03` §2.1. */
    since: number;
    decisionUnlockedAt: number;
    hardDeadline: number;
    /** `EV-032` já foi emitido; evita repetir a cada tick. */
    decisionAnnounced: boolean;
}
export interface Room {
    code: string;
    status: RoomStatus;
    hostId: PlayerId | null;
    players: RoomPlayer[];
    options: MatchOptions;
    match: MatchState | null;
    pause: PauseState | null;
    /** Monotônico, nunca reutilizado (INV-02). */
    stateVersion: number;
    createdAt: number;
    lastActivityAt: number;
    /**
     * Prazo do turno corrente, ou da pausa de legibilidade de uma fase
     * automática. `null` sempre que a sala está pausada (INV-15).
     */
    phaseDeadline: number | null;
    /** RF-017. Vive e morre com a sala; teto em `LIMITS.chatHistoryMax`. */
    chat: ChatMessage[];
}
/** Evento já endereçado. A camada de transporte só entrega — não decide nada. */
export interface Emission {
    audience: 'ALL' | {
        playerId: PlayerId;
    };
    event: ServerEvent;
}
export type RoomResult = {
    ok: true;
    room: Room;
    emissions: Emission[];
} | {
    ok: false;
    code: ErrorCode;
    motivo: string;
};
export interface RoomCtx {
    now: number;
    /** Semente da partida, de um CSPRNG (RJ-144). */
    randomSeed: () => string;
    newId: () => string;
}
export interface JoinParams {
    playerId: PlayerId;
    nickname: string;
    avatar: Avatar;
}
export declare function toPublicPlayer(player: RoomPlayer): PublicPlayer;
/** Bot nunca está ausente: não tem socket para cair. */
export declare const isBot: (player: RoomPlayer) => boolean;
/** Está na sala de verdade: nem saiu, nem foi removido. */
export declare function isPresent(player: RoomPlayer): boolean;
/** Tem socket agora, ou está dentro da carência de transporte. */
export declare function isOnline(player: RoomPlayer): boolean;
/** Ausente para efeito de jogo: pausa a partida (RJ-117). */
export declare function isAbsent(player: RoomPlayer): boolean;
