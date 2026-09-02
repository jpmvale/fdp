/**
 * Do fim da mesa até o banco (plano 03 §6). CA-427.
 *
 * A conta em si é de `elo.test.ts`. Aqui se testa a COSTURA — o que se lê,
 * quem entra, quem fica de fora, e a ordem das duas gravações.
 */

import { describe, expect, it } from 'vitest';
import { ELO_INICIAL, type Avatar } from '@fdp/protocol';
import { criarDadosEmMemoria, type Dados, type JogadorDaPartida, type Partida } from '@fdp/contas';
import { aplicarElo } from '../src/ranqueada.js';

const AVATAR: Avatar = { emoji: '🦊', color: 'amber' };

const jogador = (over: Partial<JogadorDaPartida>): JogadorDaPartida => ({
  posicao: 0, contaId: null, apelido: 'Convidado', avatar: AVATAR, bot: false,
  dificuldade: null, colocacao: 1, vidasFinais: 0, eliminadoRodada: null,
  mortoEmVaza: null, acertos: 0, jogadas: 4, erroMedio: 0, piorErro: 0, nota: 5,
  eloAntes: null, eloDelta: null, abandonou: false,
  ...over,
});

async function conta(d: Dados, apelido: string): Promise<string> {
  const r = await d.contas.criarComSenha({
    apelido, avatar: AVATAR, email: `${apelido.toLowerCase()}@exemplo.com`, hash: 'h' });
  if (!r.ok) throw new Error('cadastro falhou');
  return r.conta.id;
}

async function gravar(
  d: Dados,
  jogadores: JogadorDaPartida[],
  origem: Partida['origem'] = 'RANQUEADA',
): Promise<Partida> {
  const p = await d.partidas.gravar({
    salaCodigo: 'AB12C', origem,
    comecouEm: 1_000, terminouEm: 2_000, motivoFim: 'VITORIA', rodadas: 5,
    opcoes: {} as Partida['opcoes'], jogadores,
  });
  if (!p) throw new Error('não gravou');
  return p;
}

