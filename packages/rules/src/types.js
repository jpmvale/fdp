/**
 * Tipos do motor de regras do FDP.
 *
 * Normativo: docs/02-regras-do-jogo.md e docs/04-modelo-de-dados.md.
 * Este módulo é puro: sem rede, sem I/O, sem framework (RJ-143).
 */
export const RANKS = [
    '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A',
];
export const SUITS = ['copas', 'ouros', 'espadas', 'paus'];
export const DEFAULT_OPTIONS = {
    vidasIniciais: 5,
    maxCartasPorRodada: 7,
    regraEmpate: 'EMPATE_ANULA_CARTAS',
};
/** Fases que avançam por timer do servidor, não por comando (`03` §4.2). */
export const AUTOMATIC_PHASES = [
    'DISTRIBUICAO',
    'REVELACAO',
    'RESOLUCAO',
];
