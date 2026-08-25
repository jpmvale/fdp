/**
 * A paleta de avatares sob daltonismo (`07` §4). Cobre CA-344 e CA-345.
 *
 * Lê os valores do CSS que de fato é servido, não de uma cópia no teste: uma
 * constante duplicada aqui passaria a valer sozinha no dia em que alguém
 * mexesse no `estilos.css` — que é exatamente o arquivo onde se mexe.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { AVATAR_COLORS } from '@fdp/protocol';
import { contraste, deltaE, hexParaRgb, simular, type Visao } from './daltonismo.js';

const CSS = readFileSync(fileURLToPath(new URL('../src/estilos.css', import.meta.url)), 'utf8');

function token(nome: string): string {
  const achado = new RegExp(`--${nome}:\\s*(#[0-9a-fA-F]{6})`).exec(CSS);
  if (!achado) throw new Error(`token --${nome} não existe em estilos.css`);
  return achado[1]!.toLowerCase();
}

const PALETA = Object.fromEntries(AVATAR_COLORS.map((c) => [c, token(`avatar-${c}`)]));
const FELTROS = { claro: token('feltro-claro'), escuro: token('feltro-escuro') };
const VISOES: Visao[] = ['normal', 'deuteranopia', 'protanopia'];

/**
 * Piso de separação, em CIEDE2000.
 *
 * Hoje o mínimo real é 7,5 — `indigo`/`violet` sob protanopia —, e chegar acima
 * disso exigiria mover cinco das oito cores e desfigurar o `lime`. 7,0 deixa
 * folga para ruído de ponto flutuante e nada mais: qualquer regressão de
 * verdade cai bem abaixo. A paleta que este teste substituiu tinha 2,0.
 */
const PISO = 7.0;

/** Todo par, em todas as visões. É a resposta que interessa, não a média. */
function paresOrdenados(): { d: number; a: string; b: string; visao: Visao }[] {
  const out: { d: number; a: string; b: string; visao: Visao }[] = [];
  for (const visao of VISOES) {
    const vistas = Object.fromEntries(
      Object.entries(PALETA).map(([n, h]) => [n, simular(h, visao)]),
    );
    const nomes = Object.keys(vistas);
    for (let i = 0; i < nomes.length; i++) {
      for (let j = i + 1; j < nomes.length; j++) {
        const a = nomes[i]!;
        const b = nomes[j]!;
        out.push({ d: deltaE(vistas[a]!, vistas[b]!), a, b, visao });
      }
    }
  }
  return out.sort((x, y) => x.d - y.d);
}

describe('CA-344: a paleta distingue os 8 avatares sob deuteranopia e protanopia', () => {
  it('a paleta do CSS tem exatamente as 8 cores do protocolo', () => {
    expect(Object.keys(PALETA).sort()).toEqual([...AVATAR_COLORS].sort());
  });

  it('nenhum par de avatares colapsa em nenhuma das três visões', () => {
    const [pior] = paresOrdenados();
    expect(
      pior!.d,
      `${pior!.a} e ${pior!.b} ficam a ΔE2000 ${pior!.d.toFixed(1)} sob ${pior!.visao} — ` +
        `dois jogadores viram a mesma cor na mesa`,
    ).toBeGreaterThanOrEqual(PISO);
  });

  it('o caso que originou este teste continua separado: lime e orange sob deuteranopia', () => {
    // A paleta original dava ΔE2000 2,0 aqui, porque foi otimizada contra uma
    // simulação de deuteranopia com erro. Verde e vermelho convergem para
    // amarelo nesta visão — é a confusão mais clássica que existe, e a paleta
    // caiu exatamente nela.
    const lime = simular(PALETA.lime!, 'deuteranopia');
    const orange = simular(PALETA.orange!, 'deuteranopia');
    expect(deltaE(lime, orange)).toBeGreaterThanOrEqual(PISO);
  });

  it('a simulação está calibrada: preto, branco e cinza não mudam', () => {
    // Um eixo acromático é invariante sob qualquer projeção dicromática. Se
    // isto falhar, as matrizes estão erradas e todo o resto do arquivo mente.
    for (const cinza of ['#000000', '#808080', '#ffffff']) {
      for (const visao of VISOES) {
        expect(deltaE(hexParaRgb(cinza), simular(cinza, visao))).toBeLessThan(2);
      }
    }
  });

  it('a simulação de fato colapsa o que deve colapsar', () => {
    // Sanidade na direção oposta: vermelho puro e verde puro são o par que
    // define deuteranopia. Se a simulação NÃO os aproxima, ela não está
    // simulando nada e o teste inteiro passaria por acidente.
    const distanciaNormal = deltaE(hexParaRgb('#ff0000'), hexParaRgb('#00ff00'));
    const distanciaDeut = deltaE(simular('#ff0000', 'deuteranopia'), simular('#00ff00', 'deuteranopia'));
    expect(distanciaDeut).toBeLessThan(distanciaNormal / 2);
  });
});

describe('CA-345: contraste dos avatares contra o feltro (RNF-030)', () => {
  it('toda cor de avatar passa de 3:1 contra os dois feltros', () => {
    for (const [nome, hex] of Object.entries(PALETA)) {
      for (const [qual, feltro] of Object.entries(FELTROS)) {
        const razao = contraste(hexParaRgb(hex), hexParaRgb(feltro));
        expect(razao, `${nome} (${hex}) contra feltro ${qual}: ${razao.toFixed(2)}:1`)
          .toBeGreaterThanOrEqual(3);
      }
    }
  });
});
