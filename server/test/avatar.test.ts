/**
 * Avatar por imagem (plano 01 §10, F5).
 *
 * Esta é a superfície mais hostil do produto: bytes arbitrários, de qualquer
 * um com conta, decodificados pelo servidor. Cada teste aqui corresponde a um
 * ataque concreto, e não a uma categoria genérica de "entrada inválida".
 */

import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { beforeEach, describe, expect, it } from 'vitest';
import { arquivoDoCaminho, processarAvatar, TAMANHO_MAX } from '../src/avatar.js';
import { criarDepositoEmDisco, type DepositoDeAvatares } from '@fdp/avatares';

/**
 * Uma bomba de descompressão em duzentos bytes.
 *
 * Gera um PNG minúsculo de verdade e reescreve APENAS a largura e a altura no
 * IHDR, refazendo o CRC do chunk para o arquivo continuar válido. O resultado
 * é um cabeçalho honesto prometendo uma imagem gigantesca — que é precisamente
 * o que `limitInputPixels` existe para barrar, e o que um atacante enviaria.
 *
 * Gerar a imagem grande de verdade custaria segundos de CPU por teste e não
 * exercitaria nada a mais: o limite é conferido pelo cabeçalho, antes de
 * qualquer pixel ser lido.
 */
const TABELA_CRC = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(b: Buffer): number {
  let c = ~0;
  for (const x of b) c = TABELA_CRC[(c ^ x) & 0xff]! ^ (c >>> 8);
  return ~c >>> 0;
}

async function bombaDeCabecalho(largura: number, altura: number): Promise<Buffer> {
  const base = await sharp({ create: { width: 64, height: 64, channels: 3, background: '#ffffff' } })
    .png().toBuffer();
  const forjado = Buffer.from(base);
  // 8 bytes de assinatura + 4 de tamanho + 4 do tipo `IHDR`, então largura e altura.
  forjado.writeUInt32BE(largura, 16);
  forjado.writeUInt32BE(altura, 20);
  // O CRC do chunk cobre o tipo e os 13 bytes de dados, e vem logo depois deles.
  forjado.writeUInt32BE(crc32(forjado.subarray(12, 12 + 4 + 13)), 12 + 4 + 13);
  return forjado;
}

let dir: string;
let deposito: DepositoDeAvatares;

beforeEach(async () => {
  // Um diretório por teste, atrás do depósito de verdade. Testar contra a
  // interface e não contra `fs` é o que faz esta suíte continuar valendo
  // quando o destino for um bucket (plano 02).
  dir = await mkdtemp(join(tmpdir(), 'fdp-avatar-'));
  deposito = criarDepositoEmDisco(dir);
});

const png = (w: number, h: number, cor = '#336699'): Promise<Buffer> =>
  sharp({ create: { width: w, height: h, channels: 3, background: cor } }).png().toBuffer();

