/**
 * As datas do histórico (RF-108). CA-434.
 *
 * O "agora" é injetado porque o assunto AQUI são viradas: virada de dia, de
 * ano, e fusos. Um teste que lesse o relógio de verdade passaria hoje e
 * reprovaria em 1º de janeiro — no código que existe para tratar exatamente
 * isso.
 */

import { describe, expect, it } from 'vitest';
import { agruparPorDia, dataPorExtenso, diasDeDiferenca, rotuloDoDia } from '../src/datas';

/** Um instante local, para o teste não depender do fuso da máquina. */
const em = (ano: number, mes: number, dia: number, hora = 12, min = 0): number =>
  new Date(ano, mes - 1, dia, hora, min).getTime();

const AGORA = em(2026, 9, 2, 15, 30);

describe('CA-434: o rótulo do dia', () => {
  it('hoje é "hoje", e ontem é "ontem"', () => {
    // É assim que alguém se refere à partida de ontem. Ninguém diz "joguei em
    // 1º de setembro" no dia seguinte.
    expect(rotuloDoDia(em(2026, 9, 2, 9, 0), AGORA)).toBe('hoje');
    expect(rotuloDoDia(em(2026, 9, 1, 23, 59), AGORA)).toBe('ontem');
  });

  it('de anteontem em diante vale a data', () => {
    expect(rotuloDoDia(em(2026, 8, 31), AGORA)).toBe('31 de agosto');
    expect(rotuloDoDia(em(2026, 1, 12), AGORA)).toBe('12 de janeiro');
  });

  it('o ANO aparece quando não é o corrente', () => {
    // "12 de janeiro" de dois anos atrás se lê como janeiro deste ano — e num
    // histórico ordenado do mais novo para o mais velho, a confusão acontece
    // no fim da lista, onde ninguém está prestando atenção.
    expect(rotuloDoDia(em(2024, 1, 12), AGORA)).toBe('12 de janeiro de 2024');
    expect(rotuloDoDia(em(2025, 12, 31), AGORA)).toBe('31 de dezembro de 2025');
  });

  it('vinte minutos podem ser dias diferentes', () => {
    /**
     * O caso que faz `meiaNoite` existir.
     *
     * 23h50 e 00h10 estão a vinte minutos uma da outra, e são dias diferentes —
     * e é o dia diferente que a pessoa lembra. Contar por diferença de
     * milissegundos diria "hoje" para as duas.
     */
    const noite = em(2026, 9, 1, 23, 50);
    const madrugada = em(2026, 9, 2, 0, 10);
    expect(rotuloDoDia(noite, AGORA)).toBe('ontem');
    expect(rotuloDoDia(madrugada, AGORA)).toBe('hoje');
  });

  it('vinte e três horas podem ser o mesmo dia', () => {
    // O inverso: 00h10 e 23h50 do MESMO dia estão a quase 24 h e são o mesmo
    // dia. É o outro lado do mesmo erro.
    expect(diasDeDiferenca(em(2026, 9, 2, 0, 10), em(2026, 9, 2, 23, 50))).toBe(0);
  });

  it('a virada do ano é só mais uma virada de dia', () => {
    const reveillon = em(2027, 1, 1, 10, 0);
    expect(rotuloDoDia(em(2026, 12, 31, 22, 0), reveillon)).toBe('ontem');
  });
});

describe('CA-434: o agrupamento', () => {
  const partida = (quando: number, id: string) => ({ quando, id });

  it('junta as partidas da mesma noite num grupo só', () => {
    const partidas = [
      partida(em(2026, 9, 2, 22, 0), 'a'),
      partida(em(2026, 9, 2, 21, 0), 'b'),
      partida(em(2026, 9, 1, 20, 0), 'c'),
    ];
    const grupos = agruparPorDia(partidas, (p) => p.quando, AGORA);

    expect(grupos.map((g) => g.rotulo)).toEqual(['hoje', 'ontem']);
    expect(grupos[0]!.itens.map((p) => p.id)).toEqual(['a', 'b']);
    expect(grupos[1]!.itens.map((p) => p.id)).toEqual(['c']);
  });

  it('preserva a ordem que veio do servidor, dentro e fora dos grupos', () => {
    // Reordenar aqui faria a paginação do perfil (RF-090) embaralhar o que o
    // servidor já ordenou — e "ver mais" passaria a repetir e pular partidas.
    const partidas = [
      partida(em(2026, 8, 20), 'velha'),
      partida(em(2026, 9, 2), 'nova'),
      partida(em(2026, 8, 20), 'velha2'),
    ];
    const grupos = agruparPorDia(partidas, (p) => p.quando, AGORA);
    // Três grupos, e não dois: o mesmo dia separado por outro dia continua
    // separado, porque a ordem manda.
    expect(grupos.map((g) => g.rotulo))
      .toEqual(['20 de agosto', 'hoje', '20 de agosto']);
  });

  it('lista vazia dá zero grupos, e não um grupo vazio', () => {
    expect(agruparPorDia([], (p: { quando: number }) => p.quando, AGORA)).toEqual([]);
  });
});

describe('CA-434: a data por extenso', () => {
  it('traz dia, mês, ano e HORA — o que o rótulo curto perde', () => {
    // Duas partidas do mesmo dia ficariam indistinguíveis sem a hora, e é isso
    // que o `title` e o rótulo acessível devolvem (RNF-038).
    const texto = dataPorExtenso(em(2026, 9, 2, 21, 5));
    expect(texto).toContain('02/09/2026');
    expect(texto).toContain('21:05');
  });
});
