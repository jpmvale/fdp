/**
 * As rotas de conta (plano 01, F2).
 *
 * O teste mais importante deste arquivo é o que prova que **nada disto é
 * obrigatório**: sem banco, o jogo continua inteiro. É a invariante I-1, e ela
 * é fácil de quebrar sem perceber — basta alguém pôr uma checagem de conta no
 * caminho do `join` algum dia.
 */

import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { createMemoryStore } from '@fdp/store';
import { applyCommand, snapshotFor } from '@fdp/room';
import { criarDadosEmMemoria, type Dados } from '@fdp/contas';
import { createHub, type Hub } from '../src/hub.js';
import { createHttpApp } from '../src/http.js';
import { createPersistence } from '../src/persistence.js';
import { createSigner, type SessionSigner } from '../src/session.js';
import { COOKIE_SESSAO } from '../src/contas-http.js';

const SEGREDO = 'segredo-de-teste-com-32-caracteres!';
const CLIENT = fileURLToPath(new URL('../../app/build/', import.meta.url));

let hub: Hub;
let signer: SessionSigner;
let dados: Dados;
let app: ReturnType<typeof createHttpApp>;
let agora = 1_700_000_000_000;

const env = (ip = '203.0.113.1') =>
  ({ incoming: { socket: { remoteAddress: ip } } }) as never;