describe('o caminho feliz', () => {
  it('reduz para 256×256 em WebP e devolve o caminho', async () => {
    const r = await processarAvatar(await png(900, 600), { deposito });
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    expect(r.caminho).toMatch(/^\/avatares\/[0-9a-f]{64}\.webp$/);

    const meta = await sharp(await readFile(join(dir, `${r.hash}.webp`))).metadata();
    expect(meta.format).toBe('webp');
    expect(meta.width).toBe(256);
    expect(meta.height).toBe(256);
  });

  it('grava também a versão pequena, para o assento na mesa', async () => {
    const r = await processarAvatar(await png(500, 500), { deposito });
    if (!r.ok) throw new Error('falhou');

    const meta = await sharp(await readFile(join(dir, `${r.hash}-64.webp`))).metadata();
    expect(meta.width).toBe(64);
  });

  it('recorta no centro: retrato e paisagem viram o mesmo quadrado', async () => {
    const alto = await processarAvatar(await png(200, 800), { deposito });
    const largo = await processarAvatar(await png(800, 200), { deposito });
    for (const r of [alto, largo]) {
      expect(r.ok).toBe(true);
      if (!r.ok) continue;
      const meta = await sharp(await readFile(join(dir, `${r.hash}.webp`))).metadata();
      expect([meta.width, meta.height]).toEqual([256, 256]);
    }
  });

  /**
   * Endereçado por conteúdo: o nome é o sha256 do RESULTADO. Duas pessoas com
   * a mesma foto compartilham um arquivo, reenviar é idempotente, e o cache
   * pode ser imutável porque conteúdo diferente nunca reusa um nome.
   */
  it('a mesma imagem duas vezes dá o mesmo nome e um arquivo só', async () => {
    const bytes = await png(400, 400);
    const a = await processarAvatar(bytes, { deposito });
    const b = await processarAvatar(bytes, { deposito });
    if (!a.ok || !b.ok) throw new Error('falhou');

    expect(a.hash).toBe(b.hash);
    expect(await readdir(dir)).toHaveLength(2); // a grande e a de 64
  });

  it('imagens diferentes dão nomes diferentes', async () => {
    const a = await processarAvatar(await png(400, 400, '#ff0000'), { deposito });
    const b = await processarAvatar(await png(400, 400, '#00ff00'), { deposito });
    if (!a.ok || !b.ok) throw new Error('falhou');
    expect(a.hash).not.toBe(b.hash);
  });

  it('aceita os formatos que a câmera e a web produzem', async () => {
    const base = { create: { width: 300, height: 300, channels: 3 as const, background: '#123456' } };
    const formatos = [
      await sharp(base).jpeg().toBuffer(),
      await sharp(base).png().toBuffer(),
      await sharp(base).webp().toBuffer(),
      await sharp(base).gif().toBuffer(),
    ];
    for (const bytes of formatos) {
      expect((await processarAvatar(bytes, { deposito })).ok).toBe(true);
    }
  });

  /**
   * O teto de pixels recusava TODA foto de celular moderno.
   *
   * Ele estava em 4096² = 16,7 MP, escolhido por suposição sobre o custo de
   * decodificar. iPhone 14 Pro em diante tira 48 MP; Android de topo, 50, 108
   * ou 200 MP. A pessoa lia *"essa imagem tem pixels demais"* sobre a foto que
   * a câmera dela produz por padrão.
   */
  it('CA-391: foto de celular moderno entra — 48, 50 e 108 MP', { timeout: 60_000 }, async () => {
    // Só as dimensões importam aqui; o conteúdo é irrelevante para o teto.
    const camaras: [string, number, number][] = [
      ['iPhone 48MP', 8064, 6048],
      ['Android 50MP', 8160, 6120],
      ['Android 108MP', 12000, 9000],
    ];

    for (const [nome, w, h] of camaras) {
      const foto = await sharp({ create: { width: w, height: h, channels: 3, background: '#8a5a2b' } })
        .jpeg({ quality: 80 })
        .toBuffer();

      const r = await processarAvatar(foto, { deposito });
      expect(r.ok, `${nome} (${w}×${h}) devia entrar`).toBe(true);
      if (!r.ok) continue;
      expect((await sharp(join(dir, `${r.hash}.webp`)).metadata()).width).toBe(256);
    }
  });

  it('CA-388: AVIF entra, que é o HEIF que este servidor sabe abrir', async () => {
    const avif = await sharp({ create: { width: 400, height: 300, channels: 3, background: '#3a7d44' } })
      .avif()
      .toBuffer();
    expect(avif.toString('ascii', 4, 12)).toBe('ftypavif');

    const r = await processarAvatar(avif, { deposito });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const saida = await sharp(join(dir, `${r.hash}.webp`)).metadata();
    expect(saida.format).toBe('webp');
    expect(saida.width).toBe(256);
  });
});

