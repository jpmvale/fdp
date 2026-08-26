/**
 * Quando cada aviso sonoro toca.
 *
 * Separado de `som.ts` de propósito: lá é *como* se produz o som, aqui é
 * *quando* ele faz sentido. Esta parte é lógica pura e testável; a outra
 * depende do `AudioContext` do navegador.
 */

/** O intervalo entre tiques, em ms, conforme o tempo aperta. */
export function intervaloDoTique(fracaoRestante: number): number | null {
  // Acima de um quarto do tempo não há urgência: silêncio.
  if (fracaoRestante > 0.25) return null;
  // De 25% a 0%, o intervalo cai de 700 ms para 180 ms. É a ACELERAÇÃO que
  // comunica, não o volume — como um pavio que encurta.
  const t = Math.max(0, Math.min(1, fracaoRestante / 0.25));
  return Math.round(180 + t * 520);
}

/** Urgência de 0 a 1, para a altura do tique. */
export function urgenciaDoTique(fracaoRestante: number): number {
  const t = Math.max(0, Math.min(1, fracaoRestante / 0.25));
  return 1 - t;
}

/**
 * Deve tocar o aviso de "sua vez" nesta transição?
 *
 * Só quando a vez PASSA a ser minha, nunca enquanto ela continua sendo — a
 * tela renderiza muitas vezes por segundo e um aviso por render seria um
 * alarme. E nunca com a mesa pausada: ali ninguém joga.
 */
export function deveAvisarVez(anterior: string | null, atual: string | null, eu: string, pausada: boolean): boolean {
  if (pausada) return false;
  return atual === eu && anterior !== eu;
}


/**
 * A duração de um prazo, deduzida sem o servidor mandar.
 *
 * O cliente recebe só o instante final, nunca quanto o prazo durava. A barra
 * normalizava pelo prazo da APOSTA (45 s) sempre — então a vez de jogar carta
 * (30 s) nascia em 67% e a vez de um bot (900 ms) nascia em 2%: a barra
 * praticamente nunca começava cheia. Guardar o maior restante já visto de cada
 * prazo dá a duração sem tabela de fases, e continua valendo para prazos que
 * ainda não existem.
 */
export interface PrazoVisto {
  prazo: number;
  total: number;
}

export function verPrazo(visto: PrazoVisto, prazo: number, agora: number): PrazoVisto {
  const restante = Math.max(1, prazo - agora);
  // Prazo diferente é prazo novo: a duração recomeça do que se vê agora.
  if (visto.prazo !== prazo) return { prazo, total: restante };
  // Mesmo prazo, restante maior que o conhecido: a primeira amostra pegou o
  // prazo já correndo. O maior restante visto é o palpite menos errado.
  return restante > visto.total ? { prazo, total: restante } : visto;
}

/** Quanto da barra ainda está cheia, de 0 a 1. */
export function fracaoDaBarra(visto: PrazoVisto, prazo: number, agora: number): number {
  const restante = Math.max(0, prazo - agora);
  return Math.min(1, restante / Math.max(1, visto.total));
}
