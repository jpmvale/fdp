/**
 * Bots (RF-018).
 *
 * Este pacote **decide**, e só. Não conhece sala, rede nem relógio: recebe a
 * mesma `PlayerView` que um humano receberia — a projeção já filtrada, sem
 * estado oculto — e devolve uma jogada. É a mesma disciplina de
 * `packages/rules`: puro, determinístico dado o `Rng`, testável sem servidor.
 *
 * A consequência que importa: **um bot não pode trapacear**. Ele não tem como
 * ver a mão dos outros porque a informação não chega até aqui. Na rodada de
 * testa ele também não vê a própria carta — pelo mesmo motivo que você não vê.
 */

import type { Card, CardId, PlayerView, Rng } from '@fdp/rules';


/**
 * As quatro dificuldades previstas. `DIFICIL` e `REALISTA` ainda não têm
 * implementação própria e caem no comportamento de `MEDIO` — declaradas desde
 * já porque o valor viaja no protocolo e no estado persistido: acrescentar
 * depois obrigaria a migrar sala salva.
 */
export const DIFICULDADES = ['FACIL', 'MEDIO', 'DIFICIL', 'REALISTA'] as const;
export type Dificuldade = (typeof DIFICULDADES)[number];

/** As que hoje têm comportamento próprio. */
export const DIFICULDADES_PRONTAS: readonly Dificuldade[] = ['FACIL', 'MEDIO'];

export const ROTULOS: Record<Dificuldade, string> = {
  FACIL: 'Fácil',
  MEDIO: 'Médio',
  DIFICIL: 'Difícil',
  REALISTA: 'Realista',
};

/** O maior valor possível de uma carta (`A`), de RJ-021. */
const MAIOR = 14;
/** Quantos valores distintos existem: de 2 a A. */
const VALORES = 13;

const escolher = <T>(itens: readonly T[], rng: Rng): T =>
  itens[rng.nextInt(itens.length)] ?? itens[0]!;

/**
 * As apostas permitidas a QUEM ESTÁ DECIDINDO. A projeção já traz
 * `forbiddenBet` preenchido só para o último apostador (RJ-054), então a conta
 * aqui é subtração e não regra duplicada — o motor continua sendo o único lugar
 * que sabe qual valor fecha a mesa.
 */
function apostasPermitidas(visao: PlayerView): number[] {
  const todas: number[] = [];
  for (let v = 0; v <= visao.cardsThisRound; v++) {
    if (v !== visao.forbiddenBet) todas.push(v);
  }
  return todas;
}

// ---------------------------------------------------------------------------
// Aposta
// ---------------------------------------------------------------------------

export function decidirAposta(visao: PlayerView, dificuldade: Dificuldade, rng: Rng): number {
  const permitidas = apostasPermitidas(visao);

  // FÁCIL é aleatório de propósito, não "burro por acidente": ele aposta sem
  // olhar a mão, que é exatamente como joga quem acabou de aprender.
  if (dificuldade === 'FACIL') return escolher(permitidas, rng);

  const alvo = visao.isForeheadRound
    ? apostaDeTesta(visao)
    : apostaPelaMao(visao);

  return maisProxima(alvo, permitidas);
}

/**
 * Rodada normal: soma a chance de cada carta virar vaza.
 *
 * A chance de uma carta de valor `v` bater UM adversário aleatório é
 * `(v-2)/13`; contra `n` adversários, essa chance elevada a `n`. É grosseiro —
 * ignora quem já jogou, e trata as cartas como independentes — mas erra pouco
 * onde importa: reconhece que um `A` quase sempre ganha e que um `3` quase
 * nunca, que é o essencial de uma aposta.
 */
function apostaPelaMao(visao: PlayerView): number {
  const adversarios = Math.max(1, visao.playerOrder.length - 1);
  const esperadas = visao.hand.reduce((soma, carta) => {
    const chanceContraUm = Math.max(0, carta.value - 2) / VALORES;
    return soma + chanceContraUm ** adversarios;
  }, 0);
  return Math.round(esperadas);
}

/**
 * Rodada de testa: o bot vê a carta dos OUTROS e não vê a sua (RJ-100/RJ-101).
 *
 * Só há uma vaza, então a pergunta é binária: a minha carta desconhecida bate a
 * maior que está à vista? A chance disso é `(14 - maior) / 13`. Acima de meio a
 * meio ele aposta que ganha.
 *
 * É pouco código para a tela mais distintiva do jogo, mas é o raciocínio certo:
 * a única informação existente é a carta alheia, e ela está sendo usada.
 */
function apostaDeTesta(visao: PlayerView): number {
  const visiveis = Object.values(visao.foreheadCards).map((c) => c.value);
  if (visiveis.length === 0) return 0;
  const maior = Math.max(...visiveis);
  const chanceDeGanhar = (MAIOR - maior) / VALORES;
  return chanceDeGanhar > 0.5 ? 1 : 0;
}

/** Empate de distância desempata para BAIXO: errar apostando menos custa o mesmo, e não obriga a ganhar vaza que não se tem. */
function maisProxima(alvo: number, permitidas: readonly number[]): number {
  let melhor = permitidas[0]!;
  for (const valor of permitidas) {
    const dif = Math.abs(valor - alvo);
    const difMelhor = Math.abs(melhor - alvo);
    if (dif < difMelhor || (dif === difMelhor && valor < melhor)) melhor = valor;
  }
  return melhor;
}

// ---------------------------------------------------------------------------
// Carta
// ---------------------------------------------------------------------------

export function decidirCarta(visao: PlayerView, dificuldade: Dificuldade, rng: Rng): CardId {
  // RJ-023: toda carta da mão é sempre jogável. Não há filtro de legalidade a
  // aplicar aqui — se um dia houvesse, seria deste ponto.
  const mao = visao.hand;
  if (mao.length === 0) throw new Error('decidirCarta sem cartas na mão');

  if (dificuldade === 'FACIL') return escolher(mao, rng).id;

  const aposta = visao.bets[visao.viewerId] ?? 0;
  const feitas = visao.tricksWon[visao.viewerId] ?? 0;
  const querVaza = feitas < aposta;

  const naMesa = visao.currentTrick?.plays.map((j) => j.card.value) ?? [];
  const maiorNaMesa = naMesa.length > 0 ? Math.max(...naMesa) : 0;

  const ordenadas = [...mao].sort((a, b) => a.value - b.value);

  if (querVaza) {
    // Precisa de vaza: a MENOR carta que ainda ganha. Gastar o ás para bater um
    // 4 é ganhar a vaza de hoje e perder a de amanhã.
    const suficiente = ordenadas.find((c) => c.value > maiorNaMesa);
    return (suficiente ?? ordenadas[0]!).id;
  }

  // Já tem as vazas que apostou: quer PERDER. A maior carta que ainda perde;
  // se todas ganham, a menor, que é a que menos machuca.
  const perdedoras = ordenadas.filter((c) => c.value < maiorNaMesa);
  if (perdedoras.length > 0) return perdedoras[perdedoras.length - 1]!.id;
  return ordenadas[0]!.id;
}

export type { Card };
