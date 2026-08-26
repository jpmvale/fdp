import { CLOSE_CODES, PROTOCOL_VERSION, shouldReconnect, type Command } from '@fdp/protocol';

/**
 * Camada de rede: um WebSocket que se reconecta sozinho quando faz sentido.
 *
 * Reconectar É o resync — não existe caminho separado para recuperar partida.
 * Mas nem todo fechamento pede insistência: `shouldReconnect` distingue queda
 * de rede de RESPOSTA do servidor. Martelar o servidor depois de "sessão
 * assumida em outra aba" é o cliente brigando com uma decisão já tomada.
 */

export type EstadoConexao =
  | 'CONECTANDO'
  | 'CONECTADO'
  | 'RECONECTANDO'
  | 'SESSAO_ASSUMIDA'
  | 'ENCERRADA'
  /** O servidor fala outra versão do protocolo: recarregar é obrigatório. */
  | 'DESATUALIZADO';

export interface Ouvintes {
  aoReceber(mensagem: { type: string; payload: unknown }): void;
  aoMudarEstado(estado: EstadoConexao, detalhe?: string): void;
}

export interface Conexao {
  enviar<T extends Command['type']>(tipo: T, payload?: unknown): void;
  fechar(): void;
}

export function conectar(wsUrl: string, token: string, ouvintes: Ouvintes): Conexao {
  let ws: WebSocket | null = null;
  let vivo = true;
  let tentativa = 0;

  const abrir = () => {
    if (!vivo) return;
    ouvintes.aoMudarEstado(tentativa === 0 ? 'CONECTANDO' : 'RECONECTANDO');
    ws = new WebSocket(`${wsUrl}?token=${encodeURIComponent(token)}`);

    ws.onopen = () => {
      tentativa = 0;
      ouvintes.aoMudarEstado('CONECTADO');
    };

    ws.onmessage = (e) => {
      try {
        ouvintes.aoReceber(JSON.parse(String(e.data)));
      } catch {
        // Quadro ilegível é do servidor, não do jogador: ignorar é melhor que
        // derrubar a tela inteira por causa de um.
      }
    };

    ws.onclose = (e) => {
      if (!vivo) return;
      if (e.code === CLOSE_CODES.SESSION_TAKEN) {
        vivo = false;
        ouvintes.aoMudarEstado('SESSAO_ASSUMIDA');
        return;
      }
      if (!shouldReconnect(e.code)) {
        vivo = false;
        ouvintes.aoMudarEstado('ENCERRADA', String(e.code));
        return;
      }
      // Backoff com teto: a reconexão precisa caber dentro de
      // TRANSPORT_GRACE (10 s) para a mesa nem chegar a pausar.
      const espera = Math.min(400 * 2 ** tentativa, 4000);
      tentativa += 1;
      ouvintes.aoMudarEstado('RECONECTANDO');
      setTimeout(abrir, espera);
    };
  };

  abrir();

  return {
    enviar(tipo, payload = {}) {
      if (ws?.readyState !== WebSocket.OPEN) return;
      // `PROTOCOL_VERSION`, e NUNCA um número escrito à mão.
      //
      // Aqui estava `v: 1`, desde o dia em que o cliente nasceu. Quando o
      // protocolo virou 2, o servidor passou a recusar TODO comando deste
      // cliente com `PROTOCOL_VERSION` — sentar bot, começar partida, apostar,
      // jogar carta, falar no chat. A tela continuava carregando, a sala
      // continuava sendo criada por HTTP, e o único sinal era um "Não deu
      // certo. Tente de novo." vermelho, porque `PROTOCOL_VERSION` nem estava
      // traduzido. O jogo ficou inteiro fora do ar parecendo um erro qualquer.
      //
      // A constante é a mesma que o servidor valida, do mesmo módulo. As duas
      // pontas não têm mais como discordar.
      ws.send(JSON.stringify({
        v: PROTOCOL_VERSION, id: crypto.randomUUID(), type: tipo, ts: Date.now(), payload,
      }));
    },
    fechar() {
      vivo = false;
      ws?.close();
    },
  };
}
