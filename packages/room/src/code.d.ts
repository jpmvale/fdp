/**
 * Geração do código de convite (`06` §2).
 *
 * Cinco caracteres de um alfabeto sem `I`, `O`, `0` e `1` — os quatro que
 * viram erro quando alguém dita o código por voz ou lê numa tela pequena.
 * Espaço de 32⁵ ≈ 33,5 milhões.
 */
export declare function isBlockedCode(code: string): boolean;
export type RandomBytes = (length: number) => Uint8Array;
/**
 * Gera um código com o gerador fornecido.
 *
 * Rejeita o resto da divisão para não enviesar o alfabeto: 256 não é múltiplo
 * de 32... na verdade é, mas a rejeição fica aqui de qualquer forma porque o
 * alfabeto pode mudar, e viés silencioso em gerador é o tipo de bug que
 * ninguém encontra depois.
 */
export declare function generateCode(randomBytes: RandomBytes): string;
/**
 * Gera um código livre, evitando colisão e palavra bloqueada.
 *
 * Falha alto depois de `maxAttempts`: um código repetido colocaria duas mesas
 * na mesma sala, o que é pior do que uma criação de sala que dá erro.
 */
export declare function generateFreeCode(randomBytes: RandomBytes, isTaken: (code: string) => boolean, maxAttempts?: number): string;
export declare function normalizeCode(raw: string): string;
