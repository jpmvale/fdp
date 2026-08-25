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
import {
  chanceDeGanhar, depoisDeMim, faltaGanhar, maiorNaMesa, maosRestantes,
  ordenadas, pressaoNasApostas, MAIOR, VALORES,
} from './leitura.js';


/**
 * As quatro dificuldades, e o que separa uma da outra.
 *
 * Nenhuma delas vê nada além da `PlayerView` — a mesma projeção de um humano.
 * O que muda é **quanto do que está à vista cada uma usa**:
 *
 * | | aposta | joga |
 * |---|---|---|
 * | `FACIL` | no chute | carta ao acaso |
 * | `MEDIO` | força da mão | menor que ganha / maior que perde |
 * | `DIFICIL` | + conta as cartas já jogadas | + posição na mão e alvo da aposta |
 * | `REALISTA` | + lê as apostas da mesa | + protege o alvo e limita o estrago |
 *
 * A escada é acumulativa de propósito: cada nível é o anterior mais uma
 * camada de leitura, e não uma estratégia diferente. Assim a diferença entre
 * dois níveis é explicável numa frase, e um bot difícil nunca joga pior que um
 * médio por acidente de implementação.
 */
export const DIFICULDADES = ['FACIL', 'MEDIO', 'DIFICIL', 'REALISTA'] as const;
export type Dificuldade = (typeof DIFICULDADES)[number];

/** Todas têm comportamento próprio. */
export const DIFICULDADES_PRONTAS: readonly Dificuldade[] = DIFICULDADES;

export const ROTULOS: Record<Dificuldade, string> = {
  FACIL: 'Fácil',
  MEDIO: 'Médio',
  DIFICIL: 'Difícil',
  REALISTA: 'Realista',
};

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
    ? apostaDeTesta(visao, dificuldade)
    : apostaPelaMao(visao, dificuldade);

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
function apostaPelaMao(visao: PlayerView, dificuldade: Dificuldade): number {
  const adversarios = Math.max(1, visao.playerOrder.length - 1);

  const esperadas = visao.hand.reduce((soma, carta) => {
    // MÉDIO estima no vácuo: `(v-2)/13` supõe o baralho inteiro intacto.
    // DIFÍCIL para cima conta o que já saiu — é a diferença entre "um Rei
    // costuma ganhar" e "os Ases já saíram, então o meu Rei ganha".
    const chance = contaCartas(dificuldade)
      ? chanceDeGanhar(carta.value, adversarios, visao)
      : (Math.max(0, carta.value - 2) / VALORES) ** adversarios;
    return soma + chance;
  }, 0);

  if (dificuldade !== 'REALISTA') return Math.round(esperadas);

  // REALISTA corrige pelo que a mesa já prometeu, proporcionalmente a quantos
  // já apostaram — ver `pressaoNasApostas`. A primeira versão comparava a soma
  // parcial contra a rodada inteira e fazia o bot apostar alto demais: ele
  // perdia de um que não corrigia nada. O torneio pegou (CA-348).
  const pressao = pressaoNasApostas(visao);
  const ajuste = Math.max(-0.6, Math.min(0.6, -pressao * 0.25));
  return Math.round(Math.max(0, esperadas + ajuste));
}

/** Contar cartas é o que separa MÉDIO de DIFÍCIL para cima. */
const contaCartas = (d: Dificuldade): boolean => d === 'DIFICIL' || d === 'REALISTA';

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
function apostaDeTesta(visao: PlayerView, dificuldade: Dificuldade): number {
  const visiveis = Object.values(visao.foreheadCards).map((c) => c.value);
  if (visiveis.length === 0) return 0;
  const maior = Math.max(...visiveis);

  let chance = (MAIOR - maior) / VALORES;

  if (dificuldade === 'REALISTA') {
    // A leitura que só existe nesta rodada: **as apostas dos outros falam da
    // MINHA carta**. Cada um deles vê a minha e não vê a própria, então quem
    // aposta que ganha está dizendo que o maior que ele enxerga é baixo — e a
    // minha carta é parte do que ele enxerga.
    //
    // Vale contra quem joga por raciocínio; contra um bot fácil, que aposta no
    // chute, é ruído. Por isso o peso é pequeno: informa, não decide.
    chance = Math.max(0, Math.min(1, chance + leituraDasApostas(visao)));
  }

  return chance > 0.5 ? 1 : 0;
}

/**
 * Quanto as apostas alheias sugerem que a minha carta é baixa (positivo) ou
 * alta (negativo), na rodada de testa.
 */