async function chamar(
  caminho: string,
  init?: { method?: string; body?: unknown; ip?: string; cookie?: string },
): Promise<Response> {
  const headers: Record<string, string> = {
    'content-type': 'application/json', host: 'fdp.test',
  };
  if (init?.cookie) headers['cookie'] = init.cookie;

  return app.fetch(new Request(`http://fdp.test${caminho}`, {
    method: init?.method ?? 'GET',
    headers,
    ...(init?.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  }), env(init?.ip));
}

const corpo = async (r: Response): Promise<Record<string, never>> =>
  (await r.json()) as Record<string, never>;

/** O cookie de sessão que a resposta mandou guardar. */
function cookieDe(r: Response): string {
  const set = r.headers.get('set-cookie') ?? '';
  const valor = set.split(';')[0] ?? '';
  return valor;
}

function montar(comBanco: boolean): void {
  hub = createHub({
    persistence: createPersistence({ store: createMemoryStore() }),
    now: () => agora,
    randomSeed: () => randomBytes(16).toString('hex'),
  });
  signer = createSigner(SEGREDO);
  dados = criarDadosEmMemoria({ agora: () => agora });
  app = createHttpApp({
    hub, signer, clientPath: CLIENT, now: () => agora,
    dados: comBanco ? dados : null,
    // Sem TLS no teste; com `Secure` o cookie não voltaria.
    cookieSeguro: false,
  });
}

const CADASTRO = { apelido: 'Ana', email: 'ana@exemplo.com', senha: 'umaSenhaBoaAqui' };

beforeEach(() => {
  agora = 1_700_000_000_000;
  montar(true);
});

describe('cadastro', () => {
  it('cria a conta, devolve o slug e já deixa a pessoa entrada', async () => {
    const r = await chamar('/api/contas', { method: 'POST', body: CADASTRO });
    expect(r.status).toBe(201);

    const b = await corpo(r);
    expect(b['conta']).toMatchObject({ slug: 'ana', apelido: 'Ana' });

    const cookie = r.headers.get('set-cookie') ?? '';
    expect(cookie).toContain(`${COOKIE_SESSAO}=`);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
  });

  /** O `id` interno é chave primária: num link ele entregaria volume e ordem. */
  it('nunca devolve o id interno da conta', async () => {
    const r = await chamar('/api/contas', { method: 'POST', body: CADASTRO });
    expect(JSON.stringify(await corpo(r))).not.toContain('"id"');
  });

  it('recusa senha curta, e-mail sem cara de e-mail e apelido inválido', async () => {
    const curta = await chamar('/api/contas', {
      method: 'POST', body: { ...CADASTRO, senha: 'Senha@123' } });
    expect(curta.status).toBe(400);
    expect(await corpo(curta)).toMatchObject({ code: 'SENHA_FRACA' });

    const email = await chamar('/api/contas', {
      method: 'POST', body: { ...CADASTRO, email: 'ana@exemplo' } });
    expect(email.status).toBe(400);

    const apelido = await chamar('/api/contas', {
      method: 'POST', body: { ...CADASTRO, apelido: 'x' } });
    expect(apelido.status).toBe(400);
  });

  it('e-mail em uso responde 409, com qualquer caixa', async () => {
    await chamar('/api/contas', { method: 'POST', body: CADASTRO });
    const r = await chamar('/api/contas', {
      method: 'POST', body: { ...CADASTRO, apelido: 'Outra', email: 'ANA@Exemplo.com' } });
    expect(r.status).toBe(409);
    expect(await corpo(r)).toMatchObject({ code: 'EMAIL_EM_USO' });
  });
});

describe('login e sessão', () => {
  it('entra com a senha certa e o cookie identifica em /api/eu', async () => {
    await chamar('/api/contas', { method: 'POST', body: CADASTRO });

    const login = await chamar('/api/sessao', {
      method: 'POST', body: { email: 'ana@exemplo.com', senha: CADASTRO.senha } });
    expect(login.status).toBe(200);

    const eu = await chamar('/api/eu', { cookie: cookieDe(login) });
    expect((await corpo(eu))['conta']).toMatchObject({ slug: 'ana' });
  });

  it('senha errada e e-mail desconhecido dão a MESMA resposta', async () => {
    await chamar('/api/contas', { method: 'POST', body: CADASTRO });

    const errada = await chamar('/api/sessao', {
      method: 'POST', body: { email: 'ana@exemplo.com', senha: 'outraSenhaAqui' } });
    const inexistente = await chamar('/api/sessao', {
      method: 'POST', body: { email: 'ninguem@exemplo.com', senha: 'outraSenhaAqui' } });

    // Mesmo status e mesmo código. "Usuário não encontrado" contra "senha
    // incorreta" entrega quem tem conta no site, e D-4 diz que ninguém deve
    // ser descobrível.
    expect(errada.status).toBe(401);
    expect(inexistente.status).toBe(401);
    expect(await corpo(errada)).toEqual(await corpo(inexistente));
  });

  it('visitante em /api/eu é `null`, não erro', async () => {
    const r = await chamar('/api/eu');
    expect(r.status).toBe(200);
    expect((await corpo(r))['conta']).toBeNull();
  });

  it('cookie forjado ou de outro segredo não entra', async () => {
    const outro = createSigner('y'.repeat(48));
    const forjado = `${COOKIE_SESSAO}=${outro.signConta('qualquer', 1, agora)}`;
    const r = await chamar('/api/eu', { cookie: forjado });
    expect((await corpo(r))['conta']).toBeNull();
  });

  /**
   * D-8: a época derruba tudo que foi emitido antes, sem tabela de sessões.
   * É o que faz a tomada de conta de §7 valer na hora.
   */
  it('época nova invalida o cookie antigo na hora', async () => {
    const cadastro = await chamar('/api/contas', { method: 'POST', body: CADASTRO });
    const cookie = cookieDe(cadastro);

    expect((await corpo(await chamar('/api/eu', { cookie })))['conta']).not.toBeNull();

    const conta = await dados.contas.porSlug('ana');
    await dados.contas.novaEpoca(conta!.id);

    expect((await corpo(await chamar('/api/eu', { cookie })))['conta']).toBeNull();
  });

  it('sair apaga o cookie, mas não derruba os outros aparelhos', async () => {
    const cadastro = await chamar('/api/contas', { method: 'POST', body: CADASTRO });
    const cookie = cookieDe(cadastro);

    const saida = await chamar('/api/sessao', { method: 'DELETE' });
    expect(saida.headers.get('set-cookie')).toContain('Max-Age=0');

    // O token em si continua válido: sair aqui não pode expulsar o celular.
    expect((await corpo(await chamar('/api/eu', { cookie })))['conta']).not.toBeNull();
  });

  it('o token de SALA não serve como cookie de conta', async () => {
    await chamar('/api/contas', { method: 'POST', body: CADASTRO });
    const sala = await chamar('/api/rooms', { method: 'POST', body: { nickname: 'Ana' } });
    const tokenDaSala = (await corpo(sala))['sessionToken'] as unknown as string;

    const r = await chamar('/api/eu', { cookie: `${COOKIE_SESSAO}=${tokenDaSala}` });
    expect((await corpo(r))['conta']).toBeNull();
  });
});

describe('perfil público (D-4)', () => {
  it('abre por slug e traz o resumo', async () => {
    await chamar('/api/contas', { method: 'POST', body: CADASTRO });
    const r = await chamar('/api/perfis/ana');

    expect(r.status).toBe(200);
    const b = await corpo(r);
    expect(b['conta']).toMatchObject({ slug: 'ana', apelido: 'Ana' });
    expect(b['resumo']).toEqual({ partidas: 0, vitorias: 0, notaMedia: null });
  });

  it('slug que não existe é 404, e o perfil não expõe e-mail', async () => {
    await chamar('/api/contas', { method: 'POST', body: CADASTRO });
    expect((await chamar('/api/perfis/ninguem')).status).toBe(404);

    const r = await chamar('/api/perfis/ana');
    expect(JSON.stringify(await corpo(r))).not.toContain('exemplo.com');
  });
});

describe('limite de tentativas', () => {
  it('força bruta esbarra no teto e recebe Retry-After', async () => {
    await chamar('/api/contas', { method: 'POST', body: CADASTRO });

    let ultima: Response | null = null;
    for (let i = 0; i < 25; i++) {
      ultima = await chamar('/api/sessao', {
        method: 'POST', body: { email: 'ana@exemplo.com', senha: 'chuteChuteChute' },
        ip: '198.51.100.9',
      });
    }
    expect(ultima!.status).toBe(429);
    expect(Number(ultima!.headers.get('retry-after'))).toBeGreaterThan(0);
  });

  it('o teto é por IP: outra pessoa não paga pela força bruta alheia', async () => {
    await chamar('/api/contas', { method: 'POST', body: CADASTRO });
    for (let i = 0; i < 25; i++) {
      await chamar('/api/sessao', {
        method: 'POST', body: { email: 'ana@exemplo.com', senha: 'chute' }, ip: '198.51.100.9' });
    }

    const outra = await chamar('/api/sessao', {
      method: 'POST', body: { email: 'ana@exemplo.com', senha: CADASTRO.senha },
      ip: '203.0.113.77' });
    expect(outra.status).toBe(200);
  });
});

/**
 * CA-372, e o teste que mais importa nesta leva.
 *
 * Conta é acréscimo, nunca pedágio (I-1). Sem banco nenhum, criar sala, entrar
 * e retomar sessão têm de funcionar exatamente como funcionavam antes de
 * contas existirem. Quebrar isto é fácil e silencioso — basta alguém pôr uma
 * checagem de conta no caminho do `join`.
 */
describe('CA-372: sem banco, o jogo continua inteiro', () => {
  beforeEach(() => { montar(false); });

  it('criar sala e entrar funcionam sem conta e sem banco', async () => {
    const sala = await chamar('/api/rooms', { method: 'POST', body: { nickname: 'Ana' } });
    expect(sala.status).toBe(201);
    const b = await corpo(sala);

    const entrada = await chamar(`/api/rooms/${b['roomCode']}/join`, {
      method: 'POST', body: { nickname: 'Beto' } });
    expect(entrada.status).toBe(200);

    const retomada = await chamar(`/api/rooms/${b['roomCode']}/session`, {
      method: 'POST', body: { sessionToken: b['sessionToken'] } });
    expect(retomada.status).toBe(200);
  });

  it('as rotas de conta dizem que estão indisponíveis, sem derrubar nada', async () => {
    const r = await chamar('/api/contas', { method: 'POST', body: CADASTRO });
    expect(r.status).toBe(503);
    expect(await corpo(r)).toMatchObject({ code: 'CONTAS_INDISPONIVEIS' });

    // E `/api/eu` segue respondendo, com visitante — a tela não precisa saber
    // se o banco existe para desenhar o estado de quem não tem conta.
    const eu = await chamar('/api/eu');
    expect(eu.status).toBe(200);
    expect((await corpo(eu))['conta']).toBeNull();
  });

  it('a saúde do servidor não depende do banco', async () => {
    const r = await chamar('/api/health');
    expect(r.status).toBe(200);
    expect((await corpo(r))['ok']).toBe(true);
  });
});

/**
 * Plano 01 §5.1 — quando duas CONTAS colidem na mesa.
 *
 * A unicidade dentro da sala já existia e é de `packages/room`. O que muda com
 * contas é que a identidade deixa de ser escolhida na porta e passa a vir
 * pronta: duas contas chamadas "João" colidem sem que ninguém tenha escolhido
 * colidir, e nenhuma das duas pode ceder.
 */
describe('§5.1: colisão de identidade entre contas', () => {
  const entrarComoConta = async (
    apelido: string, email: string,
  ): Promise<{ cookie: string; slug: string }> => {
    const r = await chamar('/api/contas', {
      method: 'POST', body: { apelido, email, senha: 'umaSenhaBoaAqui' } });
    const b = await corpo(r);
    return { cookie: cookieDe(r), slug: (b['conta'] as unknown as { slug: string }).slug };
  };

  it('quem entra logado leva a identidade da CONTA, não a do corpo do pedido', async () => {
    const ana = await entrarComoConta('Ana', 'ana@exemplo.com');

    const sala = await chamar('/api/rooms', {
      method: 'POST',
      // O corpo tenta dizer outro nome. A conta manda.
      body: { nickname: 'Impostora' },
      cookie: ana.cookie,
    });
    const codigo = (await corpo(sala))['roomCode'] as unknown as string;

    const room = hub.get(codigo)!;
    expect(room.players[0]!.nickname).toBe('Ana');
    expect(room.players[0]!.conta).toBe('ana');
  });

  it('convidado continua escolhendo o próprio apelido, e não tem conta', async () => {
    const sala = await chamar('/api/rooms', { method: 'POST', body: { nickname: 'Beto' } });
    const codigo = (await corpo(sala))['roomCode'] as unknown as string;

    const room = hub.get(codigo)!;
    expect(room.players[0]!.nickname).toBe('Beto');
    expect(room.players[0]!.conta).toBeNull();
  });

  /** CA-376: nenhuma das duas é barrada na porta (R-1). */
  it('CA-376: duas contas de mesmo apelido entram, a segunda desempatada', async () => {
    const primeira = await entrarComoConta('João', 'joao1@exemplo.com');
    const segunda = await entrarComoConta('João', 'joao2@exemplo.com');
    // Slugs diferentes: são duas contas distintas, e é o que D-11 permite.
    expect(primeira.slug).toBe('joao');
    expect(segunda.slug).toBe('joao-2');

    const sala = await chamar('/api/rooms', {
      method: 'POST', body: {}, cookie: primeira.cookie });
    const codigo = (await corpo(sala))['roomCode'] as unknown as string;

    const entrada = await chamar(`/api/rooms/${codigo}/join`, {
      method: 'POST', body: {}, cookie: segunda.cookie });
    expect(entrada.status).toBe(200);

    const room = hub.get(codigo)!;
    const nomes = room.players.map((p) => p.nickname);
    expect(nomes[0]).toBe('João');
    // Desempatada, e não recusada: barrar na porta seria atrito puro, e com
    // conta é pior — a pessoa não tem como ceder o próprio nome.
    expect(nomes[1]).not.toBe('João');
    expect(new Set(nomes).size).toBe(2);
    // As duas continuam apontando para a conta certa: o perfil não se perde
    // no desempate.
    expect(room.players.map((p) => p.conta)).toEqual(['joao', 'joao-2']);
  });

  /** CA-377: R-3 — o desempate é da MESA e não volta para a conta. */
  it('CA-377: o desempate da mesa não renomeia a conta', async () => {
    const primeira = await entrarComoConta('João', 'joao1@exemplo.com');
    const segunda = await entrarComoConta('João', 'joao2@exemplo.com');

    const sala = await chamar('/api/rooms', {
      method: 'POST', body: {}, cookie: primeira.cookie });
    const codigo = (await corpo(sala))['roomCode'] as unknown as string;
    await chamar(`/api/rooms/${codigo}/join`, {
      method: 'POST', body: {}, cookie: segunda.cookie });

    // A conta segue "João". Se o sufixo tivesse vazado para cá, a pessoa
    // passaria a se chamar assim em TODAS as salas, para sempre, por causa de
    // uma mesa de uma noite.
    const eu = await chamar('/api/eu', { cookie: segunda.cookie });
    expect((await corpo(eu))['conta']).toMatchObject({ apelido: 'João' });

    // E numa sala vazia ela volta a entrar como "João".
    const outra = await chamar('/api/rooms', {
      method: 'POST', body: {}, cookie: segunda.cookie });
    const outroCodigo = (await corpo(outra))['roomCode'] as unknown as string;
    expect(hub.get(outroCodigo)!.players[0]!.nickname).toBe('João');
  });

  /** CA-378: R-4 — o editor de perfil edita a CONTA, não o apelido da mesa. */
  it('CA-378: editar o perfil grava na conta, e o sufixo da mesa não entra junto', async () => {
    const ana = await entrarComoConta('Ana', 'ana@exemplo.com');

    const r = await chamar('/api/eu', {
      method: 'PATCH', cookie: ana.cookie,
      body: { apelido: 'Anastácia', avatar: { emoji: '🐙', color: 'teal' } },
    });
    expect(r.status).toBe(200);
    expect((await corpo(r))['conta']).toMatchObject({ apelido: 'Anastácia', slug: 'ana' });

    // O slug NÃO acompanha: é o endereço do perfil, e link que muda ao trocar
    // de apelido é link quebrado na conversa de outra pessoa.
    expect((await chamar('/api/perfis/ana')).status).toBe(200);
  });

  it('editar perfil sem sessão é 401, não cria conta nenhuma', async () => {
    const r = await chamar('/api/eu', {
      method: 'PATCH', body: { apelido: 'Qualquer', avatar: { emoji: '🦊', color: 'amber' } } });
    expect(r.status).toBe(401);
  });

  it('sessão revogada não senta à mesa — a época vale nos dois caminhos', async () => {
    const ana = await entrarComoConta('Ana', 'ana@exemplo.com');
    const conta = await dados.contas.porSlug('ana');
    await dados.contas.novaEpoca(conta!.id);

    // Cookie morto: entra como convidado, e não como Ana.
    const sala = await chamar('/api/rooms', {
      method: 'POST', body: { nickname: 'Visitante' }, cookie: ana.cookie });
    const codigo = (await corpo(sala))['roomCode'] as unknown as string;

    const room = hub.get(codigo)!;
    expect(room.players[0]!.conta).toBeNull();
    expect(room.players[0]!.nickname).toBe('Visitante');
  });
});


/** RNF-001: toda resposta de erro segue `{ code, params? }` — sem embrulho. */
describe('RNF-001: formato de erro', () => {
  it('as rotas de conta usam o mesmo formato das rotas de sala', async () => {
    const senhaFraca = await chamar('/api/contas', {
      method: 'POST', body: { ...CADASTRO, senha: 'curta' } });
    const salaInexistente = await chamar('/api/rooms/ZZZZZ/join', {
      method: 'POST', body: { nickname: 'Ana' } });

    for (const r of [senhaFraca, salaInexistente]) {
      const b = await corpo(r);
      expect(typeof b['code']).toBe('string');
      // Sem `{ error: { ... } }`: o cliente lê `code` do topo, e um segundo
      // formato faria metade das mensagens de erro chegarem vazias na tela.
      expect(b['error']).toBeUndefined();
    }
  });
});

/**
 * O gate da F2: uma pessoa COM conta e uma SEM jogam a mesma partida.
 *
 * Vale como teste e não como passeio de navegador porque o que precisa ser
 * garantido é estrutural: a conta acompanha o jogador pela partida inteira, o
 * convidado atravessa sem nunca ter uma, e o motor não fica sabendo da
 * diferença (I-2).
 */
describe('CA-372: conta e convidado na mesma mesa', () => {
  it('a partida começa, roda e termina com os dois, e a conta não some no caminho', async () => {
    const cadastro = await chamar('/api/contas', { method: 'POST', body: CADASTRO });
    const cookie = cookieDe(cadastro);

    const sala = await chamar('/api/rooms', { method: 'POST', body: {}, cookie });
    const codigo = (await corpo(sala))['roomCode'] as unknown as string;

    // Convidado: sem cookie nenhum, exatamente como quem abre o link.
    const entrada = await chamar(`/api/rooms/${codigo}/join`, {
      method: 'POST', body: { nickname: 'Beto' } });
    expect(entrada.status).toBe(200);

    const antes = hub.get(codigo)!;
    expect(antes.players.map((p) => p.conta)).toEqual(['ana', null]);

    // Começa a partida pelo caminho de verdade — o comando do host.
    const inicio = applyCommand(
      antes, antes.hostId!, { type: 'host:startMatch', payload: {} }, hub.ctx());
    expect(inicio.ok).toBe(true);
    if (!inicio.ok) return;
    hub.commit(inicio);

    const emPartida = hub.get(codigo)!;
    expect(emPartida.status).toBe('EM_PARTIDA');
    expect(emPartida.match).not.toBeNull();

    // A conta atravessa o começo da partida sem se perder.
    expect(emPartida.players.map((p) => p.conta)).toEqual(['ana', null]);

    /**
     * E o motor NÃO sabe o que é conta (I-2). Se algum dia `conta` vazar para
     * `MatchState`, este teste cai — que é exatamente o que se quer, porque
     * seria o começo de a regra de jogo depender de quem tem cadastro.
     */
    expect(JSON.stringify(emPartida.match)).not.toContain('ana');
    expect(JSON.stringify(emPartida.match)).not.toContain('conta');

    // O `playerOrder` do motor é de `playerId` opaco, e não de slug.
    const ordem = emPartida.match!.playerOrder;
    expect(ordem).toHaveLength(2);
    for (const id of ordem) {
      expect(emPartida.players.some((p) => p.id === id)).toBe(true);
      expect(id).not.toBe('ana');
    }
  });

  it('o convidado vê a conta do outro pelo slug, e nunca o id interno', async () => {
    const cadastro = await chamar('/api/contas', { method: 'POST', body: CADASTRO });
    const cookie = cookieDe(cadastro);
    const sala = await chamar('/api/rooms', { method: 'POST', body: {}, cookie });
    const codigo = (await corpo(sala))['roomCode'] as unknown as string;
    await chamar(`/api/rooms/${codigo}/join`, { method: 'POST', body: { nickname: 'Beto' } });

    const room = hub.get(codigo)!;
    const visao = snapshotFor(room, room.players[1]!.id);
    const serializado = JSON.stringify(visao);

    // O slug está lá — é por ele que a mesa abre o perfil de quem está sentado.
    expect(serializado).toContain('"conta":"ana"');
    // O id interno da conta, não.
    const conta = await dados.contas.porSlug('ana');
    expect(serializado).not.toContain(conta!.id);
    // E o e-mail muito menos.
    expect(serializado).not.toContain('exemplo.com');
  });
});
