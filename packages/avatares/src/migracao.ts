/**
 * Copiar os avatares de um depósito para outro (plano 02 §6, F4).
 *
 * O valor real desta função não é copiar — é **conferir**. O nome de cada
 * objeto é o sha256 do conteúdo dele, então dá para saber, arquivo por arquivo,
 * se o que está guardado é o que deveria estar. É a primeira vez que os
 * avatares em produção vão ser verificados, e a escolha do hash como nome (do
 * plano 01) se paga aqui pela segunda vez.
 *
 * **Um arquivo que não bate com o próprio nome é denunciado, nunca copiado**
 * (CA-394). Copiar seria carregar a corrupção para o destino e apagar a única
 * evidência de que ela existiu.
 */

import { createHash } from 'node:crypto';
import { nomeValido, type DepositoDeAvatares } from './tipos.js';

export interface RelatorioDeMigracao {
  copiados: string[];
  /** Já estavam lá, com o conteúdo certo. */
  jaExistiam: string[];
  /** Conteúdo não bate com o hash do nome. **Não** foram copiados. */
  corrompidos: string[];
  /** Nome fora do formato. Também não foram copiados. */
  invalidos: string[];
  /** Sumiram entre listar e ler, ou a leitura falhou. */
  falharam: { nome: string; erro: string }[];
}

export interface OpcoesDeMigracao {
  origem: DepositoDeAvatares;
  destino: DepositoDeAvatares;
  /** Os nomes a copiar. Vem de quem sabe listar — o disco, no nosso caso. */
  nomes: readonly string[];
  /** Para acompanhar uma migração longa sem esperar o fim. */
  aoAndar?: ((nome: string, resultado: string) => void) | undefined;
}

/** O nome que ESTES bytes deveriam ter. */
function nomeEsperado(bytes: Buffer, pequeno: boolean): string {
  return `${createHash('sha256').update(bytes).digest('hex')}${pequeno ? '-64' : ''}.webp`;
}

export async function migrar(opcoes: OpcoesDeMigracao): Promise<RelatorioDeMigracao> {
  const r: RelatorioDeMigracao = {
    copiados: [], jaExistiam: [], corrompidos: [], invalidos: [], falharam: [],
  };
  const anotar = (nome: string, resultado: string): void => opcoes.aoAndar?.(nome, resultado);

  for (const nome of opcoes.nomes) {
    if (!nomeValido(nome)) {
      r.invalidos.push(nome);
      anotar(nome, 'inválido');
      continue;
    }

    let bytes: Buffer | undefined;
    try {
      bytes = await opcoes.origem.ler(nome);
    } catch (erro) {
      r.falharam.push({ nome, erro: String(erro) });
      anotar(nome, 'falhou');
      continue;
    }
    if (!bytes) {
      // Sumiu entre listar e ler. Não é corrupção nem erro: alguém apagou o
      // avatar no meio da migração, o que é uma coisa normal de acontecer.
      r.falharam.push({ nome, erro: 'sumiu entre listar e ler' });
      anotar(nome, 'sumiu');
      continue;
    }

    /**
     * A conferência, que é o motivo desta função existir.
     *
     * A variante pequena tem sufixo `-64` e é uma imagem DIFERENTE, então o
     * hash dela não é o do nome — o `-64` é derivado do hash da grande. Só a
     * grande pode ser verificada assim, e é o que se faz: verificar o que dá,
     * em vez de não verificar nada por causa do caso que não dá.
     */
    const ehPequena = nome.endsWith('-64.webp');
    if (!ehPequena && nomeEsperado(bytes, false) !== nome) {
      r.corrompidos.push(nome);
      anotar(nome, 'CORROMPIDO');
      continue;
    }

    try {
      const jaLa = await opcoes.destino.ler(nome);
      if (jaLa && Buffer.compare(jaLa, bytes) === 0) {
        r.jaExistiam.push(nome);
        anotar(nome, 'já estava');
        continue;
      }
      await opcoes.destino.guardar(nome, bytes);
      r.copiados.push(nome);
      anotar(nome, 'copiado');
    } catch (erro) {
      r.falharam.push({ nome, erro: String(erro) });
      anotar(nome, 'falhou');
    }
  }

  return r;
}

/**
 * Escreve nos dois durante a janela de corte (§6, passo 1).
 *
 * A assimetria entre os dois é deliberada e é o ponto inteiro: a **origem**
 * manda, e falha nela é falha do envio; o **destino** é onde estamos entrando,
 * e falha nele não pode derrubar quem está trocando de foto. Um erro no
 * destino vira uma chamada a `aoFalhar` — que é onde o log mora — e o envio
 * segue.
 *
 * Trocar os papéis depois (passo 3) é trocar a ordem dos argumentos, e nada
 * mais. É por isso que a escrita dupla é um embrulho, e não um `if` espalhado
 * por dentro das duas implementações.
 */
export function escreverNosDois(
  principal: DepositoDeAvatares,
  secundario: DepositoDeAvatares,
  aoFalhar: (operacao: string, nome: string, erro: unknown) => void,
): DepositoDeAvatares {
  const tentar = async (operacao: string, nome: string, acao: Promise<unknown>): Promise<void> => {
    try {
      await acao;
    } catch (erro) {
      aoFalhar(operacao, nome, erro);
    }
  };

  return {
    async guardar(nome, bytes) {
      await principal.guardar(nome, bytes);
      await tentar('guardar', nome, secundario.guardar(nome, bytes));
    },
    ler: (nome) => principal.ler(nome),
    async apagar(nome) {
      await principal.apagar(nome);
      // Apagar também vai nos dois: sem isto, o secundário acumula o que já
      // foi removido, e no dia do corte ressuscita avatares que alguém tirou.
      await tentar('apagar', nome, secundario.apagar(nome));
    },
  };
}
