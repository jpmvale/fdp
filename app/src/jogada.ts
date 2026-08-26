/**
 * O que o cliente manda sozinho, sem toque — e quando.
 *
 * Isto é comodidade de cliente, nunca regra: tudo o que acontece aqui o
 * servidor faria igual pelo auto-play quando o prazo vencesse (`02` §3.7).
 * Quem fechar a aba no meio não é prejudicado, e é por isso que a decisão pode
 * morar no cliente. Estar aqui, fora do componente, é o que a torna testável:
 * dentro do `useEffect` ela só se verificava jogando.
 */

import type { Card, RoundPhase } from '@fdp/rules';

/**
 * A pausa antes de a última carta sair.
 *
 * Sem ela a última mão da rodada resolve numa piscada — ninguém tem uma
 * escolha a fazer, então todas as cartas cairiam praticamente juntas e a mesa
 * não veria o que aconteceu. `07` §2.4 pede o contrário: o resultado precisa
 * ficar legível antes de a tela virar.
 */
export const ESPERA_ULTIMA_CARTA = 1_500;

/** A carta engatilhada, presa à mão em que foi engatilhada. */
export interface PreJogada {
  cardId: string;
  roundNumber: number;
  trickNumber: number;
}

export type Automatica =
  | { acao: 'jogar'; cardId: string; atrasoMs: number }
  | { acao: 'esquecer' }
  | { acao: 'nada' };

export function jogadaAutomatica(
  partida: {
    phase: RoundPhase;
    activePlayerId: string | null;
    hand: Card[];
    roundNumber: number;
    trickNumber: number;
  },
  eu: string | null,
  pausada: boolean,
  engatilhada: PreJogada | null,
): Automatica {
  // Mesa parada não recebe jogada: mandar carta durante a pausa seria jogar
  // por alguém que nem está vendo a tela.
  if (pausada) return { acao: 'nada' };
  if (partida.phase !== 'VAZAS' || partida.activePlayerId !== eu || eu === null) {
    return { acao: 'nada' };
  }

  // Uma carta só na mão não é escolha, é formalidade — mas com a pausa, senão
  // a rodada inteira desaparece antes de alguém acompanhar.
  if (partida.hand.length === 1) {
    return { acao: 'jogar', cardId: partida.hand[0]!.id, atrasoMs: ESPERA_ULTIMA_CARTA };
  }

  if (!engatilhada) return { acao: 'nada' };

  // O gatilho vale para a mão em que foi armado, e só. Guardar apenas o
  // `cardId` parecia bastar e não bastava: o baralho é redistribuído a cada
  // rodada e o mesmo id volta a existir noutra mão — um gatilho esquecido
  // dispararia sozinho numa carta que o jogador nunca escolheu.
  if (
    engatilhada.roundNumber !== partida.roundNumber ||
    engatilhada.trickNumber !== partida.trickNumber
  ) {
    return { acao: 'esquecer' };
  }

  // Entre armar e a vez chegar a mão pode ter mudado. Mandar um id que já não
  // está lá é pedir um `FORBIDDEN_CARD` de graça.
  if (!partida.hand.some((c) => c.id === engatilhada.cardId)) return { acao: 'esquecer' };

  return { acao: 'jogar', cardId: engatilhada.cardId, atrasoMs: 0 };
}
