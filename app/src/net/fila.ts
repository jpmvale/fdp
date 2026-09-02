import { PROTOCOL_VERSION, type Avatar, type ModoDeFila } from '@fdp/protocol';

/**
 * O socket da fila (plano 03 §5.1).
 *
 * **NÃO se reconecta sozinho**, ao contrário do socket de sala — e a diferença
 * é o ponto. Lá, reconectar É o resync: a partida continua existindo do outro
 * lado e voltar para ela é sempre certo. Aqui não há nada do outro lado: a fila
 * é o socket, então uma reconexão silenciosa poria a pessoa de volta no fim da
 * fila sem ela saber, e ela ficaria olhando um contador que recomeçou.
 *
 * Quando a conexão cai, a tela diz que caiu e oferece o botão. Perder o lugar
 * na fila é uma informação, não um detalhe de transporte.
 */

export interface EstadoDaFila {
  modo: ModoDeFila;
  naFila: number;
  desde: number;
  /** Quando a mesa se forma, se a janela já abriu. `null` = ainda esperando. */
  janelaAte: number | null;
}

export interface Pareamento {
  modo: ModoDeFila;
  roomCode: string;
  playerId: string;
  sessionToken: string;
}

export interface OuvintesDaFila {
  aoEsperar(estado: EstadoDaFila): void;
  aoParear(p: Pareamento): void;
  /** Recusa do servidor: sem conta na ranqueada, apelido faltando, etc. */
  aoRecusar(motivo: string): void;
  /** O socket caiu sem parear. Quem chama decide o que dizer. */
  aoCair(): void;
}

export interface NaFila {
  sair(): void;
}

export function entrarNaFila(
  modo: ModoDeFila,
  identidade: { nickname?: string | undefined; avatar?: Avatar | undefined },
  ouvintes: OuvintesDaFila,
): NaFila {
  const url = new URL('/api/fila/ws', location.href);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';

  const ws = new WebSocket(url.toString());
  let pareou = false;
  let saindo = false;

  ws.onopen = () => {
    ws.send(JSON.stringify({
      v: PROTOCOL_VERSION,
      id: Math.random().toString(36).slice(2),
      type: 'fila:entrar',
      ts: Date.now(),
      payload: { modo, ...identidade },
    }));
  };

  ws.onmessage = (e) => {
    let quadro: { type?: string; payload?: unknown };
    try {
      quadro = JSON.parse(String(e.data)) as { type?: string; payload?: unknown };
    } catch {
      return;
    }

    if (quadro.type === 'fila:espera') {
      ouvintes.aoEsperar(quadro.payload as EstadoDaFila);
    } else if (quadro.type === 'fila:pareado') {
      pareou = true;
      ouvintes.aoParear(quadro.payload as Pareamento);
    } else if (quadro.type === 'error') {
      const p = quadro.payload as { params?: { motivo?: string } };
      ouvintes.aoRecusar(p.params?.motivo ?? 'DESCONHECIDO');
    }
  };

  ws.onclose = () => {
    // Fechar depois de parear é o normal: o servidor fecha assim que manda a
    // sala, porque o socket da fila cumpriu o que tinha para cumprir.
    if (!pareou && !saindo) ouvintes.aoCair();
  };

  return {
    sair() {
      saindo = true;
      // Fechar já basta — a fila É o socket. O `fila:sair` é cortesia para o
      // servidor não esperar o `close` viajar, e nada depende dele chegar.
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          v: PROTOCOL_VERSION, id: Math.random().toString(36).slice(2),
          type: 'fila:sair', ts: Date.now(), payload: {},
        }));
      }
      ws.close();
    },
  };
}
