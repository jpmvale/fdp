/**
 * Bootstrap: Hono + ws + desligamento gracioso (`11` §6).
 *
 * Um processo, todas as conexões de uma sala na mesma memória (`11` §1). O
 * Redis é durabilidade, não fonte da verdade: a sala vive aqui e é gravada
 * atrás, para que um deploy não vire queda seca (RNF-061, RNF-065).
 */

import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { serve } from '@hono/node-server';
import { createMemoryStore, type RoomStore } from '@fdp/store';
import { createHub, CLOSE_CODES } from './hub.js';
import { createHttpApp } from './http.js';
import type { Dados } from '@fdp/contas';
import { configuracaoDoAmbiente } from './sso.js';
import { registrarFimDePartida } from './ranqueada.js';
import { criarFila, PASSO_DA_FILA_MS } from './fila-viva.js';
import { createPersistence } from './persistence.js';
import { createSigner } from './session.js';
import { attachWebSocket } from './ws.js';
import { comCache, criarDepositoEmDisco, sondarDeposito, type DepositoDeAvatares } from '@fdp/avatares';
import { configDoAmbiente as configDeR2, criarDepositoEmR2 } from '@fdp/avatares/r2';

/**
 * Onde os avatares vão ficar (plano 02).
 *
 * A ordem é R2, depois disco, depois nada — e "depois nada" é uma opção de
 * primeira classe: sem nenhuma variável, o jogo sobe inteiro e o envio de foto
 * responde 503. Nada do produto pode exigir infraestrutura para rodar na
 * máquina de alguém (I-1).
 *
 * O cache embrulha os dois. Com disco ele economiza pouco e não atrapalha; com
 * R2 ele é o que torna a coisa viável, porque cada assento na mesa pediria uma
 * chamada de rede cobrada a cada render (RNF-018).
 */
function escolherDeposito(): DepositoDeAvatares | undefined {
  const r2 = configDeR2(process.env);
  if (r2) {
    console.log(`avatares: R2, bucket ${r2.bucket}`);
    return comCache(criarDepositoEmR2(r2));
  }

  const dir = process.env['AVATARES_DIR'];
  if (dir) {
    console.log(`avatares: disco em ${dir}`);
    return comCache(criarDepositoEmDisco(dir));
  }

  // Dito em voz alta, e não em silêncio: um envio devolvendo 503 sem nenhuma
  // linha no log manda quem está investigando procurar no lugar errado.
  console.log('avatares: nenhum depósito configurado — o envio de foto responde 503');
  return undefined;
}

const PORT = Number(process.env.PORT ?? 3000);
const REDIS_URL = process.env.REDIS_URL;
const DATABASE_URL = process.env.DATABASE_URL;
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN;
const TRUST_PROXY = process.env.TRUST_PROXY === '1';
const VERSION = process.env.FDP_VERSION ?? 'dev';
const PRODUCTION = process.env.NODE_ENV === 'production';

/** Ritmo do relógio de sala (`03` §2.1) e da gravação write-behind. */
const TICK_MS = 250;
const PERSIST_MS = 1_000;

/**
 * Segredo de sessão. Em produção é obrigatório; em desenvolvimento aceita-se um
 * efêmero — mas efêmero de verdade, gerado a cada subida. Um segredo padrão
 * versionado seria pior que nenhum, porque pareceria configurado.
 */
function sessionSecret(): string {
  const configured = process.env.FDP_SESSION_SECRET;
  if (configured) return configured;
  if (PRODUCTION) {
    console.error('FDP_SESSION_SECRET é obrigatório em produção (RNF-075)');
    process.exit(1);
  }
  console.warn('FDP_SESSION_SECRET ausente: usando segredo efêmero de desenvolvimento.');
  console.warn('As sessões morrem a cada reinício do servidor.');
  return randomBytes(32).toString('hex');
}

