/**
 * Quem manda na sala, e quem passa a mandar quando o dono some.
 *
 * **Isto existia em dois lugares.** `succeedHost` em `room.ts`, rodando a cada
 * comando, e `ensureHost` em `tick.ts`, rodando por relógio — duas cópias da
 * mesma regra, escritas separadas e que envelheceram separadas. Consertei a
 * primeira para que um bot nunca herdasse a mesa, testei, vi passar, e a sala
 * continuou caindo nas mãos do Bot Ada no navegador: o caminho que rodava era o
 * outro.
 *
 * É o mesmo estrago que a identidade única deu neste projeto, pela mesma razão:
 * regra duplicada não é redundância, é uma regra que só vale onde alguém
 * lembrou de mantê-la. Agora é uma função, e os dois chamam.
 */

import type { PlayerId } from '@fdp/rules';
import { isOnline, isPresent, type Emission, type Room } from './types.js';

/** Mesmo `all` de `room.ts` e `tick.ts`: um evento para a mesa inteira. */
const all = (event: Emission['event']): Emission => ({ audience: 'ALL', event });

/**
 * Escolhe o próximo anfitrião: **gente, e de preferência sentada**.
 *
 * As duas condições vêm de defeitos observados, e a ordem entre elas importa.
 *
 * **Bot nunca herda a mesa.** Bot não aperta botão: uma sala com host-bot fica
 * viva, com gente dentro, e sem nenhum caminho para começar a partida. A tela
 * diz "esperando Bot Ada começar" e a espera não acaba nunca.
 *
 * **Sentado antes de espectador**, porque quem assiste não pode começar a
 * partida, mexer nas opções nem expulsar ninguém. Mas espectador entra como
 * último recurso: dessa situação alguém se senta e a sala volta a andar
 * sozinha, e é melhor que host nenhum.
 *
 * Sem candidato humano, o host **não muda**. Manter quem estava é o menos ruim:
 * ele pode voltar, e a alternativa é a sala governada por um bot ou por
 * ninguém.
 *
 * `evitando` é quem NÃO pode receber — o próprio host que está saindo. Sem ele,
 * quem acabou de virar espectador seria "eleito" de volta por ainda estar
 * online.
 */
export function passarHost(
  room: Room,
  evitando: PlayerId | null,
  emissions: Emission[],
): Room {
  const disponiveis = room.players
    .filter((p) => p.id !== evitando && isPresent(p) && isOnline(p) && p.bot === null)
    .sort((a, b) => a.joinedAt - b.joinedAt);

  const successor = disponiveis.find((p) => !p.isSpectator) ?? disponiveis[0];
  if (!successor) return room; // ninguém a quem passar; sucede na próxima conexão
  if (successor.id === room.hostId) return room;

  emissions.push(all({ type: 'room:hostChanged', payload: { hostId: successor.id } }));
  return { ...room, hostId: successor.id };
}

/**
 * O host atual ainda serve?
 *
 * Serve se está na sala, online, não é espectador e não é bot. As quatro
 * condições, e não só as duas primeiras: um host que virou espectador ou um bot
 * que herdou a mesa estão tecnicamente presentes e não podem começar nada.
 */
export function hostServe(room: Room): boolean {
  const host = room.players.find((p) => p.id === room.hostId);
  return host !== undefined
    && isPresent(host)
    && isOnline(host)
    && !host.isSpectator
    && host.bot === null;
}

/** Garante um host utilizável, ou deixa como está se não houver a quem passar. */
export function garantirHost(room: Room, emissions: Emission[]): Room {
  if (hostServe(room)) return room;
  return passarHost(room, room.hostId, emissions);
}
