/**
 * Hash de senha com `scrypt` do `node:crypto` (plano 01, D-6).
 *
 * argon2id seria melhor, e não está aqui por uma razão declarada: seria a
 * primeira dependência NATIVA do projeto, que precisa compilar na imagem e no
 * CI. `scrypt` é memória-dura, está na biblioteca padrão e é aceito pelo OWASP.
 * O formato guardado carrega os parâmetros, então trocar de algoritmo depois é
 * migração de linha, não de esquema — ver `PREFIXO`.
 *
 * O projeto já tomou essa decisão uma vez, ao escrever o JWT sobre
 * `node:crypto` em vez de trazer biblioteca (`session.ts`).
 */

import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const derivar = promisify(scrypt) as (
  senha: string, sal: Buffer, tamanho: number, opcoes: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

/**
 * `N=2^15` com `r=8` custa ~32 MB e ~50 ms por tentativa nesta VPS.
 *
 * O OWASP sugere `2^17` para scrypt puro; aqui seriam 128 MB por login, e um
 * punhado de logins simultâneos derrubaria um processo que também está rodando
 * partidas em tempo real. `2^15` mais o limite de tentativas de `LIMITS` é a
 * troca que este projeto faz — e ela é explícita, não esquecimento.
 */
const N = 2 ** 15;
const R = 8;
const P = 1;
const TAMANHO = 32;
const SAL = 16;

/** `maxmem` precisa caber `128 * N * r`, senão o próprio Node recusa. */
const MAXMEM = 128 * N * R * 2;

const PREFIXO = 'scrypt';

export async function gerarHash(senha: string): Promise<string> {
  const sal = randomBytes(SAL);
  const digest = await derivar(senha, sal, TAMANHO, { N, r: R, p: P, maxmem: MAXMEM });
  return [PREFIXO, N, R, P, sal.toString('base64url'), digest.toString('base64url')].join('$');
}

/**
 * Confere a senha contra o hash guardado.
 *
 * Os parâmetros saem do PRÓPRIO hash, não das constantes acima: quando `N`
 * subir, os hashes antigos continuam conferindo com o `N` deles. Sem isso,
 * mudar o custo invalidaria a senha de todo mundo de uma vez.
 */
export async function conferirSenha(senha: string, hash: string): Promise<boolean> {
  const partes = hash.split('$');
  if (partes.length !== 6 || partes[0] !== PREFIXO) return false;

  const n = Number(partes[1]);
  const r = Number(partes[2]);
  const p = Number(partes[3]);
  if (!Number.isInteger(n) || !Number.isInteger(r) || !Number.isInteger(p)) return false;
  // Um hash adulterado pedindo N gigante viraria negação de serviço contra o
  // próprio servidor: cada tentativa alocaria memória sem limite.
  if (n > 2 ** 20 || r > 32 || p > 16) return false;

  let sal: Buffer;
  let esperado: Buffer;
  try {
    sal = Buffer.from(partes[4]!, 'base64url');
    esperado = Buffer.from(partes[5]!, 'base64url');
  } catch {
    return false;
  }
  if (esperado.length === 0) return false;

  const obtido = await derivar(senha, sal, esperado.length, {
    N: n, r, p, maxmem: 128 * n * r * 2,
  });

  // Tempo constante: a diferença entre "errou no primeiro byte" e "errou no
  // último" é um oráculo.
  return obtido.length === esperado.length && timingSafeEqual(obtido, esperado);
}

/**
 * O hash de mentira de CA-363.
 *
 * Sem ele, e-mail que não existe responde MUITO mais rápido que senha errada —
 * porque não há hash a calcular —, e o tempo de resposta vira uma consulta de
 * "esta pessoa tem conta aqui?". Com perfil público por link (D-4), isso é
 * exatamente o que não pode vazar.
 *
 * O sal é fixo de propósito: nada aqui é secreto, o ponto é gastar o mesmo
 * trabalho. Gerar sal aleatório só somaria entropia inútil ao caminho.
 */
const SAL_FALSO = Buffer.alloc(SAL, 7);

export async function gastarComoSeFosse(senha: string): Promise<void> {
  await derivar(senha, SAL_FALSO, TAMANHO, { N, r: R, p: P, maxmem: MAXMEM });
}

/**
 * Senha mínima: 10 caracteres, sem regra de composição.
 *
 * "Ao menos uma maiúscula e um símbolo" produz senha PIOR — leva a `Senha@123`
 * — e é o que o NIST desaconselha desde 2017. Comprimento é o que importa. O
 * teto existe porque scrypt processa a entrada inteira: senha de 1 MB seria
 * negação de serviço de graça.
 */
export const SENHA_MIN = 10;
export const SENHA_MAX = 200;

export function senhaAceitavel(senha: string): boolean {
  return senha.length >= SENHA_MIN && senha.length <= SENHA_MAX;
}
