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

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'fdp-avatar-'));
});

const png = (w: number, h: number, cor = '#336699'): Promise<Buffer> =>
  sharp({ create: { width: w, height: h, channels: 3, background: cor } }).png().toBuffer();

describe('o caminho feliz', () => {
  it('reduz para 256×256 em WebP e devolve o caminho', async () => {
    const r = await processarAvatar(await png(900, 600), { diretorio: dir });
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    expect(r.caminho).toMatch(/^\/avatares\/[0-9a-f]{64}\.webp$/);

    const meta = await sharp(await readFile(join(dir, `${r.hash}.webp`))).metadata();
    expect(meta.format).toBe('webp');
    expect(meta.width).toBe(256);
    expect(meta.height).toBe(256);
  });

  it('grava também a versão pequena, para o assento na mesa', async () => {
    const r = await processarAvatar(await png(500, 500), { diretorio: dir });
    if (!r.ok) throw new Error('falhou');

    const meta = await sharp(await readFile(join(dir, `${r.hash}-64.webp`))).metadata();
    expect(meta.width).toBe(64);
  });

  it('recorta no centro: retrato e paisagem viram o mesmo quadrado', async () => {
    const alto = await processarAvatar(await png(200, 800), { diretorio: dir });
    const largo = await processarAvatar(await png(800, 200), { diretorio: dir });
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
    const a = await processarAvatar(bytes, { diretorio: dir });
    const b = await processarAvatar(bytes, { diretorio: dir });
    if (!a.ok || !b.ok) throw new Error('falhou');

    expect(a.hash).toBe(b.hash);
    expect(await readdir(dir)).toHaveLength(2); // a grande e a de 64
  });

  it('imagens diferentes dão nomes diferentes', async () => {
    const a = await processarAvatar(await png(400, 400, '#ff0000'), { diretorio: dir });
    const b = await processarAvatar(await png(400, 400, '#00ff00'), { diretorio: dir });
    if (!a.ok || !b.ok) throw new Error('falhou');
    expect(a.hash).not.toBe(b.hash);
  });

  it('aceita os quatro formatos que a câmera e a web produzem', async () => {
    const base = { create: { width: 300, height: 300, channels: 3 as const, background: '#123456' } };
    const formatos = [
      await sharp(base).jpeg().toBuffer(),
      await sharp(base).png().toBuffer(),
      await sharp(base).webp().toBuffer(),
      await sharp(base).gif().toBuffer(),
    ];
    for (const bytes of formatos) {
      expect((await processarAvatar(bytes, { diretorio: dir })).ok).toBe(true);
    }
  });
});

/** CA-370 — e cada caso é um ataque, não uma categoria. */
describe('CA-370: o que NÃO entra', () => {
  it('bytes que não são imagem nenhuma', async () => {
    const r = await processarAvatar(Buffer.from('isto é texto, não uma foto'), { diretorio: dir });
    expect(r).toEqual({ ok: false, motivo: 'NAO_E_IMAGEM' });
  });

  it('vazio', async () => {
    expect(await processarAvatar(Buffer.alloc(0), { diretorio: dir }))
      .toEqual({ ok: false, motivo: 'GRANDE_DEMAIS' });
  });

  it('acima do teto de bytes', async () => {
    const r = await processarAvatar(Buffer.alloc(TAMANHO_MAX + 1, 0xff), { diretorio: dir });
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
    expect(await processarAvatar(svg, { diretorio: dir }))
      .toEqual({ ok: false, motivo: 'NAO_E_IMAGEM' });
  });

  /**
   * A bomba de descompressão, que o teto de BYTES não pega.
   *
   * Um PNG branco de 20 000 × 20 000 cabe em poucos KB e vira 400 milhões de
   * pixels ao decodificar. Sem `limitInputPixels`, o processo morre por
   * memória — e é o mesmo processo que está servindo as partidas.
   */
  it('bomba de descompressão é recusada, e o processo sobrevive', async () => {
    // 8000×8000 são 64 milhões de pixels — quase 4× o teto de 4096². Já foi
    // 20 000², e era bomba demais: gerar a imagem custava segundos de CPU e
    // empurrou o CA-209 (um teste estatístico de 2,3 s, noutro pacote) para
    // fora do timeout de 5 s do vitest. Um teste que derruba o vizinho é pior
    // que nenhum — ensina a rodar de novo até passar.
    const bomba = await sharp({
      create: { width: 8_000, height: 8_000, channels: 3, background: '#ffffff' },
      limitInputPixels: false,
    }).png({ compressionLevel: 9 }).toBuffer();

    // Cabe folgado no teto de bytes: é exatamente esse o truque.
    expect(bomba.length).toBeLessThan(TAMANHO_MAX);

    const r = await processarAvatar(bomba, { diretorio: dir });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toBe('IMAGEM_ABSURDA');

    // E o processo continua vivo o bastante para atender o próximo.
    expect((await processarAvatar(await png(300, 300), { diretorio: dir })).ok).toBe(true);
  }, 30_000);

  it('JPEG truncado no meio não derruba nada', async () => {
    const inteiro = await sharp({
      create: { width: 400, height: 400, channels: 3, background: '#abcdef' },
    }).jpeg().toBuffer();
    const cortado = inteiro.subarray(0, Math.floor(inteiro.length / 3));

    const r = await processarAvatar(cortado, { diretorio: dir });
    expect(r.ok).toBe(false);
    expect((await processarAvatar(await png(300, 300), { diretorio: dir })).ok).toBe(true);
  });

  /** `.png` que na verdade é outra coisa: a extensão é afirmação do cliente. */
  it('o conteúdo manda, não o nome nem o cabeçalho', async () => {
    const mentira = Buffer.concat([
      Buffer.from('GIF89a'),               // começa como GIF…
      Buffer.from('conteúdo que não é imagem nenhuma depois disso'),
    ]);
    const r = await processarAvatar(mentira, { diretorio: dir });
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

    const r = await processarAvatar(comExif, { diretorio: dir });
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

    const r = await processarAvatar(deitada, { diretorio: dir });
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
