import type { Card, PlayerView } from './state/tipos';

/**
 * O que cada jogador tem na mão e o que já jogou, para quem assiste.
 *
 * `allHands` (RJ-159) traz só o que **resta**: o motor filtra a carta da mão no
 * instante em que ela é jogada. Sozinho, ele responde "o que ainda dá para
 * fazer" e não responde "o que já foi feito" — e numa rodada de 6 cartas, na
 * terceira mão, quem assiste está justamente tentando lembrar o que saiu.
 *
 * As cartas jogadas **já chegam** ao espectador, em `resolvedTricks` e
 * `currentTrick`, que são públicos (RJ-066). Não falta dado no servidor; falta
 * juntar os dois lados. Fazer isso aqui, e não mandar a mão original do
 * servidor, evita acrescentar campo — e campo novo na projeção é superfície
 * nova por onde uma carta pode vazar para quem não devia vê-la.
 */

export interface CartaJogada {
  carta: Card;
  /** Em que mão da rodada ela saiu. 1 é a primeira. */
  mao: number;
}

export interface CartasDoJogador {
  naMao: Card[];
  jogadas: CartaJogada[];
}

/**
 * Junta as duas metades para um jogador.
 *
 * A ordem de `jogadas` é cronológica — a primeira mão primeiro —, que é como
 * quem acompanha a partida guarda isso de cabeça.
 */
export function cartasDoJogador(partida: PlayerView, playerId: string): CartasDoJogador {
  const jogadas: CartaJogada[] = [];
  const vistas = new Set<string>();

  const anotar = (trick: PlayerView['currentTrick'], mao: number): void => {
    if (!trick) return;
    for (const p of trick.plays) {
      if (p.playerId !== playerId) continue;
      // Deduplicado por id de carta: entre resolver a mão e recolhê-la, a mesma
      // vaza pode aparecer nos dois lugares, e a carta apareceria duas vezes.
      // Uma carta contada em dobro é pior que não contada — ela sugere que o
      // jogador tinha uma cópia que nunca existiu.
      if (vistas.has(p.card.id)) continue;
      vistas.add(p.card.id);
      jogadas.push({ carta: p.card, mao });
    }
  };

  partida.resolvedTricks.forEach((t, i) => anotar(t, i + 1));
  anotar(partida.currentTrick, partida.trickNumber);

  return { naMao: partida.allHands[playerId] ?? [], jogadas };
}

/**
 * Quantas cartas a rodada deu a cada um, conferida contra o que se sabe.
 *
 * Serve para a tela poder dizer "2 de 6 jogadas" em vez de só "2 jogadas". Vem
 * de `cardsThisRound` e não da soma, de propósito: a soma esconderia uma
 * discrepância, e é justamente a discrepância que interessaria ver.
 */
export const totalDaRodada = (partida: PlayerView): number => partida.cardsThisRound;
