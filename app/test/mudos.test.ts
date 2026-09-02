/**
 * Silenciar para mim (plano 03 §9.1). CA-430.
 *
 * O armazenamento é injetado, e não simulado com um DOM inteiro: o caso que
 * interessa é o `localStorage` que LANÇA — aba anônima, dados de site
 * bloqueados —, e ele é mais fácil de produzir com uma implementação de três
 * linhas do que com um navegador de mentira.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { alternarMudo, gravarMudos, lerMudos, limparOutrasSalas, type Armazem } from '../src/mudos';

/** Um `localStorage` de bolso, com a mesma superfície que o módulo usa. */
function armazemFalso(): Armazem & { dados: Map<string, string> } {
  const dados = new Map<string, string>();
  return {
    dados,
    getItem: (c) => dados.get(c) ?? null,
    setItem: (c, v) => { dados.set(c, v); },
    removeItem: (c) => { dados.delete(c); },
    key: (i) => [...dados.keys()][i] ?? null,
    get length() { return dados.size; },
  };
}

/** O que uma aba anônima faz: lançar no próprio acesso. */
const armazemQueLanca = (): Armazem => ({
  getItem: () => { throw new Error('bloqueado'); },
  setItem: () => { throw new Error('bloqueado'); },
  removeItem: () => { throw new Error('bloqueado'); },
  key: () => { throw new Error('bloqueado'); },
  get length(): number { throw new Error('bloqueado'); },
});

let onde: ReturnType<typeof armazemFalso>;
beforeEach(() => { onde = armazemFalso(); });

describe('CA-430: a lista de quem eu escondi', () => {
  it('alternar liga e desliga, e devolve um conjunto NOVO', () => {
    const vazio = new Set<string>();
    const com = alternarMudo(vazio, 'p2');
    expect(com.has('p2')).toBe(true);
    // O React compara por identidade: mutar o mesmo Set não renderizaria nada.
    expect(com).not.toBe(vazio);
    expect(vazio.size).toBe(0);
    expect(alternarMudo(com, 'p2').has('p2')).toBe(false);
  });

  it('sobrevive a recarregar a página, e é POR SALA', () => {
    gravarMudos('AAAAA', new Set(['p2', 'p3']), onde);
    gravarMudos('BBBBB', new Set(['p9']), onde);

    // O `playerId` só existe dentro de uma sala: guardar por sala é o único
    // recorte que significa alguma coisa.
    expect([...lerMudos('AAAAA', onde)].sort()).toEqual(['p2', 'p3']);
    expect([...lerMudos('BBBBB', onde)]).toEqual(['p9']);
    expect(lerMudos('CCCCC', onde).size).toBe(0);
  });

  it('lista vazia apaga a chave em vez de gravar "[]"', () => {
    gravarMudos('AAAAA', new Set(['p2']), onde);
    gravarMudos('AAAAA', new Set(), onde);
    expect(onde.dados.has('fdp:mudos:AAAAA')).toBe(false);
  });

  it('conteúdo corrompido lê como lista vazia, e não derruba o chat', () => {
    onde.dados.set('fdp:mudos:AAAAA', 'isto não é json');
    expect(lerMudos('AAAAA', onde).size).toBe(0);

    onde.dados.set('fdp:mudos:AAAAA', '{"nao":"e uma lista"}');
    expect(lerMudos('AAAAA', onde).size).toBe(0);

    // Lista com lixo dentro: fica o que é utilizável.
    onde.dados.set('fdp:mudos:AAAAA', '["p2", 7, null, "p3"]');
    expect([...lerMudos('AAAAA', onde)].sort()).toEqual(['p2', 'p3']);
  });

  it('armazenamento que LANÇA não quebra nada', () => {
    const ruim = armazemQueLanca();
    expect(() => lerMudos('AAAAA', ruim)).not.toThrow();
    expect(lerMudos('AAAAA', ruim).size).toBe(0);
    expect(() => gravarMudos('AAAAA', new Set(['p2']), ruim)).not.toThrow();
    expect(() => limparOutrasSalas('AAAAA', ruim)).not.toThrow();
  });

  it('sem armazenamento nenhum, tudo continua funcionando', () => {
    expect(lerMudos('AAAAA', null).size).toBe(0);
    expect(() => gravarMudos('AAAAA', new Set(['p2']), null)).not.toThrow();
    expect(() => limparOutrasSalas('AAAAA', null)).not.toThrow();
  });

  it('a limpeza tira as outras salas, preserva a atual, e não toca no que não é nosso', () => {
    gravarMudos('AAAAA', new Set(['p2']), onde);
    gravarMudos('BBBBB', new Set(['p3']), onde);
    gravarMudos('CCCCC', new Set(['p4']), onde);
    onde.dados.set('fdp:sessao', 'não é nossa');

    limparOutrasSalas('BBBBB', onde);

    expect(lerMudos('AAAAA', onde).size).toBe(0);
    expect([...lerMudos('BBBBB', onde)]).toEqual(['p3']);
    expect(lerMudos('CCCCC', onde).size).toBe(0);
    expect(onde.dados.get('fdp:sessao')).toBe('não é nossa');
  });
});
