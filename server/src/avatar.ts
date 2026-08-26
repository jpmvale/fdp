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
import sharp from 'sharp';
import { LIMITS } from '@fdp/protocol';
import type { DepositoDeAvatares } from '@fdp/avatares';

/**
 * Cabe uma foto de celular com folga; não cabe um vídeo disfarçado.
 *
 * Eram 5 MB, e "com folga" era falso: um JPEG de 12 MP sai entre 3 e 8 MB, e o
 * de 48 MP passa disso sozinho. O teto foi escolhido imaginando a foto, não
 * medindo uma.
 *
 * O número mora em `@fdp/protocol` porque o cliente também precisa dele — ele
 * recusa cedo para não gastar o 4G de alguém subindo o que vai voltar 413. Um
 * de cada lado, escritos à mão, é como o teto do servidor subiria e o do
 * cliente ficaria para trás.
 */
export const TAMANHO_MAX = LIMITS.avatarBytesMax;

/**
 * Teto de pixels na DECODIFICAÇÃO, que é diferente do teto de bytes.
 *
 * A bomba de descompressão é real: um PNG branco de 50 000 × 50 000 cabe em
 * poucos KB, porque o formato comprime uma imagem chapada a quase nada. O teto
 * de bytes não a pega, e este pega.
 *
 * **Mas ele estava em 4096² = 16,7 MP, e isso recusava toda foto de celular
 * moderno.** iPhone 14 Pro em diante tira 48 MP; Android de topo, 50, 108 ou
 * 200 MP. A pessoa tirava a foto, escolhia, e lia *"essa imagem tem pixels
 * demais"* — sobre a foto que a câmera dela produz por padrão. Só 12 MP
 * passava.
 *
 * O teto antigo vinha de uma suposição sobre o custo, não de uma medição. Medido
 * (macOS, libvips 8.18, redimensionando para 256):
 *
 * | entrada                    | tempo  | RSS   |
 * |---|---|---|
 * | JPEG 108 MP (foto de 4 MB) |  95 ms |  +9 MB |
 * | PNG chapado 64 MP (bomba)  |  71 ms | +41 MB |
 * | PNG chapado 256 MP (bomba) | 249 ms | +45 MB |
 *
 * Duas coisas que a suposição errou. O `libvips` processa em **tiles** e nunca
 * segura o bitmap inteiro — por isso a bomba de 256 MP custa 45 MB, e não os
 * gigabytes que a conta ingênua de largura × altura × 4 daria. E no JPEG existe
 * **shrink-on-load**: pedindo 256 px de saída, o decodificador lê em escala
 * reduzida e a foto de 108 MP sai mais barata que a bomba de 64 MP.
 *
 * Ou seja: o teto de pixels quase não separava o caro do barato — separava
 * fotos reais de fotos reais. 256 MP cobre qualquer câmera que exista com
 * folga larga, e o custo medido no pior caso continua sendo um quarto de
 * segundo e 45 MB.
 */
const PIXELS_MAX = 16_000 * 16_000;

/** O que a mesa mostra, e o dobro para tela densa. */
const LADO = 256;
const LADO_PEQUENO = 64;

export type FalhaDeAvatar =
  | 'GRANDE_DEMAIS'
  | 'NAO_E_IMAGEM'
  /** É imagem, e é uma que não sabemos abrir. Diferente de "não é imagem". */
  | 'HEIC_NAO_SUPORTADO'
  | 'IMAGEM_ABSURDA'
  | 'FALHA_AO_PROCESSAR'
  /**
   * A imagem estava boa; guardá-la é que não deu (RF-082).
   *
   * Separado de `FALHA_AO_PROCESSAR` porque as duas frases mandam a pessoa
   * para lugares opostos. "Não consegui abrir essa imagem" faz ela trocar de
   * foto — e trocar de foto não vai consertar um bucket fora do ar. O erro é
   * nosso, e a mensagem precisa dizer isso.
   */
  | 'DEPOSITO_INDISPONIVEL';

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
  /**
   * Onde os arquivos ficam.
   *
   * Era um caminho de diretório. Virou o depósito (plano 02) porque o destino
   * deixou de ser necessariamente um disco — e porque este módulo nunca teve o
   * que dizer sobre isso. O que ele faz é decidir o que uma foto VIRA; quem a
   * guarda é outro problema, e agora é outro objeto.
   */
  deposito: DepositoDeAvatares;
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

  let processada: { hash: string; grande: Buffer; pequena: Buffer };
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

    processada = { hash, grande, pequena };
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

  /**
   * Guardar é um `try` SEPARADO, e essa separação não é estilo.
   *
   * Enquanto a gravação ficava dentro do bloco acima, um bucket fora do ar
   * saía como `FALHA_AO_PROCESSAR` — *"não consegui abrir essa imagem, ela
   * pode estar corrompida"*. A pessoa olharia para a foto dela procurando um
   * defeito que não existe, trocaria de imagem, e a segunda falharia igual.
   *
   * O erro é NOSSO, e o motivo próprio é o que permite a mesa continuar com o
   * emoji no assento em vez de um buraco (RF-082, CA-393).
   */
  const { hash, grande, pequena } = processada;
  try {
    // Sem checar antes se já existe: o depósito é idempotente pelo nome, e o
    // nome é o hash do conteúdo — "já existe" só pode significar "com
    // exatamente estes bytes".
    await opcoes.deposito.guardar(`${hash}.webp`, grande);
    await opcoes.deposito.guardar(`${hash}-64.webp`, pequena);
  } catch {
    return { ok: false, motivo: 'DEPOSITO_INDISPONIVEL' };
  }

  return { ok: true, caminho: `/avatares/${hash}.webp`, hash, bytes: grande.length };
}

/** O nome do arquivo a partir do caminho público, ou `null` se não casar. */
export function arquivoDoCaminho(caminho: string): string | null {
  const m = /^\/avatares\/([0-9a-f]{64})(-64)?\.webp$/.exec(caminho);
  return m ? `${m[1]}${m[2] ?? ''}.webp` : null;
}