describe('CA-427: o elo de uma partida ranqueada', () => {
  it('quatro contas numa ranqueada saem com o elo mexido e a participação gravada', async () => {
    const d = criarDadosEmMemoria();
    const ids = [];
    for (const nome of ['Ana', 'Beto', 'Carla', 'Dario']) ids.push(await conta(d, nome));

    const p = await gravar(d, ids.map((id, i) =>
      jogador({ posicao: i, contaId: id, colocacao: i + 1 })));
    await aplicarElo(d, p);

    const elos = await d.elos.porContas(ids);
    // Primeira ranqueada de todo mundo: K = 80, mesa de 4.
    expect(elos.get(ids[0]!)!.pontos).toBe(ELO_INICIAL + 80);
    expect(elos.get(ids[1]!)!.pontos).toBe(ELO_INICIAL + 27);
    expect(elos.get(ids[2]!)!.pontos).toBe(ELO_INICIAL - 27);
    expect(elos.get(ids[3]!)!.pontos).toBe(ELO_INICIAL - 80);

    const relida = await d.partidas.porId(p.id);
    expect(relida!.jogadores.map((j) => j.eloDelta)).toEqual([80, 27, -27, -80]);
    expect(relida!.jogadores.every((j) => j.eloAntes === ELO_INICIAL)).toBe(true);
  });

  it('partida que NÃO é ranqueada não mexe em elo nenhum', async () => {
    const d = criarDadosEmMemoria();
    const ana = await conta(d, 'Ana');
    for (const origem of ['PRIVADA', 'FILA'] as const) {
      const p = await gravar(d, [jogador({ contaId: ana, colocacao: 1 })], origem);
      await aplicarElo(d, p);
    }
    const elo = (await d.elos.porContas([ana])).get(ana)!;
    expect(elo.pontos).toBe(ELO_INICIAL);
    expect(elo.partidas).toBe(0);
  });

  it('bot e convidado ficam de fora, mas CONTAM no tamanho da mesa', async () => {
    const d = criarDadosEmMemoria();
    const ana = await conta(d, 'Ana');

    // Mesa de 4: uma conta em 2º, um convidado, um bot e mais um convidado.
    // Se a normalização fosse por "quantos têm conta", a Ana estaria sozinha
    // numa mesa de 1 e o delta seria zero — a mesma colocação valendo coisas
    // diferentes conforme quem por acaso estava logado.
    const p = await gravar(d, [
      jogador({ posicao: 0, contaId: null, colocacao: 1 }),
      jogador({ posicao: 1, contaId: ana, colocacao: 2 }),
      jogador({ posicao: 2, contaId: null, bot: true, dificuldade: 'MEDIO', colocacao: 3 }),
      jogador({ posicao: 3, contaId: null, colocacao: 4 }),
    ]);
    await aplicarElo(d, p);

    // 2º de 4, K = 80: +27. É o mesmo valor da mesa de quatro contas.
    expect((await d.elos.porContas([ana])).get(ana)!.pontos).toBe(ELO_INICIAL + 27);
  });

  it('bot com conta na linha não recebe elo — a defesa é dupla', async () => {
    const d = criarDadosEmMemoria();
    const ana = await conta(d, 'Ana');
    const beto = await conta(d, 'Beto');
    // `historico.ts` já impede um bot de levar conta. Isto cobre o caso de a
    // linha chegar assim mesmo: um bot que ganhasse elo seria elo saído do
    // nada, e a soma zero da mesa deixaria de valer.
    const p = await gravar(d, [
      jogador({ posicao: 0, contaId: ana, colocacao: 1 }),
      jogador({ posicao: 1, contaId: beto, bot: true, colocacao: 2 }),
    ]);
    await aplicarElo(d, p);

    expect((await d.elos.porContas([beto])).get(beto)!.partidas).toBe(0);
    expect((await d.elos.porContas([ana])).get(ana)!.pontos).toBe(ELO_INICIAL + 80);
  });

  it('quem abandonou leva a punição, e quem terminou não', async () => {
    const d = criarDadosEmMemoria();
    const ana = await conta(d, 'Ana');
    const beto = await conta(d, 'Beto');

    // O assento do Beto terminou em 1º com o bot dentro — e não importa.
    const p = await gravar(d, [
      jogador({ posicao: 0, contaId: beto, colocacao: 1, abandonou: true }),
      jogador({ posicao: 1, contaId: ana, colocacao: 2 }),
    ]);
    await aplicarElo(d, p);

    expect((await d.elos.porContas([beto])).get(beto)!.pontos).toBe(ELO_INICIAL - 80 - 25);
    expect((await d.elos.porContas([ana])).get(ana)!.pontos).toBe(ELO_INICIAL - 80);

    const relida = await d.partidas.porId(p.id);
    expect(relida!.jogadores.find((j) => j.contaId === beto)!.abandonou).toBe(true);
  });

  it('mesa só de convidados não escreve nada', async () => {
    const d = criarDadosEmMemoria();
    const ana = await conta(d, 'Ana');
    // A partida só é gravada porque a Ana está nela (RF-068); a segunda
    // participação é de convidado, e o elo não tem o que fazer com ela.
    const p = await gravar(d, [
      jogador({ posicao: 0, contaId: ana, colocacao: 1 }),
      jogador({ posicao: 1, contaId: null, colocacao: 2 }),
    ]);
    await aplicarElo(d, p);
    expect((await d.elos.porContas([ana])).get(ana)!.partidas).toBe(1);
  });

  it('a segunda ranqueada já usa o K de quem tem uma partida — a contagem anda', async () => {
    const d = criarDadosEmMemoria();
    const ana = await conta(d, 'Ana');
    const beto = await conta(d, 'Beto');
    for (let i = 0; i < 2; i++) {
      const p = await gravar(d, [
        jogador({ posicao: 0, contaId: ana, colocacao: 1 }),
        jogador({ posicao: 1, contaId: beto, colocacao: 2 }),
      ]);
      await aplicarElo(d, p);
    }
    expect((await d.elos.porContas([ana])).get(ana)!.partidas).toBe(2);
    // Duas vitórias de +80 (as duas ainda na faixa de calibração).
    expect((await d.elos.porContas([ana])).get(ana)!.pontos).toBe(ELO_INICIAL + 160);
  });
});