async function main(): Promise<void> {
  const store: RoomStore<unknown> = REDIS_URL
    ? (await import('@fdp/store/redis')).createRedisStore({ url: REDIS_URL })
    : createMemoryStore();

  if (!REDIS_URL) {
    console.warn('REDIS_URL ausente: store em memória. As salas morrem com o processo.');
  }

  /**
   * Contas são OPCIONAIS (plano 01, I-1).
   *
   * Sem `DATABASE_URL` o jogo sobe inteiro e as rotas de conta respondem 503.
   * Não é degradação tolerada a contragosto: é o desenho. Conta é acréscimo,
   * nunca pedágio, e um banco fora do ar não pode tirar do ar um jogo que
   * funciona por link e sem cadastro.
   *
   * E se o banco estiver configurado mas não responder na subida, o servidor
   * sobe assim mesmo, sem contas — derrubar o jogo inteiro por causa da parte
   * opcional seria trocar uma falha pequena por uma grande.
   */
  let dados: Dados | null = null;
  if (DATABASE_URL) {
    try {
      dados = await (await import('@fdp/contas/postgres'))
        .criarDadosEmPostgres({ url: DATABASE_URL });
      console.log('contas: Postgres conectado');
    } catch (erro) {
      console.error('contas: Postgres INDISPONÍVEL, subindo sem contas:', erro);
    }
  } else {
    console.warn('DATABASE_URL ausente: sem contas. O jogo funciona normalmente.');
  }

  const persistence = createPersistence({
    store,
    // Falha de gravação não derruba partida: o estado vivo está na memória e a
    // próxima volta do ciclo tenta de novo. Perder durabilidade é ruim; perder
    // a partida em curso por causa disso seria pior.
    onError: (error) => console.error('falha ao persistir sala:', error),
  });

  const hub = createHub({
    persistence,
    randomSeed: () => randomBytes(16).toString('hex'), // RJ-144

    /**
     * O histórico (plano 01 §9). `void` deliberado: gravar é assíncrono e a
     * partida NÃO espera por isso (RF-071).
     *
     * Sem banco, nada acontece e ninguém percebe — que é o comportamento
     * certo. Histórico é registro, não jogo.
     */
    onFimDePartida: (room, estado) => {
      void registrarFimDePartida(dados, room, estado, Date.now());
    },
  });

  // RNF-061 / CA-046: as salas vivas voltam antes de aceitar conexão.
  const restored = await persistence.load();
  for (const room of restored) hub.adopt(room);
  if (restored.length > 0) console.log(`recarregadas ${restored.length} sala(s) do store`);

  // Um assinante só: em desenvolvimento o segredo é gerado na subida, e dois
  // assinantes seriam dois segredos — o token emitido no HTTP não validaria no
  // WebSocket, e o sintoma seria "não consigo conectar" sem causa aparente.
  const signer = createSigner(sessionSecret());

  const deposito = escolherDeposito();

  /**
   * A sonda de escrita, na subida (RNF-020).
   *
   * Não bloqueia: o servidor sobe e atende enquanto ela roda, porque jogar não
   * depende de foto (I-1). O que ela produz é uma LINHA NO LOG — e essa linha
   * é a diferença entre descobrir um volume sem permissão agora ou daqui a
   * semanas, pelo relato de alguém que achou que o problema era a foto dele.
   */
  if (deposito) {
    void sondarDeposito(deposito).then((r) => {
      if (r.ok) {
        console.log('avatares: o depósito aceita gravar');
        return;
      }
      console.error(
        `avatares: O DEPÓSITO NÃO ACEITA ${r.etapa.toUpperCase()} — o envio de foto vai falhar.\n` +
        `  ${r.erro}\n` +
        '  Em produção isto costuma ser o volume montado como root com o processo\n' +
        '  rodando como `node`. Ver "Avatares" no HANDOFF.',
      );
    });
  }

  const app = createHttpApp({
    hub,
    signer,
    clientPath: fileURLToPath(new URL('../../app/build/', import.meta.url)),
    allowedOrigin: ALLOWED_ORIGIN,
    trustProxy: TRUST_PROXY,
    version: VERSION,
    dados,
    // Só a suíte E2E define isto. Ver `createLimit` em `http.ts`.
    ...(process.env.LIMITE_SALAS_POR_HORA
      ? { limiteDeSalasPorHora: Number(process.env.LIMITE_SALAS_POR_HORA) }
      : {}),
    sso: configuracaoDoAmbiente(process.env),
    // Sem depósito, o envio de avatar responde 503 e o resto funciona —
    // mesma lógica das contas e do SSO (I-1).
    ...(deposito ? { depositoDeAvatares: deposito } : {}),
  });

  const server = serve({ fetch: app.fetch, port: PORT }, (info) => {
    console.log(`FDP em http://localhost:${info.port}`);
  });

  /**
   * A fila (plano 03).
   *
   * Sobe sempre, com ou sem banco: a fila NORMAL não exige conta (D-1), e é a
   * ranqueada que responde "exige conta" quando não há de onde ler elo. Um jogo
   * que perde a fila casual porque o Postgres caiu seria o oposto de I-1.
   */
  const fila = criarFila({ hub, signer });

  const ws = attachWebSocket(server, {
    hub,
    signer,
    fila,
    dados,
    allowedOrigin: ALLOWED_ORIGIN,
    onSuspicion: (event) =>
      console.warn(`suspeita ${event.code} sala=${event.roomCode} jogador=${event.playerId}`),
  });

  const clock = setInterval(() => hub.advance(Date.now()), TICK_MS);
  const pareador = setInterval(() => fila.avancar(Date.now()), PASSO_DA_FILA_MS);
  const writer = setInterval(() => void persistence.flush(), PERSIST_MS);

  /**
   * RNF-065. A ordem importa: fechar os sockets primeiro faz cada cliente
   * começar a reconectar dentro de `TRANSPORT_GRACE`, e a janela de deploy cabe
   * nela sem que a mesa pause. Gravar antes de sair é o que faz a sala voltar
   * do mesmo `stateVersion` (CA-046).
   */
  let leaving = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (leaving) return;
    leaving = true;
    console.log(`${signal}: fechando sockets e persistindo salas`);

    clearInterval(clock);
    clearInterval(pareador);
    clearInterval(writer);
    hub.closeAll(CLOSE_CODES.SERVER_RESTART);
    ws.close();

    await persistence.flush();
    await store.close().catch(() => {});
    server.close(() => process.exit(0));

    // Rede pendurada não pode segurar um deploy indefinidamente.
    setTimeout(() => process.exit(0), 5_000).unref();
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

void main();