function leituraDasApostas(visao: PlayerView): number {
  let sinal = 0;

  for (const id of visao.playerOrder) {
    if (id === visao.viewerId) continue;
    const aposta = visao.bets[id];
    if (aposta === undefined) continue;

    // O maior que ELE enxerga, tirando a minha carta (que eu não conheço) e a
    // dele (que ele não enxerga).
    const outros = visao.playerOrder
      .filter((x) => x !== id && x !== visao.viewerId)
      .map((x) => visao.foreheadCards[x]?.value ?? 0);
    const maiorParaEle = outros.length > 0 ? Math.max(...outros) : 0;

    // Só informa quando o que ele vê, fora a minha, é baixo: aí a decisão dele
    // dependeu da minha carta. Se ele já enxerga um Ás, a aposta dele não diz
    // nada sobre mim.
    if (maiorParaEle >= 8) continue;

    sinal += aposta >= 1 ? 0.12 : -0.12;
  }

  return Math.max(-0.24, Math.min(0.24, sinal));
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

  const cartas = ordenadas(mao);
  const falta = faltaGanhar(visao);
  const naMesa = maiorNaMesa(visao);

  if (dificuldade === 'MEDIO') return jogadaMedia(cartas, falta > 0, naMesa).id;

  // --- DIFÍCIL e REALISTA -------------------------------------------------
  //
  // Os dois raciocinam sobre o ALVO, e não sobre a mão de agora: quantas mãos
  // ainda preciso, contra quantas ainda existem. É o que evita o erro clássico
  // do bot médio — ganhar cedo o que precisava ganhar e depois ser obrigado a
  // ganhar de novo com o que sobrou.
  const restantes = maosRestantes(visao);
  const atras = depoisDeMim(visao);

  // Não preciso de mais nenhuma: quero perder, e quero perder GASTANDO a carta
  // mais perigosa que ainda perca. Guardar carta alta quando não se quer mão é
  // guardar o próprio problema para a última.
  if (falta <= 0) return descarte(cartas, naMesa, atras, visao, dificuldade).id;

  // Preciso de todas as que restam: não há espaço para economizar.
  if (falta >= restantes) return (maiorQueGanha(cartas, naMesa) ?? cartas[cartas.length - 1]!).id;

  // Preciso de algumas: a menor que ainda ganha, para não gastar o que vai
  // fazer falta. Jogando por último isso é certeza; antes, é aposta — e o
  // REALISTA exige margem quando ainda há gente para jogar depois.
  const suficiente = dificuldade === 'REALISTA' && atras > 0
    ? cartas.find((c) => c.value > naMesa && chanceDeGanhar(c.value, atras, visao) >= 0.55)
      ?? cartas.find((c) => c.value > naMesa)
    : cartas.find((c) => c.value > naMesa);

  return (suficiente ?? cartas[0]!).id;
}

/** MÉDIO: menor que ganha, ou maior que perde. Sem alvo, sem posição. */
function jogadaMedia(cartas: readonly Card[], querMao: boolean, naMesa: number): Card {
  if (querMao) return cartas.find((c) => c.value > naMesa) ?? cartas[0]!;
  const perdedoras = cartas.filter((c) => c.value < naMesa);
  return perdedoras[perdedoras.length - 1] ?? cartas[0]!;
}

/** A maior carta que ainda ganha da mesa; `undefined` se nenhuma ganha. */
function maiorQueGanha(cartas: readonly Card[], naMesa: number): Card | undefined {
  const ganhadoras = cartas.filter((c) => c.value > naMesa);
  return ganhadoras[ganhadoras.length - 1];
}

/**
 * Descarte de quem NÃO quer a mão.
 *
 * A maior que ainda perde — livrar-se da carta mais perigosa sem levar a mão.
 * Se todas ganham, o estrago é inevitável e joga-se a menor.
 *
 * O REALISTA acrescenta o risco de quem ainda vai jogar: com gente atrás, uma
 * carta "que perde" para a mesa atual pode acabar ganhando se todos derem
 * carta baixa. Ele exige que a carta tenha chance real de perder, e não só que
 * esteja abaixo do que está na mesa agora.
 */
function descarte(
  cartas: readonly Card[],
  naMesa: number,
  atras: number,
  visao: PlayerView,
  dificuldade: Dificuldade,
): Card {
  const perdedoras = cartas.filter((c) => c.value < naMesa);

  if (dificuldade === 'REALISTA' && atras > 0) {
    const seguras = perdedoras.filter((c) => chanceDeGanhar(c.value, atras, visao) <= 0.35);
    const melhor = seguras[seguras.length - 1];
    if (melhor) return melhor;
  }

  return perdedoras[perdedoras.length - 1] ?? cartas[0]!;
}

export type { Card };
