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

/** cyrb128: string → 4 palavras de 32 bits, para semear o xoshiro. */
function seedWords(seed: string): [number, number, number, number] {
  let h1 = 1779033703;
  let h2 = 3144134277;
  let h3 = 1013904242;
  let h4 = 2773480762;
  for (let i = 0; i < seed.length; i++) {
    const k = seed.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  return [
    (h1 ^ h2 ^ h3 ^ h4) >>> 0,
    (h2 ^ h1) >>> 0,
    (h3 ^ h1) >>> 0,
    (h4 ^ h1) >>> 0,
  ];
}

/** xoshiro128** — rápido, período longo, distribuição uniforme. */
export function createRng(seed: string): Rng {
  let [s0, s1, s2, s3] = seedWords(seed);
  // Estado todo-zero é degenerado; o seeding acima torna isso praticamente
  // impossível, mas a guarda custa nada.
  if ((s0 | s1 | s2 | s3) === 0) s0 = 0x9e3779b9;

  const nextU32 = (): number => {
    const scaled = Math.imul(s1, 5) >>> 0;
    const rotated = ((scaled << 7) | (scaled >>> 25)) >>> 0;
    const out = Math.imul(rotated, 9) >>> 0;

    const t = (s1 << 9) >>> 0;
    s2 = (s2 ^ s0) >>> 0;
    s3 = (s3 ^ s1) >>> 0;
    s1 = (s1 ^ s2) >>> 0;
    s0 = (s0 ^ s3) >>> 0;
    s2 = (s2 ^ t) >>> 0;
    s3 = ((s3 << 11) | (s3 >>> 21)) >>> 0;
    return out;
  };

  const nextInt = (maxExclusive: number): number => {
    if (!Number.isInteger(maxExclusive) || maxExclusive <= 0) {
      throw new RangeError(`nextInt exige inteiro positivo, recebeu ${maxExclusive}`);
    }
    // Rejeição para eliminar viés de módulo (RJ-040/CA-209).
    const limit = Math.floor(0x100000000 / maxExclusive) * maxExclusive;
    let value = nextU32();
    while (value >= limit) value = nextU32();
    return value % maxExclusive;
  };

  const nextHex = (bytes: number): string => {
    let out = '';
    // Uma extração de 32 bits rende 4 bytes; evita gastar um u32 por byte.
    for (let i = 0; i < bytes; i += 4) {
      out += nextU32().toString(16).padStart(8, '0');
    }
    return out.slice(0, bytes * 2);
  };

  return { nextU32, nextInt, nextHex };
}
