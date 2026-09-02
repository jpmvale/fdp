/**
 * O histórico gravado (plano 01, F4).
 *
 * O teste que carrega esta fase é CA-368: os números do histórico têm de ser
 * os MESMOS da tela de fim. Não "equivalentes" — os mesmos, saídos da mesma
 * função. É o defeito de CA-360 outra vez, e pior: ali a divergência aparecia
 * na tela e sumia; aqui ela ficaria gravada no banco.
 */

import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  applyCommand, createRoom, join, type Room,
} from '@fdp/room';
import {
  desempenhoDaPartida, numerosDaPartida, ranking,
  isAutomaticPhase, advance, autoMove, applyMove,
  type MatchState,
} from '@fdp/rules';
import { createMemoryStore } from '@fdp/store';
import { criarDadosEmMemoria, type Dados } from '@fdp/contas';
import { createHub, type Hub } from '../src/hub.js';
import { createPersistence } from '../src/persistence.js';
import { registroDaPartida } from '../src/historico.js';

const CLIENT = fileURLToPath(new URL('../../app/build/', import.meta.url));
void CLIENT;

let hub: Hub;
let dados: Dados;
let agora = 1_700_000_000_000;
let gravadas: number;

const ctx = () => ({ now: agora, randomSeed: () => 'semente-fixa', newId: () => randomBytes(8).toString('hex') });

/**
 * Uma partida inteira, jogada pelo auto-play do motor.
 *
 * É o caminho de verdade: `host:startMatch` e depois o relógio, sem atalho
 * pelo estado interno. O que sai daqui é o que sairia de uma mesa real.
 */
function partidaCompleta(comContas: (string | null)[]): { room: Room; estado: MatchState } {
  let room = createRoom('AB12C', {
    playerId: 'p1', nickname: 'Ana',
    avatar: { emoji: '🦊', color: 'amber' },
    conta: comContas[0] === null ? null : 'ana',
    contaId: comContas[0] ?? null,
  }, ctx());

  for (let i = 1; i < comContas.length; i++) {
    const r = join(room, {
      playerId: `p${i + 1}`, nickname: `J${i + 1}`,
      avatar: { emoji: '🐙', color: 'teal' },
      conta: comContas[i] === null ? null : `j${i + 1}`,
      contaId: comContas[i]!,
    }, ctx());
    if (!r.ok) throw new Error('join falhou');
    room = r.room;
  }

  // RF-094: todo mundo sentado confirma antes de o host começar.
  room = room.players
    .filter((p) => !p.isSpectator && p.bot === null)
    .reduce((r, p) => {
      const res = applyCommand(r, p.id,
        { type: 'player:setPronto', payload: { pronto: true } }, ctx());
      return res.ok ? res.room : r;
    }, room);

  const inicio = applyCommand(room, room.hostId!, { type: 'host:startMatch', payload: {} }, ctx());
  if (!inicio.ok) throw new Error('não começou');
  room = inicio.room;

  let estado = room.match!;
  let passos = 0;
  while (estado.endReason === null) {
    if (++passos > 20_000) throw new Error('partida não terminou');
    if (isAutomaticPhase(estado.round.phase)) {
      const r = advance(estado, { now: agora });
      if (!r.ok) throw new Error('advance falhou');
      estado = r.state;
      continue;
    }
    const jogada = autoMove(estado);
    const r = applyMove(estado, jogada, { now: agora });
    if (!r.ok) throw new Error(`jogada recusada: ${r.code}`);
    estado = r.state;
  }

  return { room: { ...room, match: estado }, estado };
}

beforeEach(() => {
  agora = 1_700_000_000_000;
  gravadas = 0;
  dados = criarDadosEmMemoria({ agora: () => agora });
  hub = createHub({
    persistence: createPersistence({ store: createMemoryStore() }),
    now: () => agora,
    randomSeed: () => randomBytes(16).toString('hex'),
    onFimDePartida: () => { gravadas++; },
  });
});

