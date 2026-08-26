/**
 * Imagem enviada virando avatar (plano 01 §10, F5).
 *
 * Isto é a superfície mais hostil do produto: bytes arbitrários, de qualquer
 * um com conta, decodificados pelo servidor. Cada regra aqui existe por um
 * ataque concreto, e nenhuma é cerimônia.
 *
 * O processamento é **do servidor** (D-9). Redimensionar no cliente seria mais
 * barato e serviria para nada: o cliente é quem ataca, e "a imagem já veio
 * pequena" é afirmação dele.
 */

import { createHash } from 'node:crypto';
import { mkdir, writeFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';

/** Cabe uma foto de celular com folga; não cabe um vídeo disfarçado. */
export const TAMANHO_MAX = 5 * 1024 * 1024;

/**
 * Teto de pixels na DECODIFICAÇÃO, que é diferente do teto de bytes.
 *
 * Um PNG de 50 000 × 50 000 cabe em poucos KB — é uma imagem em branco, e o
 * formato comprime isso a quase nada. Ao decodificar viram 2,5 bilhões de
 * pixels e o processo morre por memória. É a bomba de descompressão, e o teto
 * de 5 MB não a pega: só este pega.
 */
const PIXELS_MAX = 4096 * 4096;

/** O que a mesa mostra, e o dobro para tela densa. */
const LADO = 256;
const LADO_PEQUENO = 64;

export type FalhaDeAvatar =
  | 'GRANDE_DEMAIS'
  | 'NAO_E_IMAGEM'
  /** É imagem, e é uma que não sabemos abrir. Diferente de "não é imagem". */
  | 'HEIC_NAO_SUPORTADO'
  | 'IMAGEM_ABSURDA'
  | 'FALHA_AO_PROCESSAR';

export type ResultadoDeAvatar =
  | { ok: true; caminho: string; hash: string; bytes: number }
  | { ok: false; motivo: FalhaDeAvatar };

/**
 * Formatos aceitos, detectados pelos BYTES.
 *
 * Nunca pelo `Content-Type` nem pela extensão: os dois são afirmações do
 * cliente, e um `.png` que na verdade é um SVG com `<script>` dentro seria
 * servido do nosso domínio — XSS de primeira parte, com sessão junto.
 *
 * SVG fica de fora por isso mesmo. Ele é um documento executável, não uma
 * imagem, e `sharp` o renderiza com uma biblioteca que já teve furo.
 */
/**
 * Marcas de `ftyp` que este servidor SABE decodificar.
 *
 * Só AVIF, e a ausência do HEIC aqui é a parte importante. O `sharp` que a
 * gente usa traz libheif, e libheif sem decodificador de HEVC: AVIF (que é
 * AV1) abre, HEIC (que é HEVC) não — é `Decoder plugin generated an error`,
 * medido com um arquivo de verdade, não deduzido da documentação. HEVC é
 * patenteado, e por isso o binário pronto não o inclui.
 *
 * A lista é fechada também contra vídeo: a mesma caixa `ftyp` embrulha MP4 e
 * MOV, e aceitar a caixa em vez das marcas seria abrir o decodificador para
 * eles.
 */
const MARCAS_AVIF = new Set(['avif', 'avis']);

/**
 * Marcas de HEIC. **Reconhecidas para poder recusar direito**, não para aceitar.
 *
 * Esta é a foto que o iPhone tira desde 2017, então é o arquivo que a pessoa
 * escolhe sem saber que escolheu nada. Ela precisa ler o que fazer — *"mande
 * como JPEG"* — e não *"esse arquivo não é uma imagem"*, que é falso e não diz
 * o que ela deve fazer em seguida.
 *
 * Para de fato ACEITAR HEIC é preciso um libvips com decodificador de HEVC,
 * que é decisão de licença e de imagem de container, não de código.
 */
const MARCAS_HEIC = new Set(['heic', 'heix', 'heim', 'heis', 'hevc', 'hevx', 'mif1', 'msf1']);

function formatoPelosBytes(b: Buffer): 'jpeg' | 'png' | 'webp' | 'gif' | 'avif' | 'heic' | null {
  if (b.length < 12) return null;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg';
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'png';
  if (b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  if (b.toString('ascii', 0, 3) === 'GIF') return 'gif';
  // ISO-BMFF: os 4 bytes de tamanho, `ftyp`, e então a marca.
  if (b.toString('ascii', 4, 8) === 'ftyp') {
    const marca = b.toString('ascii', 8, 12);
    if (MARCAS_AVIF.has(marca)) return 'avif';
    if (MARCAS_HEIC.has(marca)) return 'heic';
  }
  return null;
}

export interface OpcoesDeAvatar {
  /** Onde os arquivos ficam. Volume próprio em produção. */
  diretorio: string;
}

/**
 * Recebe bytes, devolve o caminho público do avatar.
 *
 * O nome do arquivo é o **sha256 do resultado**, não do envio: duas pessoas
 * mandando a mesma foto compartilham um arquivo só, reenviar é idempotente, e
 * o cache pode ser imutável porque conteúdo diferente nunca reusa um nome.
 */
export async function processarAvatar(
  bytes: Buffer,
  opcoes: OpcoesDeAvatar,
): Promise<ResultadoDeAvatar> {
  if (bytes.length === 0 || bytes.length > TAMANHO_MAX) {
    return { ok: false, motivo: 'GRANDE_DEMAIS' };
  }
  const formato = formatoPelosBytes(bytes);
  if (formato === 'heic') return { ok: false, motivo: 'HEIC_NAO_SUPORTADO' };
  if (formato === null) return { ok: false, motivo: 'NAO_E_IMAGEM' };

  try {
    const entrada = sharp(bytes, {
      limitInputPixels: PIXELS_MAX,
      // Só o primeiro quadro: um GIF animado de mil quadros seria mil
      // decodificações para produzir uma miniatura.
      animated: false,
    });

    const meta = await entrada.metadata();
    if (!meta.width || !meta.height) return { ok: false, motivo: 'NAO_E_IMAGEM' };

    const grande = await entrada
      .rotate()          // aplica a orientação do EXIF ANTES de descartá-lo
      .resize(LADO, LADO, { fit: 'cover', position: 'centre' })
      // `webp()` reescreve a imagem inteira a partir dos pixels decodificados:
      // não sobra EXIF, nem XMP, nem o GPS que a câmera do celular grava. Foto
      // de rua carrega a coordenada de onde foi tirada, e o avatar é público
      // por link (D-4).
      .webp({ quality: 82, effort: 4 })
      .toBuffer();

    const hash = createHash('sha256').update(grande).digest('hex');

    const pequena = await sharp(grande)
      .resize(LADO_PEQUENO, LADO_PEQUENO, { fit: 'cover' })
      .webp({ quality: 80 })
      .toBuffer();

    await mkdir(opcoes.diretorio, { recursive: true });
    const caminhoGrande = join(opcoes.diretorio, `${hash}.webp`);
    const caminhoPequeno = join(opcoes.diretorio, `${hash}-64.webp`);

    // Conteúdo idêntico já gravado: nada a fazer. Reescrever seria trocar o
    // arquivo por um byte-a-byte igual, com uma janela em que ele não existe.
    const existe = await access(caminhoGrande).then(() => true, () => false);
    if (!existe) {
      await writeFile(caminhoGrande, grande);
      await writeFile(caminhoPequeno, pequena);
    }

    return { ok: true, caminho: `/avatares/${hash}.webp`, hash, bytes: grande.length };
  } catch (erro) {
    // `sharp` estoura em imagem corrompida e ao passar do teto de pixels. Os
    // dois são entrada hostil, não defeito nosso, e nenhum pode derrubar o
    // processo que está servindo partidas.
    // A mensagem exata do `sharp` ao estourar o teto é "Input image exceeds
    // pixel limit". Distinguir importa: uma diz "sua imagem é grande demais",
    // a outra diz "seu arquivo está quebrado", e mandar a segunda para quem
    // enviou um panorama de celular manda a pessoa procurar o problema errado.
    const texto = String(erro).toLowerCase();
    if (texto.includes('pixel limit') || texto.includes('limitinputpixels')) {
      return { ok: false, motivo: 'IMAGEM_ABSURDA' };
    }
    return { ok: false, motivo: 'FALHA_AO_PROCESSAR' };
  }
}

/** O nome do arquivo a partir do caminho público, ou `null` se não casar. */
export function arquivoDoCaminho(caminho: string): string | null {
  const m = /^\/avatares\/([0-9a-f]{64})(-64)?\.webp$/.exec(caminho);
  return m ? `${m[1]}${m[2] ?? ''}.webp` : null;
}