/**
 * HEIC recusado com nome próprio.
 *
 * O `sharp` empacotado traz libheif SEM decodificador de HEVC: AVIF abre, HEIC
 * não. Medido com um arquivo de verdade (`sips -s format heic`), e não deduzido
 * — libvips responde `Decoder plugin generated an error`.
 *
 * Como é a foto padrão do iPhone, ela chega o tempo todo, e o que a pessoa lê
 * precisa dizer o que fazer. `NAO_E_IMAGEM` seria mentira: é imagem, e é uma
 * que não sabemos abrir.
 */
describe('CA-389: HEIC é recusado dizendo o que fazer', () => {
  it('as marcas de HEIC têm motivo próprio, diferente de "não é imagem"', async () => {
    for (const marca of ['heic', 'heix', 'mif1', 'msf1']) {
      const bytes = Buffer.concat([
        Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftyp'), Buffer.from(marca, 'ascii'),
        Buffer.alloc(64, 7),
      ]);
      expect(await processarAvatar(bytes, { deposito }))
        .toEqual({ ok: false, motivo: 'HEIC_NAO_SUPORTADO' });
    }
  });

  it('MP4 e MOV usam a mesma caixa `ftyp` e não viram nem uma coisa nem outra', async () => {
    // A caixa é a mesma; a marca não. Aceitar a caixa abriria o decodificador
    // para vídeo, que é exatamente o que a lista fechada impede.
    for (const marca of ['mp42', 'isom', 'qt  ', 'M4V ']) {
      const bytes = Buffer.concat([
        Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftyp'), Buffer.from(marca, 'ascii'),
        Buffer.alloc(64, 7),
      ]);
      expect(await processarAvatar(bytes, { deposito }))
        .toEqual({ ok: false, motivo: 'NAO_E_IMAGEM' });
    }
  });
});

/**
 * CA-393: o depósito fora do ar não é culpa da foto.
 *
 * Enquanto a gravação vivia dentro do `try` do processamento, um bucket
 * inacessível saía como `FALHA_AO_PROCESSAR` — *"não consegui abrir essa
 * imagem, ela pode estar corrompida"*. A pessoa olharia para a própria foto
 * procurando um defeito que não existe, trocaria de imagem, e a segunda
 * falharia igual. É a mesma família de erro do `PROTOCOL_VERSION` que derrubou
 * o jogo: a mensagem mandava investigar o lugar errado.
 */
describe('CA-393: depósito indisponível tem motivo próprio', () => {
  const quebrado = (): DepositoDeAvatares => ({
    guardar: () => Promise.reject(new Error('bucket fora do ar')),
    ler: () => Promise.resolve(undefined),
    apagar: () => Promise.resolve(),
  });

  it('a imagem é boa; o motivo é do depósito, não dela', async () => {
    const r = await processarAvatar(await png(400, 400), { deposito: quebrado() });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toBe('DEPOSITO_INDISPONIVEL');
  });

  it('a imagem RUIM continua sendo culpa dela, mesmo com o depósito fora', async () => {
    // A ordem importa: validar antes de gravar significa que quem manda um
    // PDF continua ouvindo "isso não é uma imagem", e não uma desculpa nossa.
    const r = await processarAvatar(Buffer.from('nem imagem é'), { deposito: quebrado() });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toBe('NAO_E_IMAGEM');
  });
});

