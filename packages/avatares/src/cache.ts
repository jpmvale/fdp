/**
 * Cache em memória na frente do depósito (plano 02 §5).
 *
 * Sem ele, cada assento na mesa vira uma ida ao depósito a cada render. Com o
 * disco isso é barato e feio; com o R2 é uma chamada de rede cobrada, oito
 * vezes por mesa, durante uma partida de quarenta minutos. O cache é o que
 * torna o bucket viável, e por isso ele entra ANTES do R2 e não depois.
 *
 * É a camada 2 das três de §5. A 1 é o `immutable` na resposta, que faz o
 * navegador nem perguntar; a 3 é o depósito. Esta existe para o primeiro
 * pedido de cada avatar depois de um deploy, e para quem chega sem cache.
 */

import type { DepositoDeAvatares } from './tipos.js';

/**
 * Teto do cache, **em bytes** e não em número de itens.
 *
 * Um avatar de 256 px em WebP tem uns 8 KB, então 32 MB guardam uns quatro mil
 * — muito mais gente do que jamais estará online junto. Contar itens daria o
 * mesmo resultado hoje e é o tipo de escolha que envelhece mal: no dia em que
 * alguém guardar aqui uma variante maior, o teto por contagem vira um teto de
 * memória que ninguém escreveu e ninguém revisou.
 */
export const CACHE_BYTES_MAX = 32 * 1024 * 1024;

export interface DepositoComCache extends DepositoDeAvatares {
  /** Para o teste medir, em vez de supor. */
  estatisticas(): { acertos: number; erros: number; bytes: number; itens: number };
}

/**
 * Embrulha um depósito. **Não** é uma implementação de `DepositoDeAvatares`
 * paralela: é a mesma interface, com o de baixo fazendo o trabalho.
 */
export function comCache(
  base: DepositoDeAvatares,
  limiteDeBytes = CACHE_BYTES_MAX,
): DepositoComCache {
  /**
   * `Map` porque a ordem de inserção do JavaScript é a ordem de despejo.
   *
   * Um item relido é apagado e reinserido, então ele volta para o fim da fila e
   * o `Map` vira um LRU sem estrutura extra. Não é esperteza: é a estrutura que
   * a linguagem já dá com a garantia de ordem que a especificação promete.
   */
  const itens = new Map<string, Buffer>();
  let bytes = 0;
  let acertos = 0;
  let erros = 0;

  const esquecer = (nome: string): void => {
    const tinha = itens.get(nome);
    if (tinha === undefined) return;
    bytes -= tinha.byteLength;
    itens.delete(nome);
  };

  const guardarNoCache = (nome: string, valor: Buffer): void => {
    // Um item maior que o teto inteiro não entra. Sem esta guarda, o laço de
    // despejo abaixo esvaziaria o cache inteiro para caber nele — e então o
    // despejaria também, deixando o cache vazio a cada pedido daquele arquivo.
    if (valor.byteLength > limiteDeBytes) return;

    esquecer(nome);
    itens.set(nome, valor);
    bytes += valor.byteLength;

    // Despeja do mais antigo até caber. `next().value` é o primeiro inserido.
    while (bytes > limiteDeBytes) {
      const maisAntigo = itens.keys().next().value;
      if (maisAntigo === undefined) break;
      esquecer(maisAntigo);
    }
  };

  return {
    async guardar(nome, valor) {
      await base.guardar(nome, valor);
      // Só depois de gravar, e nunca antes: um cache preenchido por uma
      // gravação que falhou serviria um avatar que não existe no depósito, e
      // ele sumiria sozinho no próximo deploy — o pior tipo de bug, o que se
      // conserta ao reiniciar.
      guardarNoCache(nome, valor);
    },

    async ler(nome) {
      const guardado = itens.get(nome);
      if (guardado !== undefined) {
        acertos++;
        // Releitura promove: sai e volta para o fim da fila de despejo.
        itens.delete(nome);
        itens.set(nome, guardado);
        return guardado;
      }

      erros++;
      const valor = await base.ler(nome);
      // Ausência NÃO é cacheada. Um nome inexistente é ou um engano ou alguém
      // varrendo endereços; guardar isso deixaria o cache cheio de nada e, pior,
      // faria uma foto recém-enviada continuar 404 até o item vencer.
      if (valor !== undefined) guardarNoCache(nome, valor);
      return valor;
    },

    async apagar(nome) {
      await base.apagar(nome);
      esquecer(nome);
    },

    estatisticas: () => ({ acertos, erros, bytes, itens: itens.size }),
  };
}
