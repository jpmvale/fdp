/**
 * O cache na frente do depósito (RNF-018).
 *
 * Duas coisas para provar. Que ele de fato evita a ida ao depósito — medido,
 * não suposto, que é o gate de F2. E que o teto é respeitado em BYTES, porque
 * um cache sem teto é um vazamento de memória com outro nome.
 *
 * O contrato inteiro roda por cima dele também: um cache que muda o
 * comportamento do depósito não é um cache, é um bug.
 */

import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { comCache, criarDepositoEmDisco, type DepositoDeAvatares } from '../src/index.js';
import { descreverContratoDeDeposito, nomeDe } from './contrato.js';

const emDisco = async (): Promise<DepositoDeAvatares> =>
  criarDepositoEmDisco(await mkdtemp(join(tmpdir(), 'fdp-cache-')));

descreverContratoDeDeposito({
  nome: 'disco + cache',
  async criar() { return comCache(await emDisco()); },
});

/** Conta quantas vezes o depósito de baixo foi de fato tocado. */
function espiao(base: DepositoDeAvatares): { deposito: DepositoDeAvatares; leituras: () => number } {
  let leituras = 0;
  return {
    deposito: {
      guardar: (n, b) => base.guardar(n, b),
      ler: (n) => { leituras++; return base.ler(n); },
      apagar: (n) => base.apagar(n),
    },
    leituras: () => leituras,
  };
}

describe('CA-405 / RNF-018: o cache evita a ida ao depósito', () => {
  it('o segundo pedido do mesmo avatar não toca o depósito', async () => {
    const { deposito, leituras } = espiao(await emDisco());
    const d = comCache(deposito);
    const bytes = Buffer.alloc(8 * 1024, 7);
    const nome = nomeDe(bytes);
    await d.guardar(nome, bytes);

    // Gravar já deixa no cache: quem acabou de trocar a foto é a primeira
    // pessoa a pedi-la, e mandá-la ao depósito seria ir buscar o que se acabou
    // de mandar para lá.
    for (let i = 0; i < 10; i++) expect(await d.ler(nome)).toBeDefined();

    expect(leituras()).toBe(0);
    expect(d.estatisticas().acertos).toBe(10);
  });

  it('ausência não é cacheada: a foto recém-enviada aparece na hora', async () => {
    const { deposito, leituras } = espiao(await emDisco());
    const d = comCache(deposito);
    const bytes = Buffer.alloc(256, 3);
    const nome = nomeDe(bytes);

    expect(await d.ler(nome)).toBeUndefined();
    expect(leituras()).toBe(1);

    // Alguém envia a foto agora. Se o `undefined` tivesse sido guardado, este
    // pedido continuaria 404 — e o dono da conta veria o avatar antigo até o
    // processo reiniciar.
    await deposito.guardar(nome, bytes);
    expect(await d.ler(nome)).toBeDefined();
  });
});

describe('CA-405 / RNF-018: o teto é em bytes', () => {
  it('passando do teto, o mais antigo sai', async () => {
    const d = comCache(await emDisco(), 10 * 1024);
    const nomes: string[] = [];

    for (let i = 0; i < 6; i++) {
      const bytes = Buffer.alloc(3 * 1024, i);
      const nome = nomeDe(bytes);
      nomes.push(nome);
      await d.guardar(nome, bytes);
    }

    // 6 × 3 KB = 18 KB num teto de 10 KB: cabem 3.
    const e = d.estatisticas();
    expect(e.bytes).toBeLessThanOrEqual(10 * 1024);
    expect(e.itens).toBe(3);

    // E o conteúdo continua correto: quem saiu do cache volta do depósito.
    for (const [i, nome] of nomes.entries()) {
      expect(Buffer.compare((await d.ler(nome))!, Buffer.alloc(3 * 1024, i))).toBe(0);
    }
  });

  it('reler promove: o que é pedido sempre não é o que sai', async () => {
    const d = comCache(await emDisco(), 10 * 1024);
    const fazer = (i: number): Buffer => Buffer.alloc(3 * 1024, i);

    const a = nomeDe(fazer(1)), b = nomeDe(fazer(2)), c = nomeDe(fazer(3));
    await d.guardar(a, fazer(1));
    await d.guardar(b, fazer(2));
    await d.guardar(c, fazer(3));

    // `a` é o mais antigo — mas relê-lo o manda para o fim da fila.
    await d.ler(a);
    const antes = d.estatisticas().acertos;
    expect(antes).toBe(1);

    // Entra um quarto: agora quem sai é `b`, e não `a`.
    await d.guardar(nomeDe(fazer(4)), fazer(4));
    await d.ler(a);
    expect(d.estatisticas().acertos).toBe(2); // `a` continuava lá
  });

  it('item maior que o teto inteiro não entra, e não esvazia o cache', async () => {
    const d = comCache(await emDisco(), 4 * 1024);
    const pequeno = Buffer.alloc(1024, 1);
    await d.guardar(nomeDe(pequeno), pequeno);

    // Sem a guarda, o laço de despejo esvaziaria tudo para caber neste — e
    // então o despejaria também, deixando o cache vazio a cada pedido dele.
    const gigante = Buffer.alloc(8 * 1024, 2);
    await d.guardar(nomeDe(gigante), gigante);

    const e = d.estatisticas();
    expect(e.itens).toBe(1);
    expect(e.bytes).toBe(1024);
    // E o gigante continua legível — ele está no depósito, só não no cache.
    expect(await d.ler(nomeDe(gigante))).toBeDefined();
  });
});