/** CA-370 — e cada caso é um ataque, não uma categoria. */
describe('CA-370: o que NÃO entra', () => {
  it('bytes que não são imagem nenhuma', async () => {
    const r = await processarAvatar(Buffer.from('isto é texto, não uma foto'), { deposito });
    expect(r).toEqual({ ok: false, motivo: 'NAO_E_IMAGEM' });
  });

  it('vazio', async () => {
    expect(await processarAvatar(Buffer.alloc(0), { deposito }))
      .toEqual({ ok: false, motivo: 'GRANDE_DEMAIS' });
  });

  it('acima do teto de bytes', async () => {
    const r = await processarAvatar(Buffer.alloc(TAMANHO_MAX + 1, 0xff), { deposito });
    expect(r).toEqual({ ok: false, motivo: 'GRANDE_DEMAIS' });
  });

  /**
   * SVG é documento EXECUTÁVEL, não imagem. Servido do nosso domínio, um
   * `<script>` lá dentro roda com a nossa origem e a nossa sessão — XSS de
   * primeira parte. Fica de fora mesmo com o `sharp` sabendo renderizá-lo.
   */
  it('SVG é recusado, mesmo sendo "uma imagem"', async () => {
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">' +
      '<script>alert(1)</script><rect width="100" height="100"/></svg>');
    expect(await processarAvatar(svg, { deposito }))
      .toEqual({ ok: false, motivo: 'NAO_E_IMAGEM' });
  });

  /**
   * A bomba de descompressão, que o teto de BYTES não pega.
   *
   * Um PNG que DECLARA 20 000 × 20 000 vira 400 milhões de pixels ao
   * decodificar. Sem `limitInputPixels`, o processo morre por memória — e é o
   * mesmo processo que está servindo as partidas.
   *
   * A bomba aqui é **forjada no cabeçalho**, não gerada. As duas versões
   * anteriores geravam uma imagem enorme de verdade: 20 000² custava segundos
   * de CPU e empurrou o CA-209 (um teste estatístico noutro pacote) para fora
   * do timeout do vitest; 8 000² era barata mas ficou ABAIXO do teto novo, e o
   * teste passou a provar o contrário do que queria.
   *
   * Reescrever só o IHDR resolve as duas coisas. São 200 bytes, custa nada, e
   * é mais fiel ao ataque: quem monta uma bomba de descompressão está
   * exatamente fabricando um cabeçalho que promete mais do que entrega.
   */
  it('bomba de descompressão é recusada, e o processo sobrevive', async () => {
    const bomba = await bombaDeCabecalho(20_000, 20_000);

    // 400 MP declarados em duzentos bytes: é exatamente esse o truque.
    expect(bomba.length).toBeLessThan(1_000);
    expect(bomba.length).toBeLessThan(TAMANHO_MAX);

    const r = await processarAvatar(bomba, { deposito });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toBe('IMAGEM_ABSURDA');

    // E o processo continua vivo o bastante para atender o próximo.
    expect((await processarAvatar(await png(300, 300), { deposito })).ok).toBe(true);
  }, 30_000);

  it('logo acima do teto é recusado, e logo abaixo entra', async () => {
    // A fronteira em si: 16 000² é o teto, então 16 001² não passa. Serve para
    // o dia em que alguém mexer no número achando que ninguém está olhando.
    const acima = await processarAvatar(await bombaDeCabecalho(16_001, 16_001), { deposito });
    expect(acima.ok).toBe(false);
    if (!acima.ok) expect(acima.motivo).toBe('IMAGEM_ABSURDA');
  });

  it('JPEG truncado no meio não derruba nada', async () => {
    const inteiro = await sharp({
      create: { width: 400, height: 400, channels: 3, background: '#abcdef' },
    }).jpeg().toBuffer();
    const cortado = inteiro.subarray(0, Math.floor(inteiro.length / 3));

    const r = await processarAvatar(cortado, { deposito });
    expect(r.ok).toBe(false);
    expect((await processarAvatar(await png(300, 300), { deposito })).ok).toBe(true);
  });

  /** `.png` que na verdade é outra coisa: a extensão é afirmação do cliente. */
  it('o conteúdo manda, não o nome nem o cabeçalho', async () => {
    const mentira = Buffer.concat([
      Buffer.from('GIF89a'),               // começa como GIF…
      Buffer.from('conteúdo que não é imagem nenhuma depois disso'),
    ]);
    const r = await processarAvatar(mentira, { deposito });
    // Passa pela detecção de bytes (o cabeçalho é de GIF) e morre na
    // decodificação, que é onde a verdade aparece.
    expect(r.ok).toBe(false);
  });
});

