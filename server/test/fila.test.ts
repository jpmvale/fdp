/**
 * O pareamento (plano 03 §5.3 e §5.4). CA-422 e a base de CA-426.
 */

import { describe, expect, it } from 'vitest';
import { ELO_INICIAL, type Avatar } from '@fdp/protocol';
import {
  compativeis,
  decidirFormacao,
  faixaDe,
  JANELA_MS,
  novoBilhete,
  PASSO_MS,
  SEM_FAIXA_APOS_MS,
  type Bilhete,
  type ModoDeFila,
} from '../src/fila.js';

const AVATAR: Avatar = { emoji: '🦊', color: 'amber' };

function fila(
  quantos: number,
  opcoes: { modo?: ModoDeFila; agora?: number; elos?: number[] } = {},
): Bilhete[] {
  const modo = opcoes.modo ?? 'NORMAL';
  return Array.from({ length: quantos }, (_, i) =>
    novoBilhete({
      id: `b${i + 1}`,
      modo,
      apelido: `J${i + 1}`,
      avatar: AVATAR,
      elo: opcoes.elos?.[i] ?? ELO_INICIAL,
      // Um por segundo, para a ordem de chegada ser inequívoca.
      agora: (opcoes.agora ?? 0) + i * 1000,
    }));
}

describe('CA-422: quando a mesa se forma', () => {
  it('menos que o mínimo espera', () => {
    for (const n of [0, 1, 2, 3]) {
      expect(decidirFormacao(fila(n), 10_000, null, 'NORMAL'), `${n} na fila`)
        .toEqual({ tipo: 'ESPERAR' });
    }
  });

  it('ao chegar ao mínimo, abre a janela — e não forma na hora', () => {
    const d = decidirFormacao(fila(4), 10_000, null, 'NORMAL');
    expect(d).toEqual({ tipo: 'ABRIR_JANELA', ate: 10_000 + JANELA_MS });
  });

  it('com a janela aberta e ainda correndo, espera', () => {
    expect(decidirFormacao(fila(5), 10_000, 70_000, 'NORMAL')).toEqual({ tipo: 'ESPERAR' });
  });

  it('a janela vencida forma com quem estiver — 4, 5, 6 ou 7', () => {
    for (const n of [4, 5, 6, 7]) {
      const d = decidirFormacao(fila(n), 70_000, 70_000, 'NORMAL');
      expect(d.tipo, `${n} na fila`).toBe('FORMAR');
      if (d.tipo === 'FORMAR') expect(d.mesa).toHaveLength(n);
    }
  });

  it('a mesa cheia forma na hora, sem esperar o resto da janela', () => {
    const d = decidirFormacao(fila(8), 10_000, 70_000, 'NORMAL');
    expect(d.tipo).toBe('FORMAR');
    if (d.tipo === 'FORMAR') expect(d.mesa).toHaveLength(8);
  });

  it('mais de oito na fila forma UMA mesa, e a mais antiga', () => {
    const d = decidirFormacao(fila(11), 20_000, null, 'NORMAL');
    expect(d.tipo).toBe('FORMAR');
    if (d.tipo === 'FORMAR') {
      expect(d.mesa.map((b) => b.id)).toEqual(['b1', 'b2', 'b3', 'b4', 'b5', 'b6', 'b7', 'b8']);
    }
  });

  it('encolher abaixo do mínimo fecha a janela', () => {
    // A janela existia para uma mesa possível crescer. Sem mesa possível,
    // mantê-la aberta faria a próxima formação usar um relógio de outro grupo.
    expect(decidirFormacao(fila(3), 30_000, 70_000, 'NORMAL')).toEqual({ tipo: 'FECHAR_JANELA' });
    expect(decidirFormacao(fila(3), 30_000, null, 'NORMAL')).toEqual({ tipo: 'ESPERAR' });
  });

  it('a ordem é sempre a de chegada, mesmo com a fila embaralhada', () => {
    const desordenada = [...fila(6)].reverse();
    expect(compativeis(desordenada, 10_000, 'NORMAL').map((b) => b.id))
      .toEqual(['b1', 'b2', 'b3', 'b4', 'b5', 'b6']);
  });
});

describe('CA-426: a faixa de elo alarga com a espera', () => {
  it('a faixa começa em 150 e cresce de 50 em 50 a cada meio minuto', () => {
    expect(faixaDe(0)).toBe(150);
    expect(faixaDe(PASSO_MS - 1)).toBe(150);
    expect(faixaDe(PASSO_MS)).toBe(200);
    expect(faixaDe(PASSO_MS * 2)).toBe(250);
  });

  it('depois de cinco minutos não há faixa nenhuma', () => {
    expect(faixaDe(SEM_FAIXA_APOS_MS)).toBe(Infinity);
    expect(faixaDe(SEM_FAIXA_APOS_MS * 2)).toBe(Infinity);
  });

  it('na ranqueada, quem está longe demais fica de fora', () => {
    const bilhetes = fila(4, { modo: 'RANQUEADA', elos: [1000, 1050, 1900, 1100] });
    const grupo = compativeis(bilhetes, 3000, 'RANQUEADA');
    expect(grupo.map((b) => b.id)).toEqual(['b1', 'b2', 'b4']);
    // E com três não há mesa.
    expect(decidirFormacao(bilhetes, 3000, null, 'RANQUEADA')).toEqual({ tipo: 'ESPERAR' });
  });

  it('esperar o bastante junta quem estava longe', () => {
    const bilhetes = fila(4, { modo: 'RANQUEADA', elos: [1000, 1050, 1900, 1100] });
    // Cinco minutos depois de o primeiro entrar: sem faixa, todo mundo cabe.
    const agora = bilhetes[0]!.entrouEm + SEM_FAIXA_APOS_MS;
    expect(compativeis(bilhetes, agora, 'RANQUEADA')).toHaveLength(4);
    expect(decidirFormacao(bilhetes, agora, null, 'RANQUEADA').tipo).toBe('ABRIR_JANELA');
  });

  it('a faixa é a de quem espera há mais tempo, e não a de quem chegou agora', () => {
    // b1 espera há muito e tem faixa larga; b4 acabou de chegar. É a âncora
    // antiga que manda — é ela que precisa destravar.
    const bilhetes: Bilhete[] = [
      { ...fila(1, { modo: 'RANQUEADA' })[0]!, id: 'velho', elo: 1000, entrouEm: 0 },
      { ...fila(1, { modo: 'RANQUEADA' })[0]!, id: 'novo', elo: 1300, entrouEm: 120_000 },
    ];
    // 121 s de espera do velho → faixa 150 + 50×4 = 350. 300 de diferença cabe.
    expect(compativeis(bilhetes, 121_000, 'RANQUEADA')).toHaveLength(2);
  });

  it('a fila normal não tem faixa: sem elo, não há o que comparar', () => {
    const bilhetes = fila(4, { elos: [0, 500, 5000, 1000] });
    expect(compativeis(bilhetes, 3000, 'NORMAL')).toHaveLength(4);
  });
});
