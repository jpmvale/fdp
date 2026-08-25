/**
 * PRNG determinístico semeado por string.
 *
 * RJ-144: o `seed` vem de um CSPRNG (imprevisível); o embaralhamento é
 * determinístico a partir dele (reproduzível). Segurança pelo segredo do seed,
 * testabilidade pelo determinismo do PRNG.
 *
 * RJ-140: nada aqui usa `Math.random()`.
 */
export interface Rng {
    /** Inteiro sem sinal de 32 bits. */
    nextU32(): number;
    /** Inteiro uniforme em [0, maxExclusive), sem viés de módulo. */
    nextInt(maxExclusive: number): number;
    /** String hexadecimal de `bytes * 2` caracteres. */
    nextHex(bytes: number): string;
}
/** xoshiro128** — rápido, período longo, distribuição uniforme. */
export declare function createRng(seed: string): Rng;
