/**
 * CA-431 — o gate da F4 do plano 03, executado.
 *
 * *"Uma partida ranqueada completa, com um abandono, do socket da fila até o
 * número mudando nos dois perfis."*
 *
 * Existe porque as duas metades estavam testadas e a **emenda** não: a fila
 * formava mesa em `fila-ws.test.ts`, o elo era aplicado sobre uma `Partida`
 * fabricada em `ranqueada.test.ts`, e o caminho entre os dois — partida de fila
 * terminando de verdade, `historico.ts` montando o registro com
 * `origem: 'RANQUEADA'`, `gravar` devolvendo, `aplicarElo` escrevendo, o perfil
 * mostrando — nunca tinha rodado inteiro. É exatamente o tipo de vão onde
 * nasceram os dois piores defeitos deste projeto.
 *
 * A partida é jogada de verdade, movimento a movimento, pelo mesmo
 * `applyCommand` que um socket usaria. Não é auto-play: auto-play custaria 45 s
 * de relógio simulado por aposta, e uma partida inteira estouraria o TTL da
 * sala antes de terminar — o teste passaria a medir o TTL, não o elo.
 */

import { randomBytes } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { serve } from '@hono/node-server';
import WebSocket from 'ws';
import { ELO_INICIAL, PROTOCOL_VERSION } from '@fdp/protocol';
import { applyCommand, leave, type Room } from '@fdp/room';
import { autoMove } from '@fdp/rules';
import { createMemoryStore } from '@fdp/store';
import { criarDadosEmMemoria, type Dados } from '@fdp/contas';
import { createHub, type Hub } from '../src/hub.js';
import { createHttpApp } from '../src/http.js';
import { createPersistence } from '../src/persistence.js';
import { createSigner } from '../src/session.js';
import { attachWebSocket } from '../src/ws.js';
import { criarFila, type FilaViva } from '../src/fila-viva.js';
import { JANELA_MS } from '../src/fila.js';
import { registrarFimDePartida } from '../src/ranqueada.js';
import { PUNICAO_ABANDONO } from '../src/elo.js';

const SECRET = 'segredo-de-teste-com-32-caracteres!';
const CLIENT = fileURLToPath(new URL('../../app/index.html', import.meta.url));

let hub: Hub;
let fila: FilaViva;
let dados: Dados;
let server: ReturnType<typeof serve>;
let ws: { close(): void };
let base: string;
let http: string;
/** Fica pendente enquanto a gravação do fim de partida não termina. */
let registrando: Promise<void>;
const sockets: WebSocket[] = [];

beforeEach(async () => {
  dados = criarDadosEmMemoria();
  registrando = Promise.resolve();

  hub = createHub({
    persistence: createPersistence({ store: createMemoryStore() }),
    randomSeed: () => randomBytes(16).toString('hex'),
    // A MESMA fiação do `main.ts`, e não uma cópia dela: é a emenda que está
    // sob teste. Guardar a promessa é o único acréscimo — em produção ninguém
    // espera por ela (RF-071), e aqui é preciso saber quando acabou.
    onFimDePartida: (room, estado) => {
      registrando = registrando.then(() =>
        registrarFimDePartida(dados, room, estado, 2_000_000));
    },
  });

  const signer = createSigner(SECRET);
  const app = createHttpApp({ hub, signer, clientPath: CLIENT, dados, cookieSeguro: false });
  server = serve({ fetch: app.fetch, port: 0 });
  await new Promise((r) => setTimeout(r, 20));
  const porta = (server.address() as AddressInfo).port;
  base = `ws://127.0.0.1:${porta}`;
  http = `http://127.0.0.1:${porta}`;
  fila = criarFila({ hub, signer });
  ws = attachWebSocket(server, { hub, signer, fila, dados });
});

afterEach(async () => {
  for (const s of sockets.splice(0)) s.close();
  ws.close();
  await new Promise<void>((r) => server.close(() => r()));
});

async function criarConta(apelido: string): Promise<{ cookie: string; slug: string }> {
  const r = await fetch(`${http}/api/contas`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      apelido, email: `${apelido.toLowerCase()}@exemplo.com`, senha: 'senha-bem-comprida-1',
    }),
  });
  const corpo = (await r.json()) as { conta: { slug: string } };
  return { cookie: (r.headers.get('set-cookie') ?? '').split(';')[0] ?? '', slug: corpo.conta.slug };
}

