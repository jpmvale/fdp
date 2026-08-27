/**
 * Manda um arquivo para o R2. Serve ao backup do Postgres.
 *
 *   R2_ENDPOINT=... R2_BUCKET=... R2_ACCESS_KEY_ID=... R2_SECRET_ACCESS_KEY=... \
 *   npx tsx server/src/enviar-para-r2.ts <arquivo> [chave]
 *
 * **Por que não reusa `DepositoDeAvatares`.** Aquela interface valida o nome
 * como `<sha256>.webp` — de propósito, porque no depósito de avatares um nome
 * livre é uma porta para escrever em qualquer objeto do bucket. Um dump de
 * Postgres não tem esse formato, e afrouxar a validação de lá para caber aqui
 * seria enfraquecer a defesa de um caminho para atender outro. São dois usos
 * do mesmo protocolo, e só a **assinatura** é comum.
 *
 * A assinatura é a de `@fdp/avatares/assinatura`, provada contra um servidor
 * S3 de verdade no CI. Isto aqui não acrescenta criptografia nenhuma.
 */

import { readFile, stat } from 'node:fs/promises';
import { basename } from 'node:path';
import { assinar } from '@fdp/avatares/assinatura';

/**
 * Teto de um `PUT` só.
 *
 * O S3 aceita até ~5 GB num PUT simples; acima disso é preciso multipart, que
 * este script não faz. O limite existe para o script **falhar dizendo o que
 * houve** em vez de mandar um objeto truncado — um backup pela metade é pior
 * que backup nenhum, porque parece que existe.
 */
const TAMANHO_MAX = 4 * 1024 * 1024 * 1024;

async function principal(): Promise<void> {
  const arquivo = process.argv[2];
  if (!arquivo) {
    console.error('uso: enviar-para-r2.ts <arquivo> [chave]');
    process.exit(1);
  }

  const endpoint = process.env['R2_ENDPOINT'];
  const bucket = process.env['R2_BUCKET'];
  const accessKeyId = process.env['R2_ACCESS_KEY_ID'];
  const secretAccessKey = process.env['R2_SECRET_ACCESS_KEY'];
  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) {
    console.error('falta R2_ENDPOINT, R2_BUCKET, R2_ACCESS_KEY_ID ou R2_SECRET_ACCESS_KEY');
    process.exit(1);
  }

  const info = await stat(arquivo);
  if (info.size > TAMANHO_MAX) {
    console.error(
      `${arquivo} tem ${String(Math.round(info.size / 1024 / 1024))} MB e passa do teto de um PUT só.\n` +
      'Este script não faz multipart — mandar assim produziria um objeto truncado.',
    );
    process.exit(1);
  }
  if (info.size === 0) {
    // Um dump vazio é um `pg_dump` que falhou em silêncio. Subir isso por cima
    // de nada é o caminho para descobrir no dia da restauração.
    console.error(`${arquivo} está vazio — não vou subir um backup de zero byte.`);
    process.exit(1);
  }

  const chave = process.argv[3] ?? basename(arquivo);
  const url = new URL(`${endpoint.replace(/\/+$/, '')}/${bucket}/${chave}`);
  const corpo = await readFile(arquivo);

  const cabecalhos = assinar(
    {
      metodo: 'PUT',
      url,
      corpo,
      cabecalhos: { 'content-type': 'application/octet-stream' },
    },
    { accessKeyId, secretAccessKey, regiao: process.env['R2_REGIAO'] ?? 'auto' },
  );

  const r = await fetch(url, { method: 'PUT', headers: cabecalhos, body: new Uint8Array(corpo) });
  if (!r.ok) {
    console.error(`falhou com ${String(r.status)}: ${(await r.text().catch(() => '')).slice(0, 300)}`);
    process.exit(1);
  }

  /**
   * Confere o que subiu, e não só o código de retorno.
   *
   * Um `200` diz que o servidor aceitou, não que o objeto está lá com o
   * tamanho certo. É a mesma diferença entre "o dump rodou" e "o dump abre" —
   * que este projeto já aprendeu no `pg_restore --list`.
   */
  const conferencia = await fetch(url, {
    method: 'HEAD',
    headers: assinar({ metodo: 'HEAD', url }, {
      accessKeyId, secretAccessKey, regiao: process.env['R2_REGIAO'] ?? 'auto',
    }),
  });
  const tamanhoLa = Number(conferencia.headers.get('content-length') ?? -1);
  if (!conferencia.ok || tamanhoLa !== info.size) {
    console.error(
      `subiu mas não confere: ${String(conferencia.status)}, ` +
      `${String(tamanhoLa)} bytes lá contra ${String(info.size)} aqui`,
    );
    process.exit(1);
  }

  console.log(`ok ${bucket}/${chave} (${String(Math.round(info.size / 1024))} KB, conferido)`);
}

principal().catch((erro: unknown) => {
  console.error(erro);
  process.exit(1);
});
