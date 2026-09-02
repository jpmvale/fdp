/**
 * O link de convite (RF-107). CA-005 e CA-432.
 *
 * Testado puro porque o modo de errar aqui é silencioso: o código não é
 * preenchido, e quem clicou no convite cai numa tela vazia sem entender por quê.
 */

import { describe, expect, it } from 'vitest';
import { codigoDoConvite, linkDoConvite } from '../src/convite';

const em = (pathname: string, search = '') => ({ pathname, search });

describe('CA-005: o link de convite preenche o código', () => {
  it('lê o código do caminho `/j/CÓDIGO`', () => {
    expect(codigoDoConvite(em('/j/K7QMP'))).toBe('K7QMP');
    expect(codigoDoConvite(em('/j/K7QMP/'))).toBe('K7QMP');
  });

  it('aceita minúsculas: quem digita à mão não usa shift', () => {
    expect(codigoDoConvite(em('/j/k7qmp'))).toBe('K7QMP');
    expect(codigoDoConvite(em('/', '?sala=k7qmp'))).toBe('K7QMP');
  });

  it('CA-432: o formato antigo `?sala=` continua entrando', () => {
    // Links já foram mandados em conversas que ninguém vai voltar para
    // corrigir. Link de convite que morre é a pior coisa que este jogo
    // poderia fazer com quem o divulgou.
    expect(codigoDoConvite(em('/', '?sala=K7QMP'))).toBe('K7QMP');
  });

  it('o caminho ganha da query quando os dois existem', () => {
    // Cenário real: alguém edita a URL de um convite e deixa a query velha.
    // O que a pessoa acabou de abrir é o caminho.
    expect(codigoDoConvite(em('/j/AAAAA', '?sala=BBBBB'))).toBe('AAAAA');
  });

  it('o que não tem cara de código não preenche nada', () => {
    // Deixar lixo no campo faria a pessoa apagar caractere por caractere
    // antes de poder digitar o certo.
    for (const caso of [em('/'), em('/j/'), em('/j/CURTO'.slice(0, 6)), em('/j/CODIGOGRANDE'),
      em('/', '?sala='), em('/qualquer/coisa')]) {
      expect(codigoDoConvite(caso), JSON.stringify(caso)).toBe('');
    }
  });

  it('o link gerado é o que o servidor sabe ler', () => {
    const link = linkDoConvite('https://fdp.exemplo.com', 'K7QMP');
    expect(link).toBe('https://fdp.exemplo.com/j/K7QMP');
    expect(codigoDoConvite(new URL(link))).toBe('K7QMP');
  });
});
