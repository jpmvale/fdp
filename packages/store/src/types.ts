/**
 * `RoomStore` — a única superfície que conhece o provedor de estado (`11` §3).
 *
 * Seis métodos. Trocar de provedor precisa ser decisão de uma tarde, então
 * nada aqui pode vazar detalhe de Redis, de REST ou de conexão.
 */

/** Valor + versão. A versão é a base do compare-and-set de `11` §5. */
export interface Versioned<T> {
  value: T;
  /** Monotônica por chave, nunca reutilizada (INV-02). */
  version: number;
}

export type MutateOutcome<T> =
  | { ok: true; result: Versioned<T>; attempts: number }
  | { ok: false; reason: 'NOT_FOUND' }
  | { ok: false; reason: 'CONFLICT'; attempts: number }
  | { ok: false; reason: 'ABORTED' };

/** Devolver `ABORT` deixa o estado intacto — mutação que decide não mutar. */
export const ABORT = Symbol('abort');
export type Mutator<T> = (current: T) => T | typeof ABORT;

export interface PutOptions {
  ttlSeconds: number;
}

export interface MutateOptions extends PutOptions {
  /** Tentativas em caso de conflito de versão. `11` §5 usa 3. */
  maxAttempts?: number;
}

export type Unsubscribe = () => Promise<void>;
export type MessageHandler = (message: string) => void;

export interface RoomStore<T = unknown> {
  get(key: string): Promise<Versioned<T> | null>;

  /** Escreve incondicionalmente e devolve a nova versão. */
  put(key: string, value: T, options: PutOptions): Promise<Versioned<T>>;

  /**
   * Leitura → mutação → escrita condicional, atômica por chave.
   *
   * A escrita só vale se a versão não mudou desde a leitura; em conflito,
   * relê e tenta de novo. CAS é preferível a lock porque instância que morre
   * no meio da operação não deixa a sala travada — falha de instância é
   * rotina, não exceção.
   */
  mutate(key: string, mutator: Mutator<T>, options: MutateOptions): Promise<MutateOutcome<T>>;

  delete(key: string): Promise<void>;

  /** Fan-out entre instâncias de função (`11` §3.1). */
  publish(channel: string, message: string): Promise<void>;

  /** Assina um canal. O retorno cancela a assinatura. */
  subscribe(channel: string, handler: MessageHandler): Promise<Unsubscribe>;

  close(): Promise<void>;
}

/** Relógio injetável: TTL testável sem esperar tempo real (RNF-100). */
export type Clock = () => number;

export const roomKey = (code: string): string => `room:${code.toUpperCase()}`;
export const roomChannel = (code: string): string => `room:${code.toUpperCase()}:events`;