describe('CA-368: o histórico e a tela de fim contam a mesma partida', () => {
  it('colocação, nota e números vêm das MESMAS funções do motor', () => {
    const { room, estado } = partidaCompleta(['conta-ana', 'conta-beto', null]);
    const registro = registroDaPartida(room, estado, agora)!;
    expect(registro).not.toBeNull();

    // O que a TELA de fim usaria, chamado aqui do mesmo jeito.
    const ordemDaTela = ranking(estado);
    const notasDaTela = new Map(desempenhoDaPartida(estado).map((d) => [d.playerId, d]));
    const numerosDaTela = numerosDaPartida(estado);

    for (const j of registro.jogadores) {
      const id = estado.playerOrder[j.posicao]!;
      expect(j.colocacao).toBe(ordemDaTela.indexOf(id) + 1);
      expect(j.nota).toBe(notasDaTela.get(id)!.nota);

      const n = numerosDaTela.get(id);
      expect(j.acertos).toBe(n?.acertos ?? 0);
      expect(j.jogadas).toBe(n?.jogadas ?? 0);
      expect(j.piorErro).toBe(n?.pior ?? 0);
      expect(j.erroMedio).toBeCloseTo(n?.erroMedio ?? 0, 2);
    }
  });

  it('o campeão é o primeiro colocado, e há exatamente um por posição', () => {
    const { room, estado } = partidaCompleta(['conta-ana', 'conta-beto', 'conta-caio']);
    const registro = registroDaPartida(room, estado, agora)!;

    const posicoes = registro.jogadores.map((j) => j.colocacao).sort((a, b) => a - b);
    expect(posicoes).toEqual([1, 2, 3]);

    const primeiro = registro.jogadores.find((j) => j.colocacao === 1)!;
    const id = estado.playerOrder[primeiro.posicao]!;
    expect(estado.winnerIds).toContain(id);
  });

  it('guarda o motivo do fim e as opções congeladas', () => {
    const { room, estado } = partidaCompleta(['conta-ana', 'conta-beto']);
    const registro = registroDaPartida(room, estado, agora)!;

    expect(registro.motivoFim).toBe(estado.endReason);
    expect(registro.rodadas).toBe(estado.history.length);
    expect(registro.opcoes).toEqual(estado.options);
    expect(registro.salaCodigo).toBe('AB12C');
  });

  it('partida sem fim não vira registro', () => {
    const { room, estado } = partidaCompleta(['conta-ana', 'conta-beto']);
    const semFim = { ...estado, endReason: null };
    expect(registroDaPartida(room, semFim, agora)).toBeNull();
  });
});

describe('quem entra no registro', () => {
  it('convidado entra com snapshot e sem conta', () => {
    const { room, estado } = partidaCompleta(['conta-ana', null]);
    const registro = registroDaPartida(room, estado, agora)!;

    const comConta = registro.jogadores.filter((j) => j.contaId !== null);
    const sem = registro.jogadores.filter((j) => j.contaId === null);
    expect(comConta).toHaveLength(1);
    expect(sem).toHaveLength(1);
    // O convidado aparece com o nome que teve na mesa.
    expect(sem[0]!.apelido).toBe('J2');
    expect(sem[0]!.bot).toBe(false);
  });

  it('bot nunca leva conta, nem que a sala se confunda', () => {
    let room = createRoom('AB12C', {
      playerId: 'p1', nickname: 'Ana', avatar: { emoji: '🦊', color: 'amber' },
      conta: 'ana', contaId: 'conta-ana',
    }, ctx());

    const comBot = applyCommand(room, 'p1', {
      type: 'host:addBot', payload: { difficulty: 'MEDIO' },
    }, ctx());
    if (!comBot.ok) throw new Error('bot não sentou');
    room = comBot.room;

    const bot = room.players.find((p) => p.bot !== null)!;
    expect(bot.conta).toBeNull();
    expect(bot.contaId).toBeNull();
  });

  /** O id interno da conta é chave estrangeira, e não pode sair para a mesa. */
  it('o id interno da conta não aparece na projeção', () => {
    const { room } = partidaCompleta(['conta-ana', 'conta-beto']);
    const publico = JSON.stringify(room.players.map((p) => ({
      id: p.id, nickname: p.nickname, conta: p.conta,
    })));
    expect(publico).not.toContain('conta-ana');
    expect(publico).toContain('"conta":"ana"');
  });
});

/** RF-071 / CA-369: histórico é registro, não jogo. */
describe('CA-369: banco fora do ar não afeta a partida', () => {
  it('o gancho estoura e a sala segue viva', () => {
    const explosivo = createHub({
      persistence: createPersistence({ store: createMemoryStore() }),
      now: () => agora,
      randomSeed: () => randomBytes(16).toString('hex'),
      onFimDePartida: () => { throw new Error('Postgres caiu'); },
    });

    const { room, estado } = partidaCompleta(['conta-ana', 'conta-beto']);
    const erro = vi.spyOn(console, 'error').mockImplementation(() => {});

    // Não pode lançar: derrubar aqui derrubaria a entrega dos eventos e a mesa
    // junto, trocando uma falha pequena por uma grande.
    expect(() => explosivo.commit({
      ok: true, room: { ...room, match: estado }, emissions: [],
    })).not.toThrow();

    expect(erro).toHaveBeenCalled();
    expect(explosivo.get('AB12C')).toBeDefined();
    erro.mockRestore();
  });

  it('a mesma partida não é gravada duas vezes', () => {
    const { room, estado } = partidaCompleta(['conta-ana', 'conta-beto']);
    const finalizada = { ...room, match: estado };

    // `settle` roda mais de uma vez por partida: o encerramento emite, e o
    // relógio ainda anda depois.
    hub.commit({ ok: true, room: finalizada, emissions: [] });
    hub.commit({ ok: true, room: finalizada, emissions: [] });
    hub.commit({ ok: true, room: finalizada, emissions: [] });

    expect(gravadas).toBe(1);
  });
});

