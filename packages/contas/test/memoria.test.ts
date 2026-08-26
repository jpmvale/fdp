import { criarDadosEmMemoria } from '../src/memoria.js';
import { descreverContratoDeDados } from './contrato.js';

descreverContratoDeDados({
  nome: 'memória',
  async criar() { return criarDadosEmMemoria(); },
});
