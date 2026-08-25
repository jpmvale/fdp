/**
 * Relógio da sala (`03` §2.1).
 *
 * Todos os prazos vivem como instantes no estado, e `tick` é a única coisa que
 * os consulta. O tempo entra por parâmetro: dez minutos de pausa levam
 * microssegundos em teste, e não existe `setTimeout` para vazar entre casos.
 *
 * O servidor chama `tick` periodicamente e sempre que um prazo vence.
 */
import { isActive } from '@fdp/rules';
import { seatedPlayers } from './room.js';
import { type Emission, type Room, type RoomCtx } from './types.js';
export interface TickResult {
    room: Room;
    emissions: Emission[];
    changed: boolean;
}
/**
 * Próximo instante em que algo precisa acontecer. Devolve `null` quando não há
 * nada agendado, e serve para o servidor dormir em vez de fazer polling.
 */
export declare function nextDeadline(room: Room): number | null;
export declare function tick(room: Room, ctx: RoomCtx): TickResult;
export { seatedPlayers, isActive };
