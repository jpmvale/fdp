/**
 * O depósito aceita gravar?
 *
 * Esta função existe por causa de um defeito que ficou invisível por semanas.
 * O volume dos avatares era montado como `root` e o processo roda como `node`:
 * toda gravação morria com `EACCES`, e ninguém soube. O código traduzia a
 * falha como "não consegui abrir essa imagem, ela pode estar corrompida", e
 * quem enviava ia procurar defeito na própria foto.
 *
 * O erro estava a um `touch` de distância de ser descoberto — o que faltava era
 * alguém dar o `touch`. É o que isto faz, na subida, uma vez.
 *
 * **Não é fatal.** Jogar não depende de foto (I-1), e derrubar o processo por
 * causa de um diretório tiraria do ar um jogo que funciona. O resultado vira
 * uma linha no log: ou "pronto para gravar", ou o motivo exato.
 */

import { createHash } from 'node:crypto';
import type { DepositoDeAvatares } from './tipos.js';

export type ResultadoDaSonda =
  | { ok: true }
  | { ok: false; etapa: 'guardar' | 'ler' | 'apagar' | 'conteudo'; erro: string };

/**
 * Grava, lê, confere e apaga um objeto de teste.
 *
 * As quatro etapas, e não só a primeira: permissão de escrita sem leitura, ou
 * um sistema de arquivos que aceita `write` e devolve lixo, são coisas que
 * existem. Cada etapa tem nome próprio no resultado porque "falhou" não diz a
 * quem procurar o quê.
 */
export async function sondarDeposito(deposito: DepositoDeAvatares): Promise<ResultadoDaSonda> {
  // Conteúdo fixo, então nome fixo: a sonda não acumula um objeto novo por
  // reinício, e reinícios simultâneos escrevem exatamente os mesmos bytes.
  const bytes = Buffer.from('sonda de escrita do fdp');
  const nome = `${createHash('sha256').update(bytes).digest('hex')}.webp`;

  try {
    await deposito.guardar(nome, bytes);
  } catch (erro) {
    return { ok: false, etapa: 'guardar', erro: String(erro) };
  }

  let lido: Buffer | undefined;
  try {
    lido = await deposito.ler(nome);
  } catch (erro) {
    return { ok: false, etapa: 'ler', erro: String(erro) };
  }
  if (!lido || Buffer.compare(lido, bytes) !== 0) {
    return { ok: false, etapa: 'conteudo', erro: 'o que voltou não é o que foi gravado' };
  }

  try {
    await deposito.apagar(nome);
  } catch (erro) {
    // Gravar e ler funcionam, e é isso que o produto precisa; não poder apagar
    // é um problema menor, e derrubar a sonda por ele esconderia a boa notícia.
    return { ok: false, etapa: 'apagar', erro: String(erro) };
  }

  return { ok: true };
}