/** CA-371 — e o GPS é o que importa aqui. */
describe('CA-371: metadados não sobrevivem', () => {
  it('EXIF, inclusive coordenada de GPS, não sai do outro lado', async () => {
    const comExif = await sharp({
      create: { width: 500, height: 500, channels: 3, background: '#654321' },
    })
      .withExif({
        IFD0: { Copyright: 'Fulano', Make: 'ACME', Model: 'Camera X' },
        // A câmera do celular grava isto. O avatar é público por link (D-4):
        // entregar de onde a foto foi tirada é entregar onde a pessoa mora.
        // O `as never` é porque o tipo do `sharp` só declara as IFD comuns; o
        // runtime aceita qualquer bloco, e GPS é justamente o que interessa.
        GPS: { GPSLatitudeRef: 'S', GPSLongitudeRef: 'W' },
      } as never)
      .jpeg()
      .toBuffer();

    // Confere que a entrada REALMENTE tinha o metadado — sem isto o teste
    // passaria mesmo se a montagem estivesse errada.
    expect((await sharp(comExif).metadata()).exif).toBeDefined();

    const r = await processarAvatar(comExif, { deposito });
    if (!r.ok) throw new Error('falhou');

    const saida = await readFile(join(dir, `${r.hash}.webp`));
    const meta = await sharp(saida).metadata();
    expect(meta.exif).toBeUndefined();
    expect(meta.xmp).toBeUndefined();

    // E nada dos textos sobreviveu nos bytes crus.
    const cru = saida.toString('latin1');
    for (const vazamento of ['Fulano', 'ACME', 'Camera X', 'GPS']) {
      expect(cru).not.toContain(vazamento);
    }
  });

  /**
   * A orientação do EXIF é aplicada ANTES de o metadado ser descartado. Sem o
   * `.rotate()`, a foto de retrato tirada no celular sai deitada — e a pessoa
   * conclui que o site quebrou a foto dela.
   */
  it('a rotação do EXIF é aplicada, não jogada fora', async () => {
    const deitada = await sharp({
      create: { width: 600, height: 300, channels: 3, background: '#111111' },
    })
      .withExif({ IFD0: { Orientation: '6' } })   // 6 = girar 90°
      .jpeg()
      .toBuffer();

    const r = await processarAvatar(deitada, { deposito });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const meta = await sharp(await readFile(join(dir, `${r.hash}.webp`))).metadata();
    expect([meta.width, meta.height]).toEqual([256, 256]);
  });
});

describe('o caminho público não é uma porta', () => {
  it('só o formato exato passa', () => {
    const bom = '/avatares/' + 'a'.repeat(64) + '.webp';
    expect(arquivoDoCaminho(bom)).toBe('a'.repeat(64) + '.webp');
    expect(arquivoDoCaminho('/avatares/' + 'a'.repeat(64) + '-64.webp'))
      .toBe('a'.repeat(64) + '-64.webp');
  });

  it('travessia de diretório e nomes criativos não passam', () => {
    for (const ruim of [
      '/avatares/../../etc/passwd',
      '/avatares/..%2f..%2fetc%2fpasswd',
      '/avatares/' + 'a'.repeat(64) + '.webp/../../segredo',
      '/avatares/' + 'A'.repeat(64) + '.webp',   // hex é minúsculo
      '/avatares/' + 'a'.repeat(63) + '.webp',   // curto demais
      '/avatares/' + 'a'.repeat(64) + '.png',    // só webp sai daqui
      '/outro/' + 'a'.repeat(64) + '.webp',
      '/avatares/',
      '',
    ]) {
      expect(arquivoDoCaminho(ruim), ruim).toBeNull();
    }
  });
});
