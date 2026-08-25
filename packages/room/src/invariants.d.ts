/**
 * Invariantes de sala (`03` §5): INV-01, INV-02, INV-05, INV-14 e INV-15.
 *
 * As invariantes de partida vivem em `@fdp/rules`. Aqui ficam as que só a sala
 * pode verificar, porque dependem de conexão e status.
 */
import { type Room } from './types.js';
export declare function checkRoomInvariants(room: Room): string[];
