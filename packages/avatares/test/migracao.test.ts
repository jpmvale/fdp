/**
 * A migração, e a conferência que é o motivo dela existir (CA-394).
 *
 * Copiar bytes de um lado para o outro seria um laço de três linhas. O que
 * justifica um módulo é que o nome de cada objeto é o sha256 do conteúdo — e
 * isso torna possível saber, arquivo por arquivo, se o que está guardado é o
 * que deveria estar. É a primeira vez que os avatares em produção vão ser
 * verificados.
 */

import { createHash } from 'node:crypto';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  comCache, criarDepositoEmDisco, escreverNosDois, migrar, type DepositoDeAvatares,
} from '../src/index.js';

const novo = async (): Promise<DepositoDeAvatares> =>
  criarDepositoEmDisco(await mkdtemp(join(tmpdir(), 'fdp-mig-')));

const hashDe = (b: Buffer): string => createHash('sha256').update(b).digest('hex');
const nomeDe = (b: Buffer): string => `${hashDe(b)}.webp`;

describe('CA-394: a migração confere antes de copiar', () => {
  it('copia o que está íntegro, e diz o que já estava lá', async () => {
    const origem = await novo();
    const destino = await novo();

    const a = Buffer.from('foto a');
    const b = Buffer.from('foto b');
    await origem.guardar(nomeDe(a), a);
    await origem.guardar(nomeDe(b), b);
    // `b` já foi copiado numa tentativa anterior: migração precisa poder ser
    // rodada de novo sem medo, porque a primeira vez sempre para no meio.
    await destino.guardar(nomeDe(b), b);

    const r = await migrar({ origem, destino, nomes: [nomeDe(a), nomeDe(b)] });

    expect(r.copiados).toEqual([nomeDe(a)]);
    expect(r.jaExistiam).toEqual([nomeDe(b)]);
    expect(r.corrompidos).toEqual([]);
    expect(Buffer.compare((await destino.ler(nomeDe(a)))!, a)).toBe(0);
  });

  it('arquivo cujo conteúdo não bate com o nome é DENUNCIADO, e não copiado', async () => {
    const origem = await novo();
    const destino = await novo();

    // Um nome legítimo com o conteúdo de outra coisa. É o que um disco com
    // setor ruim, ou uma escrita interrompida antiga, deixaria para trás.
    const verdadeiro = Buffer.from('a foto certa');
    const nome = nomeDe(verdadeiro);
    await origem.guardar(nome, Buffer.from('conteúdo trocado'));

    const r = await migrar({ origem, destino, nomes: [nome] });

    expect(r.corrompidos).toEqual([nome]);
    expect(r.copiados).toEqual([]);
    // O ponto: a corrupção NÃO atravessou. Copiar apagaria a única evidência
    // de que ela existiu.
    expect(await destino.ler(nome)).toBeUndefined();
  });

  it('a variante pequena não é conferida pelo hash, e isso é de propósito', async () => {
    const origem = await novo();
    const destino = await novo();

    // O `-64` carrega o hash da GRANDE, e a imagem é outra — conferi-lo pelo
    // próprio conteúdo acusaria todas de corrompidas.
    const grande = Buffer.from('a grande');
    const pequena = Buffer.from('a pequena, outra imagem');
    const base = hashDe(grande);
    await origem.guardar(`${base}.webp`, grande);
    await origem.guardar(`${base}-64.webp`, pequena);

    const r = await migrar({ origem, destino, nomes: [`${base}.webp`, `${base}-64.webp`] });

    expect(r.corrompidos).toEqual([]);
    expect(r.copiados).toHaveLength(2);
  });

  it('nome inválido não vira leitura', async () => {
    const origem = await novo();
    const destino = await novo();
    const r = await migrar({ origem, destino, nomes: ['../../etc/passwd', 'nada.png'] });

    expect(r.invalidos).toHaveLength(2);
    expect(r.copiados).toEqual([]);
  });
});

describe('§6: escrita dupla durante a janela de corte', () => {
  it('grava nos dois, e lê do principal', async () => {
    const principal = await novo();
    const secundario = await novo();
    const d = escreverNosDois(principal, secundario, () => {});

    const bytes = Buffer.from('foto');
    await d.guardar(nomeDe(bytes), bytes);

    expect(await principal.ler(nomeDe(bytes))).toBeDefined();
    expect(await secundario.ler(nomeDe(bytes))).toBeDefined();
  });

  it('falha no SECUNDÁRIO não derruba o envio — ela é registrada', async () => {
    const principal = await novo();
    const falhas: string[] = [];
    const secundario: DepositoDeAvatares = {
      guardar: () => Promise.reject(new Error('bucket novo fora do ar')),
      ler: () => Promise.resolve(undefined),
      apagar: () => Promise.resolve(),
    };
    const d = escreverNosDois(principal, secundario, (op, nome) => falhas.push(`${op}:${nome}`));

    const bytes = Buffer.from('foto');
    // O destino é para onde estamos indo; ele ainda não manda em nada. Quem
    // está trocando de foto agora não pode pagar por uma migração em curso.
    await expect(d.guardar(nomeDe(bytes), bytes)).resolves.toBeUndefined();
    expect(await principal.ler(nomeDe(bytes))).toBeDefined();
    expect(falhas).toEqual([`guardar:${nomeDe(bytes)}`]);
  });

  it('falha no PRINCIPAL derruba o envio, porque é ele que manda', async () => {
    const principal: DepositoDeAvatares = {
      guardar: () => Promise.reject(new Error('disco cheio')),
      ler: () => Promise.resolve(undefined),
      apagar: () => Promise.resolve(),
    };
    const d = escreverNosDois(principal, await novo(), () => {});
    await expect(d.guardar(nomeDe(Buffer.from('x')), Buffer.from('x'))).rejects.toThrow();
  });

  it('apagar vai nos dois: senão o corte ressuscita o que alguém tirou', async () => {
    const principal = await novo();
    const secundario = await novo();
    const d = escreverNosDois(principal, secundario, () => {});

    const bytes = Buffer.from('foto');
    await d.guardar(nomeDe(bytes), bytes);
    await d.apagar(nomeDe(bytes));

    expect(await secundario.ler(nomeDe(bytes))).toBeUndefined();
  });

  it('o embrulho continua cumprindo o contrato, com cache por cima', async () => {
    // A escrita dupla é um depósito como outro qualquer — é isso que permite
    // pôr e tirar ela do caminho sem tocar em mais nada.
    const d = comCache(escreverNosDois(await novo(), await novo(), () => {}));
    const bytes = Buffer.from('foto');
    await d.guardar(nomeDe(bytes), bytes);
    expect(Buffer.compare((await d.ler(nomeDe(bytes)))!, bytes)).toBe(0);
  });
});
