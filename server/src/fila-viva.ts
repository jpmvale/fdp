/**
 * A fila com gente dentro: sockets, relógio e a mesa nascendo (plano 03 §5).
 *
 * A decisão de QUANDO formar não está aqui — está em `fila.ts`, pura. Aqui só
 * mora o que tem efeito colateral: guardar bilhete, avisar quem espera, criar a
 * sala e começar a partida.
 *
 * **Correção ao plano (D-4).** O plano dizia que os bilhetes viveriam no Redis.
 * Eles vivem no processo, e a razão apareceu implementando: um bilhete É um
 * socket aberto (I-3), e socket é do processo que o segura. Guardar o bilhete
 * no Redis daria a uma segunda instância a informação de que alguém espera, sem
 * lhe dar qualquer meio de avisar essa pessoa — seria estado compartilhado que
 * ninguém do outro lado consegue usar, e o lock de D-5 protegeria uma corrida
 * que não é a corrida real.
 *
 * O caminho para várias instâncias continua aberto e é o mesmo de sempre: esta
 * estrutura vira uma implementação de uma interface, a outra guarda bilhete no
 * Redis e avisa por pub/sub, e cada processo notifica os sockets que são seus.
 * O que não dá é fingir que metade disso já existe.
 */

import { randomBytes, randomUUID } from 'node:crypto';
import type { WebSocket } from 'ws';
import { PROTOCOL_VERSION } from '@fdp/protocol';
import { createRoom, generateFreeCode, join, startMatch } from '@fdp/room';
import {
  decidirFormacao,
  MODOS,
  type Bilhete,
  type ModoDeFila,
} from './fila.js';
import type { Hub } from './hub.js';
import type { SessionSigner } from './session.js';

/** De quanto em quanto tempo a fila é reavaliada. */
export const PASSO_DA_FILA_MS = 2_000;

export interface FilaViva {
  /** Põe alguém na fila. Devolve `false` se o bilhete já estava lá. */
  entrar(bilhete: Bilhete, socket: WebSocket): boolean;
  /** Tira da fila. Idempotente: sair de onde não se está não é erro. */
  sair(id: string): void;
  /** Um passo do relógio. Separado do timer para ser testável. */
  avancar(agora: number): void;
  /** Quantos esperam em cada modo, para a tela e para as métricas. */
  contagem(): Record<ModoDeFila, number>;
  readonly total: number;
}

export interface OpcoesDaFila {
  hub: Hub;
  signer: SessionSigner;
  now?: () => number;
}

interface NaFila {
  bilhete: Bilhete;
  socket: WebSocket;
}

export function criarFila({ hub, signer, now = Date.now }: OpcoesDaFila): FilaViva {
  const esperando = new Map<string, NaFila>();
  /** Quando a janela de cada modo vence. `null` = não há janela aberta. */
  const janelas = new Map<ModoDeFila, number | null>(MODOS.map((m) => [m, null]));

  const enviar = (socket: WebSocket, type: string, payload: unknown): void => {
    if (socket.readyState !== socket.OPEN) return;
    socket.send(JSON.stringify({
      v: PROTOCOL_VERSION, id: randomUUID(), ts: now(), stateVersion: 0, type, payload,
    }));
  };

  const doModo = (modo: ModoDeFila): Bilhete[] =>
    [...esperando.values()].filter((e) => e.bilhete.modo === modo).map((e) => e.bilhete);

  /** Diz a cada um quantos esperam com ele. Sem isto a fila parece travada. */
  const avisarEspera = (modo: ModoDeFila): void => {
    const quantos = doModo(modo).length;
    for (const { bilhete, socket } of esperando.values()) {
      if (bilhete.modo !== modo) continue;
      enviar(socket, 'fila:espera', {
        modo,
        naFila: quantos,
        desde: bilhete.entrouEm,
        janelaAte: janelas.get(modo) ?? null,
      });
    }
  };

  /**
   * A mesa nasce: sala criada, todo mundo sentado, partida começando.
   *
   * A partida começa AQUI, e não por comando: `host:startMatch` é recusado numa
   * mesa de fila (RF-101), e com razão — quem começa ali é o pareador, não um
   * dos jogadores. E não há lobby entre a fila e a mesa, de propósito: a
   * presença acabou de ser provada pelo socket, e uma tela a mais no meio é uma
   * tela a mais para perder gente (§5.3).
   */
  const formar = (modo: ModoDeFila, mesa: Bilhete[]): void => {
    const code = generateFreeCode(
      (n) => randomBytes(n),
      (candidato) => hub.get(candidato) !== undefined,
    );
    const ctx = hub.ctx();
    const origem = modo === 'RANQUEADA' ? 'RANQUEADA' : 'FILA';

    const [primeiro, ...resto] = mesa;
    if (!primeiro) return;

    let room = createRoom(code, paraEntrada(primeiro), ctx, origem);
    for (const b of resto) {
      const r = join(room, paraEntrada(b), ctx);
      // Recusa aqui é impossível pelo desenho (a mesa cabe, a sala é nova), mas
      // engolir o erro deixaria uma mesa a menos silenciosamente. Melhor
      // desistir desta formação e devolver todo mundo para a fila.
      if (!r.ok) return;
      room = r.room;
    }

    const comecada = startMatch(room, ctx);
    if (!comecada.ok) return;

    hub.adopt(comecada.room);

    for (const b of mesa) {
      const espera = esperando.get(b.id);
      esperando.delete(b.id);
      if (!espera) continue;
      enviar(espera.socket, 'fila:pareado', {
        modo,
        roomCode: code,
        playerId: b.id,
        sessionToken: signer.sign(b.id, code, ctx.now),
      });
      // O socket da fila cumpriu o que tinha para cumprir. Deixá-lo aberto
      // faria a pessoa continuar "na fila" enquanto joga.
      if (espera.socket.readyState === espera.socket.OPEN) espera.socket.close(1000, 'pareado');
    }

    janelas.set(modo, null);
    avisarEspera(modo);
  };

  const paraEntrada = (b: Bilhete) => ({
    playerId: b.id,
    nickname: b.apelido,
    avatar: b.avatar,
    conta: b.conta,
    contaId: b.contaId,
  });

  return {
    entrar(bilhete, socket) {
      if (esperando.has(bilhete.id)) return false;
      esperando.set(bilhete.id, { bilhete, socket });
      avisarEspera(bilhete.modo);
      return true;
    },

    sair(id) {
      const saindo = esperando.get(id);
      if (!saindo) return;
      esperando.delete(id);
      avisarEspera(saindo.bilhete.modo);
    },

    avancar(agora) {
      for (const modo of MODOS) {
        const decisao = decidirFormacao(doModo(modo), agora, janelas.get(modo) ?? null, modo);
        switch (decisao.tipo) {
          case 'ABRIR_JANELA':
            janelas.set(modo, decisao.ate);
            avisarEspera(modo);
            break;
          case 'FECHAR_JANELA':
            janelas.set(modo, null);
            avisarEspera(modo);
            break;
          case 'FORMAR':
            formar(modo, decisao.mesa);
            break;
          case 'ESPERAR':
            break;
        }
      }
    },

    contagem() {
      const fora = {} as Record<ModoDeFila, number>;
      for (const modo of MODOS) fora[modo] = doModo(modo).length;
      return fora;
    },

    get total() {
      return esperando.size;
    },
  };
}
