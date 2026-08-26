/**
 * O depósito em disco contra a suíte de contrato.
 *
 * Roda sempre e sem nada configurado — é a implementação que sustenta a
 * promessa de que o jogo inteiro sobe numa máquina limpa.
 */

import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { criarDepositoEmDisco } from '../src/index.js';
import { descreverContratoDeDeposito } from './contrato.js';

descreverContratoDeDeposito({
  nome: 'disco',
  async criar() {
    // Um diretório por depósito: sem isso um teste enxerga o que o anterior
    // deixou, e a suíte passa a depender da ordem.
    return criarDepositoEmDisco(await mkdtemp(join(tmpdir(), 'fdp-dep-')));
  },
});
