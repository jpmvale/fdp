/**
 * Quando uma partida aconteceu, dito como gente diz.
 *
 * Puro e recebendo o "agora" por parâmetro pelo mesmo motivo do relógio da
 * sala: teste que depende de `Date.now()` é teste que passa hoje e reprova na
 * virada do ano — e este código existe justamente para tratar viradas.
 *
 * O idioma é só pt-BR (`08` RF-006), então não há tabela de tradução: as
 * palavras estão aqui mesmo. `Intl` já vem no navegador e não pesa nada no
 * pacote (RNF-055).
 */

const MS_POR_DIA = 86_400_000;

/**
 * O dia do calendário, no fuso de quem está lendo.
 *
 * Contar dias por diferença de milissegundos parece equivalente e não é: uma
 * partida às 23h50 e outra às 00h10 estão a vinte minutos uma da outra e são
 * dias diferentes, e é o dia diferente que a pessoa lembra. Zerar a hora antes
 * de comparar é o que faz "ontem" querer dizer ontem.
 */
function meiaNoite(instante: number): number {
  const d = new Date(instante);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Quantos dias de calendário separam os dois instantes. */
export function diasDeDiferenca(instante: number, agora: number): number {
  return Math.round((meiaNoite(agora) - meiaNoite(instante)) / MS_POR_DIA);
}

/**
 * O rótulo de um dia no histórico.
 *
 * "Hoje" e "ontem" porque é assim que alguém se refere à partida de ontem —
 * ninguém diz "joguei em 1º de setembro" no dia seguinte. De anteontem em
 * diante vale a data, que é o que passa a ser mais fácil de situar.
 *
 * O ANO entra quando não é o corrente. Sem isso, "12 de janeiro" de dois anos
 * atrás se lê como janeiro deste ano — e num histórico ordenado do mais novo
 * para o mais velho, essa confusão acontece exatamente na parte de baixo da
 * lista, onde ninguém está prestando atenção.
 */
export function rotuloDoDia(instante: number, agora: number): string {
  const dias = diasDeDiferenca(instante, agora);
  if (dias === 0) return 'hoje';
  if (dias === 1) return 'ontem';

  const quando = new Date(instante);
  const mesmoAno = quando.getFullYear() === new Date(agora).getFullYear();
  return quando.toLocaleDateString('pt-BR', {
    day: 'numeric',
    month: 'long',
    ...(mesmoAno ? {} : { year: 'numeric' }),
  });
}

/**
 * Data e hora por extenso, para o `title` e para quem usa leitor de tela.
 *
 * O rótulo do grupo é curto de propósito, e curto perde informação: "ontem" não
 * diz a hora, e duas partidas do mesmo dia ficam indistinguíveis. Isto é a
 * versão completa, disponível sem ocupar espaço na tela (RNF-038).
 */
export function dataPorExtenso(instante: number): string {
  return new Date(instante).toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

/**
 * Agrupa uma lista já ordenada do mais recente para o mais antigo.
 *
 * Grupo por dia, e não uma coluna de data em cada linha, por uma razão de
 * espaço: a linha do histórico já carrega colocação, tamanho da mesa, rodadas,
 * acertos, elo e nota, e a tela é desenhada para 360 px. Uma coluna a mais
 * espremeria todas as outras; um cabeçalho a cada dia não custa largura
 * nenhuma — e ainda junta as quatro partidas da mesma noite, que é como elas
 * aconteceram.
 *
 * Estável: a ordem de entrada é preservada dentro de cada grupo, e os grupos
 * saem na ordem em que apareceram. Reordenar aqui faria a paginação do perfil
 * (RF-090) embaralhar o que o servidor já ordenou.
 */
export function agruparPorDia<T>(
  itens: T[],
  quando: (item: T) => number,
  agora: number,
): { rotulo: string; itens: T[] }[] {
  const grupos: { rotulo: string; itens: T[] }[] = [];
  for (const item of itens) {
    const rotulo = rotuloDoDia(quando(item), agora);
    const ultimo = grupos[grupos.length - 1];
    if (ultimo && ultimo.rotulo === rotulo) ultimo.itens.push(item);
    else grupos.push({ rotulo, itens: [item] });
  }
  return grupos;
}