/** Entra na fila ranqueada e devolve o `fila:pareado` quando ele chegar. */
async function entrarNaRanqueada(cookie: string): Promise<{ pareado: Promise<Record<string, string>> }> {
  const socket = new WebSocket(`${base}/api/fila/ws`, { headers: { cookie } });
  sockets.push(socket);
  await new Promise<void>((res, rej) => { socket.on('open', () => res()); socket.on('error', rej); });

  const pareado = new Promise<Record<string, string>>((res) => {
    socket.on('message', (d) => {
      const q = JSON.parse(d.toString()) as { type: string; payload: Record<string, string> };
      if (q.type === 'fila:pareado') res(q.payload);
    });
  });

  socket.send(JSON.stringify({
    v: PROTOCOL_VERSION, id: randomBytes(6).toString('hex'),
    type: 'fila:entrar', ts: Date.now(), payload: { modo: 'RANQUEADA' },
  }));
  return { pareado };
}

async function perfil(slug: string): Promise<{
  elo: { pontos: number; faixa: string; partidas: number } | null;
  partidas: { eloDelta: number | null; abandonou: boolean; ranqueada: boolean; colocacao: number | null }[];
}> {
  const r = await fetch(`${http}/api/perfis/${slug}`);
  return (await r.json()) as never;
}

/**
 * Joga a partida até o fim, pelo mesmo caminho de um socket.
 *
 * Nas fases automáticas — recolhimento, revelação, resolução — não há jogador
 * na vez, e quem as move é o relógio. Aí sim o tempo anda, e pouco: a pausa de
 * legibilidade de uma vaza é de menos de dois segundos.
 */
function jogarAteOFim(code: string): Room {
  let relogio = 1_000_000;
  for (let passo = 0; passo < 20_000; passo++) {
    const sala = hub.get(code);
    if (!sala?.match || sala.match.endReason !== null) return sala!;

    const daVez = sala.match.round.activePlayerId;
    if (daVez === null) {
      relogio += 5_000;
      hub.advance(relogio);
      continue;
    }

    const jogada = autoMove(sala.match);
    const comando = jogada.type === 'bet'
      ? {
          type: 'move:bet' as const,
          payload: {
            matchId: sala.match.id, roundNumber: jogada.roundNumber,
            trickNumber: jogada.trickNumber, bet: jogada.bet,
          },
        }
      : {
          type: 'move:playCard' as const,
          payload: {
            matchId: sala.match.id, roundNumber: jogada.roundNumber,
            trickNumber: jogada.trickNumber, cardId: jogada.cardId,
          },
        };

    hub.commit(applyCommand(sala, daVez, comando, { ...hub.ctx(), now: relogio }));
  }
  throw new Error('a partida não terminou em 20.000 passos');
}

