/**
 * A fila com sockets de verdade (plano 03 §5). CA-423, CA-425, CA-426.
 *
 * O que se testa aqui, e não em `fila.test.ts`: que fechar o socket tira da
 * fila, que a mesa que nasce é uma mesa de fila mesmo, e que a ranqueada recusa
 * quem não tem conta. A DECISÃO de formar já é coberta pura.
 */

import { randomBytes } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { serve } from '@hono/node-server';
import WebSocket from 'ws';
import { LIMITS, PROTOCOL_VERSION } from '@fdp/protocol';
import { createMemoryStore } from '@fdp/store';
import { criarDadosEmMemoria, type Dados } from '@fdp/contas';
import { createHub, type Hub } from '../src/hub.js';
import { createHttpApp } from '../src/http.js';
import { createPersistence } from '../src/persistence.js';
import { createSigner } from '../src/session.js';
import { attachWebSocket } from '../src/ws.js';
import { BILHETES_POR_ENDERECO, criarFila, type FilaViva } from '../src/fila-viva.js';
import { JANELA_MS } from '../src/fila.js';

const SECRET = 'segredo-de-teste-com-32-caracteres!';
const CLIENT = fileURLToPath(new URL('../../app/index.html', import.meta.url));

interface Frame { type: string; payload: Record<string, unknown> }

interface Cliente {
  frames: Frame[];
  send(type: string, payload: unknown): void;
  esperar(type: string, ms?: number): Promise<Frame>;
  fechar(): void;
  readonly aberto: boolean;
}

let hub: Hub;
let fila: FilaViva;
let dados: Dados;
let server: ReturnType<typeof serve>;
let ws: { close(): void };
let base: string;
const abertos: Cliente[] = [];

async function conectar(cookie?: string): Promise<Cliente> {
  const socket = new WebSocket(`${base}/api/fila/ws`, cookie ? { headers: { cookie } } : {});
  const frames: Frame[] = [];
  socket.on('message', (d) => frames.push(JSON.parse(d.toString()) as Frame));
  await new Promise<void>((res, rej) => { socket.on('open', () => res()); socket.on('error', rej); });

  const cliente: Cliente = {
    frames,
    send(type, payload) {
      socket.send(JSON.stringify({
        v: PROTOCOL_VERSION, id: randomBytes(6).toString('hex'), type, ts: Date.now(), payload }));
    },
    async esperar(type, ms = 2000) {
      const fim = Date.now() + ms;
      for (;;) {
        const achado = frames.find((f) => f.type === type);
        if (achado) return achado;
        if (Date.now() > fim) {
          throw new Error(`não chegou "${type}"; chegaram: ${frames.map((f) => f.type).join(', ')}`);
        }
        await new Promise((r) => setTimeout(r, 10));
      }
    },
    fechar: () => socket.close(),
    get aberto() { return socket.readyState === socket.OPEN; },
  };
  abertos.push(cliente);
  return cliente;
}

/** Entra na fila normal com apelido, como quem entra por link (D-1). */
async function naFila(apelido: string, modo: 'NORMAL' | 'RANQUEADA' = 'NORMAL'): Promise<Cliente> {
  const c = await conectar();
  c.send('fila:entrar', { modo, nickname: apelido });
  return c;
}

/** Cria uma conta e devolve o cookie de sessão dela. */
async function contaCom(apelido: string, email: string): Promise<string> {
  const r = await fetch(`${base.replace('ws://', 'http://')}/api/contas`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ apelido, email, senha: 'senha-bem-comprida-1' }),
  });
  const set = r.headers.get('set-cookie') ?? '';
  return set.split(';')[0] ?? '';
}

beforeEach(async () => {
  hub = createHub({
    persistence: createPersistence({ store: createMemoryStore() }),
    randomSeed: () => randomBytes(16).toString('hex'),
  });
  dados = criarDadosEmMemoria();
  const signer = createSigner(SECRET);
  const app = createHttpApp({ hub, signer, clientPath: CLIENT, dados, cookieSeguro: false });

  server = serve({ fetch: app.fetch, port: 0 });
  await new Promise((r) => setTimeout(r, 20));
  base = `ws://127.0.0.1:${(server.address() as AddressInfo).port}`;
  fila = criarFila({ hub, signer });
  ws = attachWebSocket(server, { hub, signer, fila, dados });
});

afterEach(async () => {
  for (const c of abertos.splice(0)) c.fechar();
  ws.close();
  await new Promise<void>((r) => server.close(() => r()));
});