describe('a regra de RF-068 mora no repositório', () => {
  it('mesa só de convidados não grava nada', async () => {
    const { room, estado } = partidaCompleta([null, null]);
    const registro = registroDaPartida(room, estado, agora)!;

    // O registro é montado — a decisão de persistir não é daqui.
    expect(registro.jogadores).toHaveLength(2);
    // E o repositório recusa.
    expect(await dados.partidas.gravar(registro)).toBeNull();
  });

  it('com um jogador de conta, grava e aparece no perfil', async () => {
    const { room, estado } = partidaCompleta(['conta-ana', null]);

    const conta = await dados.contas.criarComSenha({
      apelido: 'Ana', avatar: { emoji: '🦊', color: 'amber' },
      email: 'ana@exemplo.com', hash: 'h',
    });
    if (!conta.ok) throw new Error('cadastro falhou');

    const registro = registroDaPartida(room, estado, agora)!;
    // Casa o id de mentira da partida com o da conta de verdade.
    registro.jogadores[0]!.contaId = conta.conta.id;

    const gravada = await dados.partidas.gravar(registro);
    expect(gravada).not.toBeNull();

    const resumo = await dados.partidas.resumoDaConta(conta.conta.id);
    expect(resumo.partidas).toBe(1);
    expect(resumo.notaMedia).toBe(registro.jogadores[0]!.nota);
  });
});

/**
 * O elo que faltava: hub → repositório → perfil, ligado como o `main.ts` liga.
 *
 * Os testes acima provam as peças. Este prova a corrente: uma partida jogada
 * até o fim entra no banco sozinha, pelo gancho, e reaparece no resumo da
 * conta com os mesmos números. É o gate da F4 sem depender de navegador.
 */
describe('F4: a partida termina e aparece no perfil', () => {
  it('o gancho grava, e o resumo da conta reflete a partida', async () => {
    const conta = await dados.contas.criarComSenha({
      apelido: 'Ana', avatar: { emoji: '🦊', color: 'amber' },
      email: 'ana@exemplo.com', hash: 'h',
    });
    if (!conta.ok) throw new Error('cadastro falhou');

    const gravacoes: Promise<unknown>[] = [];
    const comHistorico = createHub({
      persistence: createPersistence({ store: createMemoryStore() }),
      now: () => agora,
      randomSeed: () => randomBytes(16).toString('hex'),
      // Exatamente o que `main.ts` faz.
      onFimDePartida: (room, estado) => {
        const registro = registroDaPartida(room, estado, agora);
        if (registro) gravacoes.push(dados.partidas.gravar(registro));
      },
    });

    const { room, estado } = partidaCompleta([conta.conta.id, null]);
    comHistorico.commit({ ok: true, room: { ...room, match: estado }, emissions: [] });

    await Promise.all(gravacoes);

    const resumo = await dados.partidas.resumoDaConta(conta.conta.id);
    expect(resumo.partidas).toBe(1);

    const minhas = await dados.partidas.porConta(conta.conta.id);
    expect(minhas).toHaveLength(1);

    const eu = minhas[0]!.jogadores.find((j) => j.contaId === conta.conta.id)!;
    // Os mesmos números da tela de fim, agora vindos do BANCO.
    const notasDaTela = new Map(desempenhoDaPartida(estado).map((d) => [d.playerId, d]));
    const meuId = estado.playerOrder[eu.posicao]!;
    expect(eu.nota).toBe(notasDaTela.get(meuId)!.nota);
    expect(eu.colocacao).toBe(ranking(estado).indexOf(meuId) + 1);

    // E o convidado veio junto, por snapshot e sem conta.
    expect(minhas[0]!.jogadores).toHaveLength(2);
    expect(minhas[0]!.jogadores.filter((j) => j.contaId === null)).toHaveLength(1);
  });

  it('mesa sem conta nenhuma passa pelo gancho e não grava', async () => {
    const gravacoes: Promise<unknown>[] = [];
    const comHistorico = createHub({
      persistence: createPersistence({ store: createMemoryStore() }),
      now: () => agora,
      randomSeed: () => randomBytes(16).toString('hex'),
      onFimDePartida: (room, estado) => {
        const registro = registroDaPartida(room, estado, agora);
        if (registro) gravacoes.push(dados.partidas.gravar(registro));
      },
    });

    const { room, estado } = partidaCompleta([null, null]);
    comHistorico.commit({ ok: true, room: { ...room, match: estado }, emissions: [] });

    // O gancho rodou e montou o registro; quem recusou foi o repositório.
    expect(gravacoes).toHaveLength(1);
    expect(await gravacoes[0]).toBeNull();
  });
});