describe('CA-431: o gate da F4 — uma ranqueada inteira, da fila ao perfil', () => {
  it('quatro contas entram na fila, jogam, uma abandona, e o elo muda nos perfis', async () => {
    const contas = [];
    for (const nome of ['Ana', 'Beto', 'Carla', 'Dario']) contas.push(await criarConta(nome));

    // Ninguém tem elo ainda: a seção nem aparece no perfil (RF-105).
    expect((await perfil(contas[0]!.slug)).elo).toBeNull();

    const entradas = [];
    for (const c of contas) entradas.push(await entrarNaRanqueada(c.cookie));
    await new Promise((r) => setTimeout(r, 80));

    fila.avancar(Date.now());                 // abre a janela aos quatro
    fila.avancar(Date.now() + JANELA_MS);     // vencida: forma a mesa

    const pareados = await Promise.all(entradas.map((e) => e.pareado));
    const code = pareados[0]!.roomCode!;
    expect(new Set(pareados.map((p) => p.roomCode)).size).toBe(1);

    const inicial = hub.get(code)!;
    expect(inicial.origem).toBe('RANQUEADA');
    expect(inicial.status).toBe('EM_PARTIDA');

    // O Dario desiste no meio da primeira rodada. Numa mesa de fila isso NÃO
    // anula a rodada (RF-102): o assento vira bot e a partida segue.
    const dario = pareados[3]!.playerId!;
    hub.commit(leave(inicial, dario, { ...hub.ctx(), now: 1_000_000 }));
    const depoisDaSaida = hub.get(code)!;
    expect(depoisDaSaida.players.find((p) => p.id === dario)!.abandonou).toBe(true);
    expect(depoisDaSaida.match!.roundNumber).toBe(inicial.match!.roundNumber);

    const fim = jogarAteOFim(code);
    expect(fim.match!.endReason).not.toBeNull();

    // A gravação é assíncrona e a partida não espera por ela (RF-071).
    await registrando;

    // --- o que o gate pede: o número mudando nos perfis --------------------

    const perfis = await Promise.all(contas.map((c) => perfil(c.slug)));

    for (const [i, p] of perfis.entries()) {
      expect(p.elo, contas[i]!.slug).not.toBeNull();
      expect(p.elo!.partidas, contas[i]!.slug).toBe(1);
      expect(p.partidas[0]!.ranqueada, contas[i]!.slug).toBe(true);
      expect(p.partidas[0]!.eloDelta, contas[i]!.slug).toBe(p.elo!.pontos - ELO_INICIAL);
    }

    // Quem abandonou levou o pior da mesa MAIS a punição — e é o único que
    // levou. Primeira ranqueada de todos, então K = 80.
    const doDario = perfis[3]!;
    expect(doDario.partidas[0]!.abandonou).toBe(true);
    expect(doDario.elo!.pontos).toBe(ELO_INICIAL - 80 - PUNICAO_ABANDONO);

    for (const p of perfis.slice(0, 3)) {
      expect(p.partidas[0]!.abandonou).toBe(false);
      expect(p.elo!.pontos).toBeGreaterThanOrEqual(ELO_INICIAL - 80);
    }

    // Alguém subiu e alguém desceu: um resultado em que ninguém se move seria
    // a conta rodando sobre uma mesa vazia sem ninguém perceber.
    expect(perfis.some((p) => p.elo!.pontos > ELO_INICIAL)).toBe(true);
    expect(perfis.some((p) => p.elo!.pontos < ELO_INICIAL)).toBe(true);

    /**
     * Ninguém LUCRA com o abandono alheio.
     *
     * Com um abandono a mesa deixa de ser soma zero, e é deliberado: a punição
     * é **destruída**, não redistribuída. Se os pontos do abandono caíssem no
     * colo dos que ficaram, a mesa passaria a ter motivo para torcer para
     * alguém sair — que é o incentivo exato que a punição existe para não criar.
     *
     * O que cada sobrevivente leva é o que a colocação dele daria de qualquer
     * jeito, e é isso que se verifica: o delta de cada um bate com a conta
     * feita sobre a mesa de quatro, sem correção nenhuma pela saída do Dario.
     */
    const naMesa = 4;
    for (const [i, p] of perfis.entries()) {
      if (p.partidas[0]!.abandonou) continue;
      const colocacao = p.partidas[0]!.colocacao!;
      const neutro = (naMesa + 1) / 2;
      const esperado = Math.round(80 * ((neutro - colocacao) / (neutro - 1)));
      expect(p.partidas[0]!.eloDelta, contas[i]!.slug).toBe(esperado);
    }
  });

  it('a mesma partida numa fila NORMAL não mexe em elo nenhum', async () => {
    // O contraste é o que prova que a origem está sendo lida: a única
    // diferença entre este caso e o de cima é o modo da fila.
    const contas = [];
    for (const nome of ['Ana', 'Beto', 'Carla', 'Dario']) contas.push(await criarConta(nome));

    const entradas: Promise<Record<string, string>>[] = [];
    for (const c of contas) {
      const socket = new WebSocket(`${base}/api/fila/ws`, { headers: { cookie: c.cookie } });
      sockets.push(socket);
      await new Promise<void>((res) => socket.on('open', () => res()));
      entradas.push(new Promise((res) => socket.on('message', (d) => {
        const q = JSON.parse(d.toString()) as { type: string; payload: Record<string, string> };
        if (q.type === 'fila:pareado') res(q.payload);
      })));
      socket.send(JSON.stringify({
        v: PROTOCOL_VERSION, id: randomBytes(6).toString('hex'),
        type: 'fila:entrar', ts: Date.now(), payload: { modo: 'NORMAL' },
      }));
    }
    await new Promise((r) => setTimeout(r, 80));
    fila.avancar(Date.now());
    fila.avancar(Date.now() + JANELA_MS);

    const code = (await entradas[0]!).roomCode!;
    expect(hub.get(code)!.origem).toBe('FILA');

    jogarAteOFim(code);
    await registrando;

    const p = await perfil(contas[0]!.slug);
    // A partida entra no histórico — todos têm conta —, mas sem elo nenhum.
    expect(p.partidas).toHaveLength(1);
    expect(p.partidas[0]!.ranqueada).toBe(false);
    expect(p.partidas[0]!.eloDelta).toBeNull();
    expect(p.elo).toBeNull();
  });
});
