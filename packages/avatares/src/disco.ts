/**
 * Depósito em disco — o que já existia, agora atrás da interface.
 *
 * Continua sendo a implementação padrão e a de desenvolvimento: sem nenhuma
 * variável configurada, o jogo grava avatar num diretório e ponto. É a mesma
 * escolha do `RoomStore` em memória e do `@fdp/contas` em memória — nada do
 * produto pode exigir infraestrutura para rodar na máquina de alguém.
 */

import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { NomeInvalido, nomeValido, type DepositoDeAvatares } from './tipos.js';

export function criarDepositoEmDisco(diretorio: string): DepositoDeAvatares {
  /**
   * O `mkdir` acontece uma vez, não a cada gravação.
   *
   * A promessa fica guardada em vez do booleano: duas gravações simultâneas na
   * primeira foto do dia esperariam a mesma criação, em vez de disputá-la. É
   * `recursive`, então concorrência não daria erro — mas seria trabalho
   * repetido no caminho de todo envio, para sempre, por causa do primeiro.
   */
  let pronto: Promise<unknown> | null = null;
  const garantirDiretorio = (): Promise<unknown> => {
    pronto ??= mkdir(diretorio, { recursive: true });
    return pronto;
  };

  const caminho = (nome: string): string => {
    // Conferido aqui, e não só em quem chama: este é o ponto onde um nome vira
    // um caminho de verdade, e `..%2f` escolheria qualquer arquivo da máquina.
    if (!nomeValido(nome)) throw new NomeInvalido(nome);
    return join(diretorio, nome);
  };

  return {
    async guardar(nome, bytes) {
      const destino = caminho(nome);
      await garantirDiretorio();

      /**
       * Grava num temporário e RENOMEIA.
       *
       * Antes era `writeFile` direto, depois de um `access` para ver se já
       * existia. Duas coisas erradas nisso. O `access` seguido de `write` é uma
       * corrida — dois envios da mesma foto passam pela checagem juntos —, e
       * ela era inofensiva só porque o conteúdo é idêntico por construção. E
       * `writeFile` num arquivo que alguém está lendo o expõe **truncado**: no
       * meio da escrita, quem pediu aquele avatar recebe meio WebP.
       *
       * `rename` no mesmo sistema de arquivos é atômico e **substitui** o
       * destino: quem lê vê o arquivo antigo ou o novo, nunca um pela metade,
       * e nunca a ausência dos dois. Apagar o destino antes seria reabrir a
       * janela que este método existe para fechar.
       *
       * O rascunho é único **por chamada**, e não por processo. A primeira
       * versão usava o pid, o que parecia bastar — e o teste de gravações
       * simultâneas derrubou na hora: cinco chamadas do mesmo processo dividem
       * o pid, então escreviam no mesmo rascunho, uma o renomeava e as outras
       * estouravam com `ENOENT`. Duas fotos diferentes chegando juntas é o caso
       * comum numa mesa de oito, não uma corrida exótica.
       */
      const rascunho = `${destino}.${randomUUID()}.tmp`;
      try {
        await writeFile(rascunho, bytes);
        await rename(rascunho, destino);
      } finally {
        // Se algo estourou no meio, o rascunho não pode ficar para trás.
        await rm(rascunho, { force: true }).catch(() => {});
      }
    },

    async ler(nome) {
      try {
        return await readFile(caminho(nome));
      } catch (erro) {
        // Só ausência vira `undefined`. Permissão negada, disco cheio ou um
        // diretório onde devia haver arquivo são problemas nossos, e um 404
        // silencioso os esconderia por meses.
        if ((erro as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
        throw erro;
      }
    },

    async apagar(nome) {
      await rm(caminho(nome), { force: true });
    },
  };
}
