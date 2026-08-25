/**
 * Invariantes de sala (`03` §5): INV-01, INV-02, INV-05, INV-14 e INV-15.
 *
 * As invariantes de partida vivem em `@fdp/rules`. Aqui ficam as que só a sala
 * pode verificar, porque dependem de conexão e status.
 */
import { checkInvariants as checkMatchInvariants } from '@fdp/rules';
import { absentMatchPlayers } from './room.js';
import { isOnline, isPresent } from './types.js';
export function checkRoomInvariants(room) {
    const violations = [];
    // INV-01: exatamente um host em sala não encerrada — desde que haja alguém
    // online para sê-lo. Sala sem ninguém conectado sucede na próxima conexão.
    if (room.status !== 'ENCERRADA') {
        const host = room.players.find((p) => p.id === room.hostId);
        const anyoneOnline = room.players.some((p) => isPresent(p) && isOnline(p));
        if (anyoneOnline && (!host || !isPresent(host))) {
            violations.push('INV-01: sala sem host válido havendo jogador online');
        }
    }
    // INV-05: "exatamente uma partida **ativa**". Partida encerrada não é ativa —
    // a verificação antiga só olhava se existia partida, e por isso deixava
    // passar uma sala presa em EM_PARTIDA com a partida já ganha.
    const shouldHaveMatch = room.status === 'EM_PARTIDA' || room.status === 'PAUSADA';
    if (shouldHaveMatch && room.match === null) {
        violations.push(`INV-05: status ${room.status} sem partida ativa`);
    }
    if (shouldHaveMatch && room.match !== null && room.match.endReason !== null) {
        violations.push(`INV-05: status ${room.status} com partida já encerrada (${room.match.endReason})`);
    }
    // INV-14: pausada ⇔ existe jogador da partida ausente.
    const absent = absentMatchPlayers(room);
    if (room.status === 'PAUSADA' && absent.length === 0) {
        violations.push('INV-14: sala pausada sem ninguém ausente');
    }
    if (room.status === 'EM_PARTIDA' && absent.length > 0) {
        violations.push(`INV-14: ${absent.length} ausente(s) sem a sala estar pausada`);
    }
    // INV-15: pausado, nenhum prazo de turno corre.
    if (room.status === 'PAUSADA') {
        if (room.phaseDeadline !== null) {
            violations.push('INV-15: prazo de turno ativo com a sala pausada');
        }
        if (room.pause === null)
            violations.push('INV-14: status PAUSADA sem estado de pausa');
    }
    if (room.status !== 'PAUSADA' && room.pause !== null) {
        violations.push('INV-14: estado de pausa presente fora de PAUSADA');
    }
    if (room.match)
        violations.push(...checkMatchInvariants(room.match));
    return violations;
}
