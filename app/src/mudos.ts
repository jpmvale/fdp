/**
 * Silenciar para mim (plano 03 §9.1).
 *
 * O item que o plano abriu e não fechou: D-8 tirou o host da mesa de fila, e o
 * RF-095 tinha acabado de dar a ele o poder de calar. Sobrava uma sala onde
 * ninguém cala ninguém.
 *
 * A resposta é **local**, e a diferença com o RF-095 é a coisa toda:
 *
 * - Calar do host é **moderação**: o servidor recusa a mensagem, e a pessoa
 *   fica sem voz para a mesa inteira. Exige autoridade, e por isso não existe
 *   entre estranhos.
 * - Calar para mim é **alívio**: a mensagem continua chegando e continua sendo
 *   entregue a todo mundo; só a minha tela deixa de mostrá-la. Não exige
 *   autoridade nenhuma porque não decide nada sobre ninguém.
 *
 * Por isso mora inteiro no cliente e nunca vai ao servidor. Mandar isto para o
 * servidor não acrescentaria nada e traria o pior de dois mundos: uma lista de
 * quem-não-gosta-de-quem guardada em algum lugar, e a chance de outra pessoa
 * descobrir que foi silenciada.
 *
 * A lista é POR SALA. O `playerId` só existe dentro de uma sala — na mesa
 * seguinte a mesma pessoa tem outro id —, então guardar por sala é o único
 * recorte que significa alguma coisa. Sobrevive a recarregar a página, e some
 * junto com a sala.
 */

const PREFIXO = 'fdp:mudos:';

/**
 * O pouco de `localStorage` que isto usa.
 *
 * Declarado como interface e recebido por parâmetro pelo mesmo motivo que o
 * relógio da sala e o `randomBytes` do código são injetados: dá para testar o
 * caso que interessa — o armazenamento que LANÇA — sem trazer um DOM inteiro
 * para dentro da suíte.
 */
export interface Armazem {
  getItem(chave: string): string | null;
  setItem(chave: string, valor: string): void;
  removeItem(chave: string): void;
  key(indice: number): string | null;
  readonly length: number;
}

/**
 * O armazenamento do navegador, ou nada.
 *
 * `localStorage` pode nem existir (renderização fora do navegador) e pode
 * lançar só de ser acessado. As duas coisas passam por aqui.
 */
function padrao(): Armazem | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/**
 * Toda leitura e escrita é protegida.
 *
 * `localStorage` não é um objeto confiável: aba anônima, site data bloqueado e
 * cota estourada fazem o ACESSO lançar, não só a escrita. Uma exceção aqui
 * derrubaria o chat inteiro por causa de uma conveniência.
 */
export function lerMudos(codigoDaSala: string, onde: Armazem | null = padrao()): Set<string> {
  try {
    const bruto = onde?.getItem(PREFIXO + codigoDaSala);
    if (!bruto) return new Set();
    const lido: unknown = JSON.parse(bruto);
    return new Set(Array.isArray(lido) ? lido.filter((x): x is string => typeof x === 'string') : []);
  } catch {
    return new Set();
  }
}

export function gravarMudos(
  codigoDaSala: string,
  mudos: Set<string>,
  onde: Armazem | null = padrao(),
): void {
  try {
    if (mudos.size === 0) onde?.removeItem(PREFIXO + codigoDaSala);
    else onde?.setItem(PREFIXO + codigoDaSala, JSON.stringify([...mudos]));
  } catch {
    // Sem onde guardar, a lista continua valendo nesta aba e morre com ela.
    // É pior que persistir, e é muito melhor que quebrar.
  }
}

/** Liga ou desliga, devolvendo um conjunto NOVO — o React precisa da troca. */
export function alternarMudo(mudos: Set<string>, playerId: string): Set<string> {
  const novo = new Set(mudos);
  if (novo.has(playerId)) novo.delete(playerId);
  else novo.add(playerId);
  return novo;
}

/**
 * As salas antigas saem do armazenamento.
 *
 * Sem isto, cada mesa de fila deixaria uma chave para trás e o `localStorage`
 * de quem joga muito viraria um cemitério de listas de salas que não existem
 * mais. Chamado ao entrar numa sala: é o momento em que já se sabe qual é a
 * atual, e é barato.
 */
export function limparOutrasSalas(codigoAtual: string, onde: Armazem | null = padrao()): void {
  try {
    if (!onde) return;
    const paraApagar: string[] = [];
    for (let i = 0; i < onde.length; i++) {
      const chave = onde.key(i);
      if (chave?.startsWith(PREFIXO) && chave !== PREFIXO + codigoAtual) paraApagar.push(chave);
    }
    for (const chave of paraApagar) onde.removeItem(chave);
  } catch {
    // Idem: limpeza é higiene, não requisito.
  }
}
