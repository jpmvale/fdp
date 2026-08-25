/**
 * Ciclo de vida da sala, conexão e comandos (`03` §1 e §2).
 */
import { type Command } from '@fdp/protocol';
import { activePlayers, type EngineEvent, type PlayerId } from '@fdp/rules';
import { type Emission, type JoinParams, type Room, type RoomCtx, type RoomPlayer, type RoomResult } from './types.js';
/**
 * Fecha a sala quando o motor encerra a partida.
 *
 * As saídas anormais — host encerrou, ausência, retirada — ajustam o status na
 * mão, porque são decisões da sala. A vitória normal não: ela vem do motor, que
 * por projeto não conhece sala nenhuma (RJ-143). Sem esta costura a partida
 * acaba, `match:ended` sai, e a sala fica presa em `EM_PARTIDA` — com
 * `host:rematch` recusado por status errado e quem chega virando espectador de
 * uma mesa que já terminou.
 *
 * INV-05 exige partida **ativa** em `EM_PARTIDA`; é exatamente esta transição
 * que a mantém verdadeira.
 */
export declare function sealMatchEnd(room: Room, emissions: Emission[]): Room;
export declare function createRoom(code: string, host: JoinParams, ctx: RoomCtx): Room;
export declare const botsOf: (room: Room) => RoomPlayer[];
export declare function seatedPlayers(room: Room): RoomPlayer[];
export declare function spectators(room: Room): RoomPlayer[];
export declare function join(room: Room, params: JoinParams, ctx: RoomCtx): RoomResult;
/**
 * Socket aberto. Se a pessoa estava ausente e a partida pausada, isso pode
 * retomar a partida.
 */
export declare function reconnect(room: Room, playerId: PlayerId, ctx: RoomCtx): RoomResult;
/**
 * Socket caiu. **Não** é ausência ainda: começa a carência de transporte
 * (RJ-117a), e só o `tick` decide se virou ausência de verdade.
 */
export declare function disconnect(room: Room, playerId: PlayerId, ctx: RoomCtx): RoomResult;
export declare function leave(room: Room, playerId: PlayerId, ctx: RoomCtx): RoomResult;
export declare function absentMatchPlayers(room: Room): PlayerId[];
/** Entra em pausa. Suspende o prazo de turno — nunca o retoma (INV-15). */
export declare function pauseMatch(room: Room, ctx: RoomCtx, emissions: Emission[]): Room;
/** Prazo da fase corrente. Automática usa a pausa de legibilidade de 3 s. */
export declare function deadlineFor(room: Room, now: number): number | null;
export declare function applyCommand(room: Room, playerId: PlayerId, command: Command, ctx: RoomCtx): RoomResult;
/**
 * Roda a distribuição na hora.
 *
 * Sem isto, `match:started` sairia antes de existir carta, e o primeiro
 * apostador só apareceria um tick depois — a mesa ficaria três segundos sem
 * saber de quem é a vez.
 */
export declare function dealNow(room: Room, ctx: RoomCtx, emissions: Emission[]): Room;
/**
 * Converte eventos do motor em emissões endereçadas.
 *
 * Os eventos que carregam estado oculto são emitidos **um por destinatário**,
 * já projetados. A camada de transporte nunca precisa saber o que esconder —
 * e portanto nunca pode errar nisso.
 */
export declare function translate(events: readonly EngineEvent[], room: Room): Emission[];
/** `EV-001`: retrato completo do que aquele jogador tem direito de ver. */
export declare function snapshotFor(room: Room, viewerId: PlayerId): Emission['event'];
export { activePlayers };
