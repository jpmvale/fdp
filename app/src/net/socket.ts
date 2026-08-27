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
  let agendada: ReturnType<typeof setTimeout> | null = null;

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
      agendada = setTimeout(abrir, espera);
    };
  };

  /**
   * Voltar à tela reconecta AGORA, sem esperar o backoff.
   *
   * O celular congela a aba ao trocar de aplicativo, e congela o `setTimeout`
   * junto. Ao voltar, o relógio destrava e o cliente ficava esperando até 4 s
   * de um backoff que já não fazia sentido — 4 s a mais de mesa parada, depois
   * de o próprio tempo de fora já ter custado a pausa.
   *
   * `tentativa = 0` porque a espera acumulada era sobre um servidor que talvez
   * nunca tenha estado fora do ar: quem estava indisponível era esta aba.
   */
  const aoVoltarParaTela = () => {
    if (!vivo || typeof document === 'undefined' || document.visibilityState !== 'visible') return;
    // Avisa que voltou. Se o socket sobreviveu (Android costuma manter), este
    // é o único aviso que o servidor recebe — e é o que tira a mesa da pausa.
    if (ws?.readyState === WebSocket.OPEN) {
      enviar('player:background', { emSegundoPlano: false });
      return;
    }
    if (agendada !== null) { clearTimeout(agendada); agendada = null; }
    tentativa = 0;
    abrir();
  };

  /**
   * Avisa ANTES de sumir, enquanto o socket ainda existe (RJ-117b).
   *
   * É a única chance: depois que o sistema congela a aba, não há mais como
   * mandar nada. Por isso vai em `visibilitychange` e não em `pagehide` — o
   * primeiro dispara ao trocar de aplicativo, que é o caso comum; o segundo,
   * só ao fechar de verdade.
   *
   * É melhor-esforço, e o desenho conta com isso: se o aviso não sair a tempo,
   * a mesa pausa como antes. Errar para o lado de pausar é o lado seguro.
   */
  const aoSairDaTela = () => {
    if (!vivo || typeof document === 'undefined' || document.visibilityState !== 'hidden') return;
    if (ws?.readyState === WebSocket.OPEN) {
      enviar('player:background', { emSegundoPlano: true });
    }
  };

  const aoMudarVisibilidade = () => {
    if (document.visibilityState === 'visible') aoVoltarParaTela();
    else aoSairDaTela();
  };

  /**
   * Sem DOM, não há visibilidade a observar — e o módulo continua servindo.
   *
   * O teste roda em Node, onde `document` não existe; sem esta guarda, exigir
   * DOM aqui derrubava a suíte do socket inteira. Um cliente de rede não tem
   * por que depender de haver uma tela.
   */
  const temDom = typeof document !== 'undefined';
  if (temDom) document.addEventListener('visibilitychange', aoMudarVisibilidade);

  const enviar = (tipo: string, payload: unknown = {}): void => {
    if (ws?.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({
      v: PROTOCOL_VERSION, id: crypto.randomUUID(), type: tipo, ts: Date.now(), payload,
    }));
  };

  abrir();

  return {
    /**
     * `PROTOCOL_VERSION`, e NUNCA um número escrito à mão.
     *
     * Aqui estava `v: 1`, desde o dia em que o cliente nasceu. Quando o
     * protocolo virou 2, o servidor passou a recusar TODO comando deste
     * cliente com `PROTOCOL_VERSION` — sentar bot, começar partida, apostar,
     * jogar carta, falar no chat. A tela continuava carregando, a sala
     * continuava sendo criada por HTTP, e o único sinal era um "Não deu
     * certo. Tente de novo." vermelho, porque `PROTOCOL_VERSION` nem estava
     * traduzido. O jogo ficou inteiro fora do ar parecendo um erro qualquer.
     *
     * A constante é a mesma que o servidor valida, do mesmo módulo. As duas
     * pontas não têm mais como discordar. O envio em si mora em `enviar`, que
     * o aviso de segundo plano também usa — uma implementação, não duas.
     */
    enviar(tipo, payload = {}) {
      enviar(tipo, payload);
    },
    fechar() {
      vivo = false;
      if (temDom) document.removeEventListener('visibilitychange', aoMudarVisibilidade);
      if (agendada !== null) { clearTimeout(agendada); agendada = null; }
      ws?.close();
    },
  };
}
