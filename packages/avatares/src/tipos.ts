/**
 * Onde as fotos de avatar ficam guardadas (plano 02).
 *
 * Três métodos, e a razão de serem só três é que o processamento **não mora
 * aqui**. Quem decide o que uma foto vira continua sendo o servidor (D-9): este
 * depósito recebe bytes já reduzidos, já reescritos em WebP, já sem EXIF, e o
 * único trabalho dele é não perdê-los.
 *
 * A separação existe porque as fotos precisam sair do volume do container. Elas
 * não têm backup nenhum hoje — o Postgres tem dump diário e restauração
 * testada, e os avatares têm uma linha no `compose` dizendo que o volume não é
 * opcional. Uma interface com duas implementações é o mesmo caminho de
 * `RoomStore` e de `@fdp/contas`, e pelo mesmo motivo: dá para rodar tudo sem
 * infraestrutura, e divergência entre implementações vira teste vermelho em vez
 * de defeito que só aparece em produção.
 */

/**
 * O nome de um objeto no depósito.
 *
 * É sempre `<sha256 do conteúdo>.webp` ou `<sha256>-64.webp`. **O nome é
 * derivado do conteúdo**, e isso não é detalhe de implementação — é o que faz
 * gravar duas vezes ser inofensivo, duas pessoas com a mesma foto dividirem um
 * objeto, e o cache poder ser imutável, porque conteúdo diferente nunca reusa
 * um nome.
 */
export type NomeDeAvatar = string;

export interface DepositoDeAvatares {
  /**
   * Grava, se ainda não existir.
   *
   * Idempotente **pelo nome**, e é aí que a escolha do hash se paga: reescrever
   * um objeto por outro byte-a-byte igual só criaria uma janela em que ele não
   * existe. Chamar duas vezes com o mesmo nome não pode falhar nem duplicar.
   */
  guardar(nome: NomeDeAvatar, bytes: Buffer): Promise<void>;

  /**
   * `undefined` quando não existe.
   *
   * Ausência **não é erro** e não lança: um avatar apagado, ou um nome que
   * alguém digitou na barra de endereços, precisa virar um 404 tranquilo. Só
   * falha de verdade — rede, credencial, disco — é que estoura, porque essa
   * merece aparecer no log.
   */
  ler(nome: NomeDeAvatar): Promise<Buffer | undefined>;

  /** Apagar o que já não existe é sucesso, pela mesma razão de `guardar`. */
  apagar(nome: NomeDeAvatar): Promise<void>;
}

/**
 * Um nome é sempre `<64 hex>.webp` ou `<64 hex>-64.webp`.
 *
 * Vive aqui, e não no servidor HTTP, porque **todo** depósito precisa dela: no
 * disco um nome com `..` escolhe qualquer arquivo da máquina, e no R2 ele
 * escolhe qualquer objeto do bucket. Deixar a checagem só na borda HTTP
 * significaria confiar que nunca haverá um segundo caminho até aqui — e o
 * script de migração já é o segundo.
 */
export function nomeValido(nome: string): boolean {
  return /^[0-9a-f]{64}(-64)?\.webp$/.test(nome);
}

/** Quem recebe um nome inválido não tem o que negociar. */
export class NomeInvalido extends Error {
  constructor(nome: string) {
    // O nome entra na mensagem cortado: ele vem do cliente, e um log não é
    // lugar para despejar um megabyte que alguém mandou como "nome".
    super(`nome de avatar inválido: ${JSON.stringify(nome.slice(0, 80))}`);
    this.name = 'NomeInvalido';
  }
}
