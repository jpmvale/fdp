/**
 * Os arquivos da marca, gerados a partir de UM original.
 *
 * `app/marca/logo.jpeg` é o mestre e fica no repositório de propósito. O que é
 * servido — o ícone da aba, o do atalho, a figura do cartão de link — é
 * derivado dele por este script. Guardar só os derivados é o desenho em que,
 * um ano depois, ninguém sabe de onde saiu o `og.png` nem como refazê-lo num
 * tamanho diferente.
 *
 *   node scripts/gerar-marca.mjs
 *
 * Não roda no build nem no CI: a marca muda uma vez por ano, e gerar imagem a
 * cada `npm ci` seria pagar `sharp` em todo lugar por algo que não muda.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import sharp from 'sharp';

const ORIGEM = 'app/marca/logo.jpeg';
const DESTINO = 'app/public';

/** O mesmo `--fundo` de `estilos.css`. A marca não pode flutuar da paleta. */
const FUNDO = { r: 0x08, g: 0x0b, b: 0x14, alpha: 1 };

/**
 * A logo é um disco sobre um fundo quadriculado escuro.
 *
 * O quadriculado é cenário do arquivo, não da marca: deixá-lo aparecer punha um
 * bloco quadrado de textura no meio de um cartão de fundo liso, com uma emenda
 * visível onde um encontra o outro. A máscara circular recorta só o disco, e o
 * que sobra é o fundo do produto.
 */
async function disco(lado) {
  /**
   * 446 é MEDIDO, não estimado.
   *
   * O primeiro chute foi 502 — "o anel encosta na borda" — e o resultado tinha
   * o quadriculado do arquivo aparecendo como um halo escuro em volta do disco,
   * sobre um cartão de fundo liso. O anel dourado começa em x=66 na linha do
   * centro dos 1024 originais, então o raio é 512−66.
   *
   * Conferir de olho é justamente o que não funciona aqui: o quadriculado é
   * quase preto, o fundo do produto é quase preto, e a diferença só aparece
   * depois de o cartão já estar num grupo de conversa.
   */
  const raio = 446;
  const mascara = Buffer.from(
    `<svg width="1024" height="1024"><circle cx="512" cy="512" r="${String(raio)}" fill="#fff"/></svg>`,
  );

  // Duas passagens, e não uma.
  //
  // O `sharp` aplica as operações na ORDEM DELE, não na ordem das chamadas: o
  // `resize` acontece antes do `composite`, sempre. Numa passagem só, a máscara
  // de 1024 px chegaria depois de a imagem já ter virado 180, e ele recusa
  // compor algo maior que a base. O erro fala de dimensões e não diz nada sobre
  // ordem, que é o que torna isto difícil de adivinhar.
  const mascarado = await sharp(ORIGEM)
    .composite([{ input: mascara, blend: 'dest-in' }])
    .png()
    .toBuffer();

  return sharp(mascarado)
    .resize(lado, lado, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
}

mkdirSync(DESTINO, { recursive: true });

// --- ícones -----------------------------------------------------------------
//
// Sobre fundo CHAPADO, e não transparentes. O iOS põe preto atrás de um ícone
// com alfa, e o Android recorta em formas que variam por fabricante: nos dois
// casos um disco transparente vira um disco com moldura errada.
for (const [nome, lado] of [['icone.png', 512], ['apple-touch-icon.png', 180]]) {
  const png = await sharp({
    create: { width: lado, height: lado, channels: 4, background: FUNDO },
  })
    .composite([{ input: await disco(lado), top: 0, left: 0 }])
    // Paleta, e não cor real. A logo tem brilhos e faíscas, então em PNG sem
    // perdas o ícone de 512 saía com 520 KB — meio megabyte para um quadrado
    // que ninguém vê maior que o polegar. Quantizado fica na casa das dezenas
    // de KB e a diferença não é visível no tamanho em que ele é usado.
    .png({ palette: true, quality: 90, effort: 10 })
    .toBuffer();
  writeFileSync(`${DESTINO}/${nome}`, png);
  console.log(`${nome}: ${String(lado)}×${String(lado)}, ${String(Math.round(png.length / 1024))} KB`);
}

// --- a figura do cartão de link ---------------------------------------------
//
// 1200×630 é a proporção que WhatsApp, Telegram, Discord e Twitter esperam.
// Mandar a logo quadrada faria cada um recortar do seu jeito, e a logo é
// redonda: o corte comeria as bordas de cima e de baixo do anel dourado — a
// única parte da marca que sobrevive em tamanho pequeno.
const LARGURA = 1200;
const ALTURA = 630;
// 500 px deixa ~65 px de folga em cima e embaixo. Sem folga o disco encosta na
// borda e, no cartão pequeno de algumas conversas, parece cortado mesmo sem
// estar.
const DIAMETRO = 500;

const cartao = await sharp({
  create: { width: LARGURA, height: ALTURA, channels: 4, background: FUNDO },
})
  .composite([{
    input: await disco(DIAMETRO),
    top: Math.round((ALTURA - DIAMETRO) / 2),
    left: Math.round((LARGURA - DIAMETRO) / 2),
  }])
  /**
   * JPEG, e não PNG.
   *
   * A logo é uma ilustração com gradiente, brilho e faísca — fotográfica no
   * que importa para a compressão. Em PNG o cartão saía com 530 KB, e cartão de
   * link pesado é cartão que não aparece: vários aplicativos de conversa
   * desistem da pré-visualização acima de algumas centenas de KB, em silêncio,
   * e o convite volta a chegar como uma URL crua.
   *
   * Não há transparência a preservar — o fundo é chapado por construção —,
   * então o único motivo para PNG aqui seria hábito.
   */
  .jpeg({ quality: 82, mozjpeg: true })
  .toBuffer();

writeFileSync(`${DESTINO}/og.jpg`, cartao);
console.log(`og.jpg: ${String(LARGURA)}×${String(ALTURA)}, ${String(Math.round(cartao.length / 1024))} KB`);
