/**
 * Copia os avatares do disco para o R2, conferindo cada um (plano 02, F4).
 *
 *   AVATARES_DIR=/dados/avatares \
 *   R2_ENDPOINT=... R2_BUCKET=... R2_ACCESS_KEY_ID=... R2_SECRET_ACCESS_KEY=... \
 *   npx tsx server/src/migrar-avatares.ts [--aplicar]
 *
 * **Sem `--aplicar` ele não escreve nada.** Ensaio primeiro é o padrão porque
 * a informação mais valiosa desta migração aparece antes de qualquer cópia: se
 * há arquivo corrompido no volume, dá para saber isso sem tocar no destino.
 *
 * O relatório é o produto. Copiar bytes é a parte fácil; saber o que havia lá
 * é a parte que nunca foi feita.
 */

import { readdir } from 'node:fs/promises';
import { criarDepositoEmDisco, migrar, nomeValido } from '@fdp/avatares';
import { configDoAmbiente, criarDepositoEmR2 } from '@fdp/avatares/r2';

const APLICAR = process.argv.includes('--aplicar');

async function principal(): Promise<void> {
  const dir = process.env['AVATARES_DIR'];
  if (!dir) {
    console.error('falta AVATARES_DIR: é de onde os avatares saem');
    process.exit(1);
  }

  const config = configDoAmbiente();
  if (!config) {
    console.error('falta a configuração do R2 (R2_ENDPOINT, R2_BUCKET, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY)');
    process.exit(1);
  }

  const origem = criarDepositoEmDisco(dir);
  const destino = criarDepositoEmR2(config);

  // Listar é do disco, e por isso não está na interface: o depósito não
  // precisa saber enumerar para servir uma foto, e exigir isso dele obrigaria
  // o R2 a implementar paginação que nada mais usa.
  const tudo = await readdir(dir);
  const nomes = tudo.filter(nomeValido);
  const ignorados = tudo.length - nomes.length;

  console.log(`${String(nomes.length)} avatares em ${dir}` +
    (ignorados > 0 ? ` (${String(ignorados)} arquivos ignorados por não terem nome de avatar)` : ''));
  console.log(APLICAR ? `copiando para ${config.bucket}…` : 'ENSAIO: nada será escrito. Use --aplicar para valer.\n');

  const relatorio = await migrar({
    origem,
    // No ensaio o destino é de mentira: lê como vazio e engole a gravação.
    // Assim a CONFERÊNCIA roda inteira — que é o que interessa antes de
    // decidir copiar — sem que um byte saia do lugar.
    destino: APLICAR ? destino : {
      guardar: () => Promise.resolve(),
      ler: () => Promise.resolve(undefined),
      apagar: () => Promise.resolve(),
    },
    nomes,
    aoAndar: (nome, resultado) => {
      // Só o que exige atenção. Uma linha por avatar num volume com milhares
      // esconderia justamente as que importam.
      if (resultado === 'CORROMPIDO' || resultado === 'falhou') {
        console.log(`  ${resultado}: ${nome}`);
      }
    },
  });

  console.log('');
  console.log(`íntegros e copiados: ${String(relatorio.copiados.length)}`);
  console.log(`já estavam no destino: ${String(relatorio.jaExistiam.length)}`);
  console.log(`nomes inválidos: ${String(relatorio.invalidos.length)}`);
  console.log(`falharam: ${String(relatorio.falharam.length)}`);
  console.log(`CORROMPIDOS: ${String(relatorio.corrompidos.length)}`);

  for (const nome of relatorio.corrompidos) {
    console.log(`  ${nome} — o conteúdo não bate com o hash do próprio nome`);
  }
  for (const f of relatorio.falharam) {
    console.log(`  ${f.nome} — ${f.erro}`);
  }

  /**
   * Corrupção **falha** o script, mesmo com tudo o mais tendo copiado bem.
   *
   * Ela significa que um avatar em produção não é o que diz ser, e isso precisa
   * de um par de olhos — não de um `exit 0` no meio de um relatório longo que
   * ninguém termina de ler. Os arquivos íntegros já foram para o destino; rodar
   * de novo depois de resolver não custa nada, porque a migração é idempotente.
   */
  if (relatorio.corrompidos.length > 0 || relatorio.falharam.length > 0) {
    console.error('\nterminou com pendências acima');
    process.exit(1);
  }

  console.log(APLICAR ? '\nmigração completa' : '\nensaio limpo: dá para rodar com --aplicar');
}

principal().catch((erro: unknown) => {
  console.error(erro);
  process.exit(1);
});
