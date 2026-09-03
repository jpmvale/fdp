/**
 * O piso de contraste do RNF-030, cobrado token a token. Base de CA-140.
 *
 * Existe porque o `axe-core` achou, na primeira execução dele, que
 * `--texto-apagado` estava a 4,05:1 sobre `--superficie` — abaixo do piso de
 * 4,5 — e que o token é usado por `.rotulo` em quase toda tela. Cinco telas
 * reprovando pelo mesmo motivo, num valor que está no CSS desde o começo.
 *
 * O `axe` continua sendo a rede: ele olha a árvore renderizada e pega o que
 * nasce da combinação real de elementos. Este teste é o portão que fecha antes,
 * em milissegundos e sem navegador — e que diz QUAL par de tokens furou o piso,
 * em vez de qual seletor CSS apareceu na tela.
 *
 * Lê o CSS servido, e não uma cópia: uma constante duplicada aqui passaria a
 * valer sozinha no dia em que alguém mexesse no `estilos.css` — que é
 * exatamente o arquivo onde se mexe.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { contraste, hexParaRgb } from './daltonismo.js';

const CSS = readFileSync(fileURLToPath(new URL('../src/estilos.css', import.meta.url)), 'utf8');

function token(nome: string): string {
  const achado = new RegExp(`--${nome}:\\s*(#[0-9a-fA-F]{6})`).exec(CSS);
  if (!achado) throw new Error(`token --${nome} não existe em estilos.css`);
  return achado[1]!.toLowerCase();
}

/** RNF-030: 4,5:1 para texto, 3:1 para elemento gráfico e borda de foco. */
const PISO_TEXTO = 4.5;
const PISO_GRAFICO = 3;

/**
 * As quatro superfícies em que texto pode cair.
 *
 * Um token de texto precisa passar na PIOR delas, e não na média: o mesmo
 * `.rotulo` aparece sobre o fundo da página e dentro de um cartão, e quem lê
 * não escolhe onde.
 */
const FUNDOS = {
  fundo: token('fundo'),
  superficie: token('superficie'),
  'superficie-2': token('superficie-2'),
  poco: token('poco'),
};

const TEXTOS = ['texto', 'texto-medio', 'texto-fraco', 'texto-apagado'];

const razao = (a: string, b: string): number => contraste(hexParaRgb(a), hexParaRgb(b));

describe('RNF-030: contraste de texto', () => {
  it('todo token de texto passa 4,5:1 em TODA superfície', () => {
    const furos: string[] = [];
    for (const nome of TEXTOS) {
      for (const [fundo, cor] of Object.entries(FUNDOS)) {
        const r = razao(token(nome), cor);
        if (r < PISO_TEXTO) furos.push(`--${nome} sobre --${fundo}: ${r.toFixed(2)}:1`);
      }
    }
    expect(furos).toEqual([]);
  });

  it('a hierarquia dos quatro níveis se mantém', () => {
    // Passar no piso subindo todos ao mesmo tom resolveria o contraste e
    // destruiria a leitura: os quatro níveis existem para dizer o que é título,
    // o que é conteúdo e o que é nota de rodapé.
    const sobreCartao = TEXTOS.map((n) => razao(token(n), FUNDOS.superficie));
    for (let i = 1; i < sobreCartao.length; i++) {
      expect(sobreCartao[i - 1]!, `${TEXTOS[i - 1]!} vs ${TEXTOS[i]!}`)
        .toBeGreaterThan(sobreCartao[i]!);
    }
  });

  it('o texto sobre o acento — botão primário — passa como texto', () => {
    // O botão principal do produto. Contraste invertido: texto escuro sobre
    // roxo, e é o par mais fácil de quebrar mexendo no acento.
    expect(razao('#12101d', token('acento'))).toBeGreaterThanOrEqual(PISO_TEXTO);
  });

  it('as cores de nota passam como texto, onde elas são texto', () => {
    // A nota aparece como número colorido no perfil e no fim de partida —
    // é texto, e cor não pode ser o único canal (RNF-031) nem ilegível.
    for (const nota of ['nota-baixa', 'nota-media', 'nota-alta', 'nota-otima']) {
      expect(razao(token(nota), FUNDOS.superficie), nota).toBeGreaterThanOrEqual(PISO_TEXTO);
    }
  });

  it('as bordas e marcadores passam o piso GRÁFICO', () => {
    // 3:1 e não 4,5: são elementos gráficos, não texto (RNF-030). `--linha` é
    // divisória e fica de fora de propósito — divisória não carrega informação,
    // e exigir 3:1 dela deixaria a tela riscada.
    for (const grafico of ['vidas', 'acento']) {
      expect(razao(token(grafico), FUNDOS.superficie), grafico)
        .toBeGreaterThanOrEqual(PISO_GRAFICO);
    }
  });
});