describe('CA-423: a fila é o socket', () => {
  it('entrar avisa quantos esperam, e o número sobe a cada um', async () => {
    const ana = await naFila('Ana');
    expect((await ana.esperar('fila:espera')).payload.naFila).toBe(1);

    await naFila('Beto');
    await new Promise((r) => setTimeout(r, 50));
    // O aviso vai a TODO mundo do modo: quem já esperava precisa ver a fila
    // andar, senão a tela parece travada.
    expect(ana.frames.filter((f) => f.type === 'fila:espera').at(-1)!.payload.naFila).toBe(2);
  });

  it('fechar o socket tira da fila — sem bilhete para expirar', async () => {
    const ana = await naFila('Ana');
    const beto = await naFila('Beto');
    await ana.esperar('fila:espera');

    beto.fechar();
    await new Promise((r) => setTimeout(r, 80));
    expect(fila.contagem().NORMAL).toBe(1);
    expect(ana.frames.filter((f) => f.type === 'fila:espera').at(-1)!.payload.naFila).toBe(1);
  });

  it('a mesa que se forma não contém socket fechado', async () => {
    const gente = [];
    for (const nome of ['Ana', 'Beto', 'Carla', 'Dario', 'Elis']) gente.push(await naFila(nome));
    await new Promise((r) => setTimeout(r, 50));

    // A Elis desiste antes de a janela vencer.
    gente[4]!.fechar();
    await new Promise((r) => setTimeout(r, 50));

    fila.avancar(Date.now());               // abre a janela
    fila.avancar(Date.now() + JANELA_MS);   // vence: forma

    const pareado = await gente[0]!.esperar('fila:pareado');
    const sala = hub.get(pareado.payload.roomCode as string)!;
    expect(sala.players).toHaveLength(4);
    expect(sala.players.map((p) => p.nickname).sort())
      .toEqual(['Ana', 'Beto', 'Carla', 'Dario']);
  });

  it('mandar fila:entrar duas vezes não fura a própria fila', async () => {
    const ana = await naFila('Ana');
    await ana.esperar('fila:espera');
    ana.send('fila:entrar', { modo: 'NORMAL', nickname: 'Ana' });
    const erro = await ana.esperar('error');
    expect(erro.payload.params).toEqual({ motivo: 'JA_ESTA_NA_FILA' });
    expect(fila.contagem().NORMAL).toBe(1);
  });

  it('CA-435: um endereço só não enche a fila', async () => {
    /**
     * A fila normal não exige conta (D-1), então o único freio é o endereço.
     * Sem teto, um script abre duzentos sockets e forma mesas de fantasmas que
     * viram bots no primeiro minuto: os jogadores de verdade ficam sem mesa e a
     * fila parece morta. Achado da auditoria de segurança.
     *
     * O teto é o tamanho de uma MESA — nunca atrapalha um grupo legítimo, e o
     * ataque precisa de ordem de grandeza.
     */
    const cheios = [];
    for (let i = 0; i < BILHETES_POR_ENDERECO; i++) {
      cheios.push(await naFila(`Bot${String(i)}`));
    }
    await new Promise((r) => setTimeout(r, 120));
    expect(fila.total).toBe(BILHETES_POR_ENDERECO);

    const aMais = await naFila('Excedente');
    const erro = await aMais.esperar('error');
    expect(erro.payload.params).toEqual({ motivo: 'ENDERECO_COM_BILHETES_DEMAIS' });
    expect(fila.total).toBe(BILHETES_POR_ENDERECO);

    // E sair libera a vaga: o teto é de bilhetes VIVOS, não de tentativas.
    cheios[0]!.fechar();
    await new Promise((r) => setTimeout(r, 120));
    const agora = await naFila('Depois');
    await agora.esperar('fila:espera');
    expect(fila.total).toBe(BILHETES_POR_ENDERECO);
  });

  it('CA-435: comando repetido em laço esbarra no teto do socket', async () => {
    const ana = await naFila('Ana');
    await ana.esperar('fila:espera');
    for (let i = 0; i < LIMITS.commandsPerWindow + 5; i++) ana.send('fila:sair', {});
    const erro = await ana.esperar('error');
    expect(erro.payload.code).toBe('RATE_LIMITED');
  });

  it('fila:sair tira sem fechar o socket', async () => {
    const ana = await naFila('Ana');
    await ana.esperar('fila:espera');
    ana.send('fila:sair', {});
    await new Promise((r) => setTimeout(r, 50));
    expect(fila.total).toBe(0);
    expect(ana.aberto).toBe(true);
  });
});

