/**
 * Depósito em R2 (plano 02, F3).
 *
 * O R2 fala S3, e o que usamos dele são três verbos sem query nem listagem:
 * `PUT`, `GET`, `DELETE` num objeto. Por isso a assinatura é nossa (ver
 * `assinatura.ts`) em vez do SDK da AWS — que traria dezenas de pacotes para
 * cobrir uma API que não tocamos.
 *
 * A prova de que a assinatura está certa **não é comparação com um vetor
 * colado num teste**: é a suíte de contrato rodando contra um servidor S3 de
 * verdade (MinIO em container, como já se faz com Redis e Postgres). Se
 * qualquer detalhe da canonização estiver errado, nenhum teste passa.
 */

import { assinar, type CredenciaisS3 } from './assinatura.js';
import { NomeInvalido, nomeValido, type DepositoDeAvatares } from './tipos.js';

export interface ConfigR2 {
  /** Ex.: `https://<conta>.r2.cloudflarestorage.com`. Sem o bucket. */
  endpoint: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** O R2 aceita `auto`. A S3 de verdade quer a região do bucket. */
  regiao?: string;
  /** Injetável para o teste; por padrão o `fetch` do Node. */
  buscar?: typeof fetch;
}

/**
 * Lê a configuração do ambiente, ou `null` se ela não estiver completa.
 *
 * **Tudo ou nada, de propósito.** Meia configuração — endpoint sem chave,
 * bucket sem segredo — não pode virar um depósito que aceita gravar e falha em
 * toda chamada. Ou o R2 está configurado, ou o jogo usa o disco; um estado
 * intermediário só produziria fotos perdidas com um log confuso.
 */
export function configDoAmbiente(env: NodeJS.ProcessEnv = process.env): ConfigR2 | null {
  const endpoint = env['R2_ENDPOINT'];
  const bucket = env['R2_BUCKET'];
  const accessKeyId = env['R2_ACCESS_KEY_ID'];
  const secretAccessKey = env['R2_SECRET_ACCESS_KEY'];
  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) return null;

  return {
    endpoint, bucket, accessKeyId, secretAccessKey,
    ...(env['R2_REGIAO'] ? { regiao: env['R2_REGIAO'] } : {}),
  };
}

/** Falha do depósito remoto. Distinta de "não existe", que devolve `undefined`. */
export class FalhaDoDeposito extends Error {
  constructor(readonly operacao: string, readonly status: number, corpo: string) {
    // O corpo entra cortado: uma resposta de erro do S3 é XML, e o log não
    // precisa dele inteiro para dizer o que aconteceu.
    super(`${operacao} falhou com ${String(status)}: ${corpo.slice(0, 200)}`);
    this.name = 'FalhaDoDeposito';
  }
}

export function criarDepositoEmR2(config: ConfigR2): DepositoDeAvatares {
  const buscar = config.buscar ?? fetch;
  const cred: CredenciaisS3 = {
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
    regiao: config.regiao ?? 'auto',
  };

  const urlDe = (nome: string): URL => {
    // Conferido aqui pelo mesmo motivo do disco: um nome com `..` escolheria
    // outro objeto do bucket, e este é o ponto onde ele vira endereço.
    if (!nomeValido(nome)) throw new NomeInvalido(nome);
    // Caminho, e não subdomínio: o R2 usa `path-style`, e o MinIO do teste
    // também. Um bucket no host exigiria DNS curinga para nada.
    return new URL(`${config.endpoint.replace(/\/+$/, '')}/${config.bucket}/${nome}`);
  };

  return {
    async guardar(nome, bytes) {
      const url = urlDe(nome);
      const cabecalhos = assinar(
        {
          metodo: 'PUT',
          url,
          corpo: bytes,
          // `content-type` entra na ASSINATURA, e não só no pedido: é o que
          // impede alguém no meio do caminho de trocar o tipo do objeto
          // gravado. Todo avatar é WebP por construção — `processarAvatar`
          // reescreve tudo nesse formato.
          cabecalhos: { 'content-type': 'image/webp' },
        },
        cred,
      );

      const r = await buscar(url, { method: 'PUT', headers: cabecalhos, body: new Uint8Array(bytes) });
      // Gravar por cima do mesmo nome é o caso NORMAL, não um erro: duas
      // pessoas com a mesma foto chegam aqui, e o conteúdo é idêntico por
      // construção, porque o nome é o hash dele.
      if (!r.ok) throw new FalhaDoDeposito('guardar', r.status, await r.text().catch(() => ''));
    },

    async ler(nome) {
      const url = urlDe(nome);
      const r = await buscar(url, {
        method: 'GET',
        headers: assinar({ metodo: 'GET', url }, cred),
      });

      // 404 é ausência, e ausência não é erro — é o caminho de um avatar
      // apagado ou de um endereço digitado à mão.
      if (r.status === 404) return undefined;
      if (!r.ok) throw new FalhaDoDeposito('ler', r.status, await r.text().catch(() => ''));
      return Buffer.from(await r.arrayBuffer());
    },

    async apagar(nome) {
      const url = urlDe(nome);
      const r = await buscar(url, {
        method: 'DELETE',
        headers: assinar({ metodo: 'DELETE', url }, cred),
      });

      // O S3 responde 204 tanto para "apagou" quanto para "não existia", que é
      // exatamente a idempotência que o contrato pede. 404 também vale.
      if (!r.ok && r.status !== 404) {
        throw new FalhaDoDeposito('apagar', r.status, await r.text().catch(() => ''));
      }
    },
  };
}
