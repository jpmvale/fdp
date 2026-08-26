/**
 * Assinatura AWS SigV4, o suficiente para PUT, GET e DELETE num bucket.
 *
 * **Por que não o SDK.** `@aws-sdk/client-s3` traz dezenas de pacotes para
 * cobrir uma API que não usamos: multipart, paginação, presign, retry
 * configurável, middleware. Aqui são três verbos, sem query, sem listagem. O
 * projeto inteiro tem oito dependências de produção, e cada uma delas é uma
 * coisa que precisa ser auditada, atualizada e carregada no container.
 *
 * SigV4 é um procedimento fechado e público: canonizar o pedido, resumir,
 * derivar a chave por data/região/serviço, assinar. São umas oitenta linhas, e
 * o teste as prova contra o **vetor oficial da AWS** — o mesmo com que qualquer
 * implementação se verifica. Isso é o que torna a decisão defensável: não é
 * "escrevi criptografia", é "implementei um formato e conferi contra o gabarito
 * de quem o publicou".
 *
 * O que NÃO fazemos aqui, e é de propósito: nada de URL assinada. As fotos são
 * servidas pela nossa origem (RF-081), então a assinatura nunca sai do
 * servidor e nunca chega ao navegador.
 */

import { createHash, createHmac } from 'node:crypto';

const ALGORITMO = 'AWS4-HMAC-SHA256';

const sha256 = (dado: string | Buffer): string =>
  createHash('sha256').update(dado).digest('hex');

const hmac = (chave: Buffer | string, dado: string): Buffer =>
  createHmac('sha256', chave).update(dado).digest();

export interface CredenciaisS3 {
  accessKeyId: string;
  secretAccessKey: string;
  /** O R2 aceita `auto`; a S3 de verdade quer a região do bucket. */
  regiao: string;
  servico?: string;
}

export interface PedidoAssinado {
  metodo: 'GET' | 'PUT' | 'DELETE' | 'HEAD';
  url: URL;
  /** Corpo do PUT. Ausente vale como corpo vazio, que tem hash próprio. */
  corpo?: Buffer | undefined;
  /** Cabeçalhos que ENTRAM na assinatura, além de `host` e os `x-amz-*`. */
  cabecalhos?: Record<string, string> | undefined;
  agora?: Date | undefined;
}

/**
 * Devolve os cabeçalhos prontos para `fetch`, `Authorization` incluído.
 *
 * Assinar é uma função pura de (pedido, credencial, instante) — nada de estado,
 * nada de rede. É por isso que dá para prová-la contra o vetor da AWS sem subir
 * nada.
 */
export function assinar(
  pedido: PedidoAssinado,
  cred: CredenciaisS3,
): Record<string, string> {
  const servico = cred.servico ?? 's3';
  const agora = pedido.agora ?? new Date();

  // `20130524T000000Z` e `20130524`. O `Z` não é decoração: a assinatura é
  // sempre em UTC, e usar o fuso local produziria uma que o servidor recusa
  // por estar fora da janela — de madrugada, ou sempre, dependendo de onde o
  // container roda.
  const carimbo = agora.toISOString().replace(/[-:]|\.\d{3}/g, '');
  const dia = carimbo.slice(0, 8);

  /**
   * O hash do corpo vai num cabeçalho, e ele é OBRIGATÓRIO no S3.
   *
   * É o que amarra a assinatura ao conteúdo: sem ele, quem interceptasse o
   * pedido poderia trocar os bytes mantendo a assinatura válida.
   */
  const hashDoCorpo = sha256(pedido.corpo ?? Buffer.alloc(0));

  const cabecalhos: Record<string, string> = {
    ...(pedido.cabecalhos ?? {}),
    host: pedido.url.host,
    'x-amz-content-sha256': hashDoCorpo,
    'x-amz-date': carimbo,
  };

  // Canonização: nomes em minúscula, ordenados, valores com espaço colapsado.
  // A ordem importa porque o servidor refaz esta mesma string do zero — uma
  // diferença de uma vírgula e a assinatura não bate, sem dizer por quê.
  const nomes = Object.keys(cabecalhos)
    .map((n) => n.toLowerCase())
    .sort();
  const assinados = nomes.join(';');
  const canonicos = nomes
    .map((n) => {
      const bruto = cabecalhos[Object.keys(cabecalhos).find((k) => k.toLowerCase() === n)!]!;
      return `${n}:${bruto.trim().replace(/\s+/g, ' ')}\n`;
    })
    .join('');

  const pedidoCanonico = [
    pedido.metodo,
    caminhoCanonico(pedido.url.pathname),
    pedido.url.searchParams.toString(),
    canonicos,
    assinados,
    hashDoCorpo,
  ].join('\n');

  const escopo = `${dia}/${cred.regiao}/${servico}/aws4_request`;
  const paraAssinar = [ALGORITMO, carimbo, escopo, sha256(pedidoCanonico)].join('\n');

  // A chave é derivada em quatro passos, cada um estreitando o alcance: uma
  // assinatura vazada serve para um dia, numa região, num serviço.
  const kData = hmac(`AWS4${cred.secretAccessKey}`, dia);
  const kRegiao = hmac(kData, cred.regiao);
  const kServico = hmac(kRegiao, servico);
  const kAssinatura = hmac(kServico, 'aws4_request');
  const assinatura = createHmac('sha256', kAssinatura).update(paraAssinar).digest('hex');

  return {
    ...cabecalhos,
    authorization:
      `${ALGORITMO} Credential=${cred.accessKeyId}/${escopo}, ` +
      `SignedHeaders=${assinados}, Signature=${assinatura}`,
  };
}

/**
 * O caminho vai codificado, e **a barra não**.
 *
 * `encodeURIComponent` escaparia `/` para `%2F` e o objeto viraria outro. Os
 * nossos nomes são hexadecimal e `.webp`, então nada disto teria efeito hoje —
 * está aqui porque a assinatura tem de valer para o caminho que de fato for
 * enviado, e não para o que hoje por acaso não precisa de escape.
 */
function caminhoCanonico(caminho: string): string {
  return caminho
    .split('/')
    .map((p) => encodeURIComponent(p).replace(/[!'()*]/g, (c) =>
      `%${c.charCodeAt(0).toString(16).toUpperCase()}`))
    .join('/');
}
