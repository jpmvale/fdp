export type { DepositoDeAvatares, NomeDeAvatar } from './tipos.js';
export { NomeInvalido, nomeValido } from './tipos.js';
export { criarDepositoEmDisco } from './disco.js';
export { comCache, CACHE_BYTES_MAX, type DepositoComCache } from './cache.js';
export { migrar, escreverNosDois, type RelatorioDeMigracao, type OpcoesDeMigracao } from './migracao.js';
export { sondarDeposito, type ResultadoDaSonda } from './sonda.js';
