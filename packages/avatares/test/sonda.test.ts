/**
 * A sonda de escrita (RNF-020).
 *
 * O teste que mais importa aqui é o do depósito SEM PERMISSÃO: é exatamente a
 * situação que ficou invisível em produção por semanas, e o valor da sonda é
 * ela dizer isso em voz alta na subida em vez de esperar alguém reclamar.
 */

import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { criarDepositoEmDisco, sondarDeposito, type DepositoDeAvatares } from '../src/index.js';

describe('CA-403 / RNF-020: a sonda diz se dá para gravar', () => {
  it('depósito são: passa e não deixa lixo para trás', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'fdp-sonda-'));
    const d = criarDepositoEmDisco(dir);

    expect(await sondarDeposito(d)).toEqual({ ok: true });

    const { readdir } = await import('node:fs/promises');
    // Nada de acumular um objeto por reinício do processo.
    expect(await readdir(dir)).toEqual([]);
  });

  it('sem permissão de escrita: acusa a etapa `guardar`', async () => {
    // O caso de produção, em miniatura: gravar estoura, e a sonda nomeia onde.
    const semEscrita: DepositoDeAvatares = {
      guardar: () => Promise.reject(new Error('EACCES: permission denied')),
      ler: () => Promise.resolve(undefined),
      apagar: () => Promise.resolve(),
    };

    const r = await sondarDeposito(semEscrita);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.etapa).toBe('guardar');
    expect(r.erro).toContain('EACCES');
  });

  it('grava mas devolve outra coisa: acusa `conteudo`', async () => {
    // Aceitar `write` e devolver lixo é coisa que sistema de arquivos faz.
    // Uma sonda que só grava daria verde aqui.
    const mentiroso: DepositoDeAvatares = {
      guardar: () => Promise.resolve(),
      ler: () => Promise.resolve(Buffer.from('outra coisa')),
      apagar: () => Promise.resolve(),
    };

    const r = await sondarDeposito(mentiroso);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.etapa).toBe('conteudo');
  });

  it('grava e lê, mas não apaga: acusa `apagar`', async () => {
    const semApagar: DepositoDeAvatares = {
      guardar: () => Promise.resolve(),
      ler: () => Promise.resolve(Buffer.from('sonda de escrita do fdp')),
      apagar: () => Promise.reject(new Error('EROFS')),
    };

    const r = await sondarDeposito(semApagar);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.etapa).toBe('apagar');
  });
});
