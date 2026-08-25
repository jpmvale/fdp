/**
 * Reconciliação e resync (`05` §3).
 *
 * O cliente guarda a última `stateVersion` aplicada e decide, para cada evento,
 * entre aplicar, descartar e pedir o estado inteiro. É esse mecanismo — e só
 * ele — que torna a reconexão trivial (RF-010): reconectar **é** um resync, e
 * não existe caminho de código separado para "recuperar partida".
 *
 * ## Por que a regra não é literalmente a da tabela de `05` §3
 *
 * A tabela pressupõe um evento por versão. A camada de sala não garante isso:
 * um `commit` incrementa `stateVersion` **uma vez** e pode emitir vários
 * eventos, todos carregando a mesma versão — `host:startMatch` sozinho produz
 * `room:statusChanged`, `match:started`, `round:started` e `round:phaseChanged`
 * numa tacada. Aplicar `stateVersion <= local → descartar` ao pé da letra
 * jogaria fora todos menos o primeiro, e a mesa ficaria sem cartas.
 *
 * Então o que se descarta é `< local`, e `== local` é entendido como
 * continuação do mesmo lote. Perde-se a deduplicação de um evento repetido
 * byte a byte — que o WebSocket sobre TCP não produz, e que o servidor não
 * emite. Preserva-se o que a regra existe para garantir: **buraco de versão
 * vira resync**, nunca estado divergente em silêncio.
 */

/** Eventos de resposta a comando: não carregam avanço de estado. */
const CONTROL_EVENTS = new Set(['ack', 'error']);

export type Reconciliation =
  /** Em sequência (ou no mesmo lote): aplique. */
  | { action: 'APPLY'; version: number }
  /** Já passou: é eco de um estado anterior. */
  | { action: 'DISCARD'; reason: 'STALE' }
  /** Resposta a comando: não mexe na versão local. */
  | { action: 'DISCARD'; reason: 'CONTROL' }
  /** Buraco: faltou pelo menos um lote no caminho. */
  | { action: 'RESYNC'; missing: number };

export interface ServerFrame {
  type: string;
  stateVersion: number;
}

export interface Reconciler {
  /** Última versão aplicada. `0` antes do primeiro snapshot. */
  readonly version: number;
  /** Aguardando o snapshot que fecha um buraco já detectado. */
  readonly resyncing: boolean;
  /**
   * Decide o destino de um quadro do servidor.
   *
   * Chamar **é** aplicar: a versão local avança quando a decisão é `APPLY`, e
   * o chamador só precisa executar o efeito.
   */
  receive(frame: ServerFrame): Reconciliation;
  /** Socket novo: o estado local não vale mais nada até o próximo snapshot. */
  reset(): void;
}

export function createReconciler(): Reconciler {
  let version = 0;
  let resyncing = false;

  return {
    get version() {
      return version;
    },
    get resyncing() {
      return resyncing;
    },

    receive(frame) {
      if (CONTROL_EVENTS.has(frame.type)) return { action: 'DISCARD', reason: 'CONTROL' };

      // O snapshot **é** a verdade: adota-se inteiro, venha de onde vier. É o
      // que fecha qualquer buraco sem caminho de recuperação separado.
      if (frame.type === 'room:snapshot') {
        version = frame.stateVersion;
        resyncing = false;
        return { action: 'APPLY', version };
      }

      // Enquanto o snapshot pedido não chega, tudo que vem é estado de antes
      // do buraco. Aplicar seria construir sobre uma base que já se sabe furada.
      if (resyncing) return { action: 'DISCARD', reason: 'STALE' };

      if (frame.stateVersion < version) return { action: 'DISCARD', reason: 'STALE' };

      if (frame.stateVersion > version + 1) {
        resyncing = true;
        return { action: 'RESYNC', missing: frame.stateVersion - version - 1 };
      }

      version = frame.stateVersion;
      return { action: 'APPLY', version };
    },

    reset() {
      version = 0;
      resyncing = false;
    },
  };
}
