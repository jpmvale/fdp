/**
 * O pareamento (plano 03 §5).
 *
 * **A decisão é pura.** `decidirFormacao` é uma função de `(bilhetes, agora,
 * janela)` para "esperar / abrir janela / formar mesa" — sem rede, sem relógio
 * e sem socket. É o mesmo desenho do elo e dos bots, e pelo mesmo motivo: uma
 * fila que forma mesa errada é um defeito que só aparece com gente esperando.
 *
 * O que NÃO é puro — os sockets, o intervalo, criar a sala — vive em
 * `fila-viva.ts`, que só chama esta função e obedece.
 */

import { ELO_INICIAL, LIMITS, MODOS_DE_FILA, type Avatar, type ModoDeFila } from '@fdp/protocol';

// O vocabulário mora no protocolo: o cliente precisa dele para desenhar a tela,
// e dois lugares declarando os mesmos dois nomes é o desenho que garante que um
// dia eles discordem.
export const MODOS = MODOS_DE_FILA;
export type { ModoDeFila };

/**
 * Quantos bastam para a mesa existir, e quantos cabem nela.
 *
 * O mínimo é 4 (pedido) e não os 2 de `LIMITS.minPlayers`: numa sala de amigos
 * dois se divertem, mas uma fila que junta duas pessoas estranhas entrega a
 * pior versão do jogo — apostar contra uma pessoa só é quase não apostar.
 */
export const MINIMO_NA_MESA = 4;
export const MAXIMO_NA_MESA = LIMITS.maxPlayers;

/**
 * Quanto a mesa espera, depois de já ter o mínimo, para ver se cresce.
 *
 * Um minuto: tempo de chegar mais gente numa fila movimentada, e curto o
 * bastante para não parecer travado numa fila vazia.
 */
export const JANELA_MS = 60_000;

/** A faixa inicial de elo, e o quanto ela alarga a cada `PASSO_MS` de espera. */
export const FAIXA_INICIAL = 150;
export const FAIXA_PASSO = 50;
export const PASSO_MS = 30_000;
/**
 * Depois disto a faixa deixa de existir.
 *
 * Sem teto de propósito: uma fila que prefere não formar mesa a formar uma mesa
 * desigual acaba não formando mesa nenhuma — e às três da manhã a mesa desigual
 * é a única que existe.
 */
export const SEM_FAIXA_APOS_MS = 300_000;

export interface Bilhete {
  /** O `playerId` que a pessoa vai ter na mesa. Nasce aqui e não muda. */
  id: string;
  modo: ModoDeFila;
  apelido: string;
  avatar: Avatar;
  /** Slug da conta, quando logado. `null` na fila normal sem conta (D-1). */
  conta: string | null;
  contaId: string | null;
  /** O elo de agora. Na fila normal ninguém usa, e vale o inicial. */
  elo: number;
  entrouEm: number;
}

export type Decisao =
  | { tipo: 'ESPERAR' }
  | { tipo: 'ABRIR_JANELA'; ate: number }
  /** Caiu abaixo do mínimo com a janela aberta: a espera perdeu o sentido. */
  | { tipo: 'FECHAR_JANELA' }
  | { tipo: 'FORMAR'; mesa: Bilhete[] };

/**
 * A largura da faixa de elo de quem já esperou tanto.
 *
 * Quem espera há mais tempo tem a faixa mais larga — e é a dele que vale para
 * o grupo (ver `compativeis`). Assim a fila prioriza destravar quem está há
 * mais tempo parado, em vez de deixá-lo para trás enquanto forma mesas
 * confortáveis entre os que acabaram de chegar.
 */
export function faixaDe(esperaMs: number): number {
  if (esperaMs >= SEM_FAIXA_APOS_MS) return Infinity;
  return FAIXA_INICIAL + FAIXA_PASSO * Math.floor(esperaMs / PASSO_MS);
}

/**
 * Quem pode sentar com quem, ancorado em quem espera há mais tempo.
 *
 * Na fila normal não há faixa nenhuma: sem elo, não há o que comparar, e
 * inventar uma comparação ali seria pareamento de mentira.
 */
export function compativeis(bilhetes: Bilhete[], agora: number, modo: ModoDeFila): Bilhete[] {
  // Ordem de chegada, sempre: é a única ordem justa de uma fila, e é ela que
  // decide quem entra quando sobra gente para mais de uma mesa.
  const porChegada = [...bilhetes].sort((a, b) => a.entrouEm - b.entrouEm);
  if (modo === 'NORMAL') return porChegada;

  const ancora = porChegada[0];
  if (!ancora) return [];
  const faixa = faixaDe(agora - ancora.entrouEm);
  return porChegada.filter((b) => Math.abs(b.elo - ancora.elo) <= faixa);
}

/**
 * O que fazer agora com esta fila.
 *
 * `janelaAte` é `null` quando não há janela aberta. Quem chama guarda esse
 * estado — a função não guarda nada, e é isso que a deixa testável instante a
 * instante.
 */
export function decidirFormacao(
  bilhetes: Bilhete[],
  agora: number,
  janelaAte: number | null,
  modo: ModoDeFila,
): Decisao {
  const grupo = compativeis(bilhetes, agora, modo);

  // Mesa cheia forma na hora: esperar o resto da janela só faria os oito
  // esperarem por um nono que não caberia.
  if (grupo.length >= MAXIMO_NA_MESA) {
    return { tipo: 'FORMAR', mesa: grupo.slice(0, MAXIMO_NA_MESA) };
  }

  if (grupo.length < MINIMO_NA_MESA) {
    // Alguém saiu e o grupo encolheu. A janela existia para deixar uma mesa
    // possível crescer; sem mesa possível, mantê-la aberta faria a próxima
    // formação acontecer com um relógio herdado de outro grupo.
    return janelaAte === null ? { tipo: 'ESPERAR' } : { tipo: 'FECHAR_JANELA' };
  }

  if (janelaAte === null) return { tipo: 'ABRIR_JANELA', ate: agora + JANELA_MS };
  if (agora >= janelaAte) return { tipo: 'FORMAR', mesa: grupo };
  return { tipo: 'ESPERAR' };
}

/** O bilhete de quem entra. O elo só significa alguma coisa na ranqueada. */
export function novoBilhete(dados: {
  id: string;
  modo: ModoDeFila;
  apelido: string;
  avatar: Avatar;
  conta?: string | null;
  contaId?: string | null;
  elo?: number;
  agora: number;
}): Bilhete {
  return {
    id: dados.id,
    modo: dados.modo,
    apelido: dados.apelido,
    avatar: dados.avatar,
    conta: dados.conta ?? null,
    contaId: dados.contaId ?? null,
    elo: dados.elo ?? ELO_INICIAL,
    entrouEm: dados.agora,
  };
}