describe('CA-425: a mesa que nasce da fila', () => {
  async function formarMesa(): Promise<{ clientes: Cliente[]; code: string }> {
    const clientes = [];
    for (const nome of ['Ana', 'Beto', 'Carla', 'Dario']) clientes.push(await naFila(nome));
    await new Promise((r) => setTimeout(r, 50));
    fila.avancar(Date.now());
    fila.avancar(Date.now() + JANELA_MS);
    const pareado = await clientes[0]!.esperar('fila:pareado');
    return { clientes, code: pareado.payload.roomCode as string };
  }

  it('nasce EM PARTIDA, sem lobby e sem pronto', async () => {
    const { code } = await formarMesa();
    const sala = hub.get(code)!;
    expect(sala.status).toBe('EM_PARTIDA');
    expect(sala.origem).toBe('FILA');
    expect(sala.match).not.toBeNull();
  });

  it('CA-424: o host da mesa de fila não pode nada', async () => {
    const { code } = await formarMesa();
    const sala = hub.get(code)!;
    const { applyCommand } = await import('@fdp/room');
    const r = applyCommand(sala, sala.hostId!, {
      type: 'host:kick', payload: { playerId: sala.players[1]!.id } }, hub.ctx());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toBe('MESA_DE_FILA_NAO_TEM_HOST');
  });

  it('o socket da fila fecha ao parear: ninguém fica "na fila" jogando', async () => {
    const { clientes } = await formarMesa();
    await new Promise((r) => setTimeout(r, 50));
    expect(clientes.every((c) => !c.aberto)).toBe(true);
    expect(fila.total).toBe(0);
  });

  it('cada um recebe um token que abre a SUA sessão, e não a de outro', async () => {
    const { clientes, code } = await formarMesa();
    const ids = new Set<string>();
    for (const c of clientes) {
      const p = (await c.esperar('fila:pareado')).payload;
      expect(p.roomCode).toBe(code);
      ids.add(p.playerId as string);
    }
    expect(ids.size).toBe(4);
    expect(hub.get(code)!.players.map((p) => p.id).sort()).toEqual([...ids].sort());
  });
});

describe('CA-426: a ranqueada exige conta', () => {
  it('sem conta, a ranqueada é recusada — e a normal não', async () => {
    const anonimo = await conectar();
    anonimo.send('fila:entrar', { modo: 'RANQUEADA', nickname: 'Ana' });
    const erro = await anonimo.esperar('error');
    expect(erro.payload.params).toEqual({ motivo: 'RANQUEADA_EXIGE_CONTA' });
    expect(fila.total).toBe(0);

    anonimo.send('fila:entrar', { modo: 'NORMAL', nickname: 'Ana' });
    await anonimo.esperar('fila:espera');
    expect(fila.contagem().NORMAL).toBe(1);
  });

  it('com conta, entra — e leva o apelido da CONTA, não o do corpo', async () => {
    const cookie = await contaCom('Ana', 'ana@exemplo.com');
    const c = await conectar(cookie);
    // Manda um apelido diferente de propósito: logado, a identidade vem da
    // conta, senão daria para entrar na fila com um nome que não é o seu.
    c.send('fila:entrar', { modo: 'RANQUEADA', nickname: 'Falsa' });
    await c.esperar('fila:espera');
    expect(fila.contagem().RANQUEADA).toBe(1);

    const outros = [];
    for (const nome of ['Beto', 'Carla', 'Dario']) {
      const cookieN = await contaCom(nome, `${nome.toLowerCase()}@exemplo.com`);
      const cn = await conectar(cookieN);
      cn.send('fila:entrar', { modo: 'RANQUEADA' });
      outros.push(cn);
    }
    await new Promise((r) => setTimeout(r, 80));
    fila.avancar(Date.now());
    fila.avancar(Date.now() + JANELA_MS);

    const sala = hub.get((await c.esperar('fila:pareado')).payload.roomCode as string)!;
    expect(sala.origem).toBe('RANQUEADA');
    expect(sala.players.map((p) => p.nickname).sort()).toEqual(['Ana', 'Beto', 'Carla', 'Dario']);
    // A conta viaja para a mesa: é ela que faz a partida entrar no histórico.
    expect(sala.players.every((p) => p.conta !== null)).toBe(true);
  });

  it('as duas filas não se misturam', async () => {
    const cookie = await contaCom('Ana', 'ana@exemplo.com');
    const comConta = await conectar(cookie);
    comConta.send('fila:entrar', { modo: 'RANQUEADA' });
    for (const nome of ['Beto', 'Carla', 'Dario']) await naFila(nome);
    await new Promise((r) => setTimeout(r, 80));

    expect(fila.contagem()).toEqual({ NORMAL: 3, RANQUEADA: 1 });
    fila.avancar(Date.now());
    fila.avancar(Date.now() + JANELA_MS);
    // Três na normal e um na ranqueada: nenhuma mesa. Somar as duas daria
    // quatro, e é exatamente o que não pode acontecer.
    expect(hub.roomCount).toBe(0);
  });
});
