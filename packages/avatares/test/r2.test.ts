/**
 * A implementação de R2 contra **a mesma** suíte de contrato (CA-392).
 *
 * Roda quando há `R2_ENDPOINT` e companhia; sem elas é pulada com aviso, em vez
 * de dar falso verde. Mesmo desenho de Redis e Postgres, e o CI confere que ela
 * de fato rodou — suíte pulada em silêncio é suíte que não existe.
 *
 * No desenvolvimento e no CI o outro lado é o **MinIO**, que fala S3:
 *
 *   docker run --rm -p 9100:9000 \
 *     -e MINIO_ROOT_USER=fdpteste -e MINIO_ROOT_PASSWORD=fdptestesenha \
 *     minio/minio server /data
 *
 *   R2_ENDPOINT=http://127.0.0.1:9100 R2_BUCKET=avatares \
 *   R2_ACCESS_KEY_ID=fdpteste R2_SECRET_ACCESS_KEY=fdptestesenha npm test
 *
 * **É este teste que prova a assinatura SigV4.** Ela é escrita à mão em
 * `assinatura.ts`, e a alternativa seria colar um vetor de referência num
 * `expect` — o que valeria pouco, porque um vetor confere um caso e um
 * servidor de verdade confere o protocolo. Se qualquer detalhe da canonização
 * estiver errado, tudo aqui fica vermelho.
 */

import { randomUUID } from 'node:crypto';
import { describe, it } from 'vitest';
import { assinar } from '../src/assinatura.js';
import { criarDepositoEmR2, configDoAmbiente } from '../src/r2.js';
import { descreverContratoDeDeposito } from './contrato.js';

const config = configDoAmbiente();

if (!config) {
  describe.skip('DepositoDeAvatares (R2)', () => {
    it('precisa de R2_ENDPOINT, R2_BUCKET, R2_ACCESS_KEY_ID e R2_SECRET_ACCESS_KEY', () => {});
  });
} else {
  descreverContratoDeDeposito({
    nome: 'R2',
    async criar() {
      // Um bucket por arnês: sem isso um teste enxerga o objeto que o anterior
      // deixou, e a suíte passa a depender da ordem.
      const bucket = `${config.bucket}-${randomUUID().slice(0, 8)}`;
      const url = new URL(`${config.endpoint.replace(/\/+$/, '')}/${bucket}`);

      const r = await fetch(url, {
        method: 'PUT',
        headers: assinar({ metodo: 'PUT', url }, {
          accessKeyId: config.accessKeyId,
          secretAccessKey: config.secretAccessKey,
          regiao: config.regiao ?? 'auto',
        }),
      });
      if (!r.ok && r.status !== 409) {
        throw new Error(`não deu para criar o bucket ${bucket}: ${String(r.status)} ${await r.text()}`);
      }

      return criarDepositoEmR2({ ...config, bucket });
    },
  });
}
