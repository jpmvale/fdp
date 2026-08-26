/**
 * Contrato cliente ↔ servidor (`05`). Fonte única de tipos (RNF-104).
 *
 * Este módulo é **só tipos e constantes**. Os schemas de runtime moram em
 * `@fdp/protocol/validate`, que puxa o zod. A separação é deliberada: o cliente
 * importa daqui e o validador nunca entra no bundle dele (RNF-055).
 */

import type { Card, CardId, MatchOptions, PlayerId, PublicTrick, RoundPhase } from '@fdp/rules';

/**
 * 2 desde 26/08/2026: `PublicPlayer` ganhou `conta` (plano 01, F2).
 *
 * Subir a versão faz o cliente velho receber `ERR-426` e pedir recarregar, em
 * vez de desenhar uma mesa com campo faltando. `validate.ts` confere e
 * `ws.ts` emite — o caminho já existia e tem teste de integração.
 */
export const PROTOCOL_VERSION = 2;

// ---------------------------------------------------------------------------
// Envelope (`05` §1)
// ---------------------------------------------------------------------------

export interface Envelope<T = unknown> {
  v: typeof PROTOCOL_VERSION;
  /** uuid do cliente; ecoado em ack/erro. Base da idempotência (RNF-013). */
  id: string;
  type: string;
  ts: number;
  payload: T;
}

export interface ServerEnvelope<T = unknown> extends Envelope<T> {
  /** Versão do estado da sala APÓS este evento. Base da reconciliação. */
  stateVersion: number;
}

// ---------------------------------------------------------------------------
// Identidade e sala (`04`, `06`)
// ---------------------------------------------------------------------------

export const AVATAR_EMOJIS = [
  '🦊', '🐙', '🐸', '🦁', '🐼', '🦉', '🐺', '🦝',
  '🐨', '🐯', '🦄', '🐢', '🦈', '🐝', '🦋', '🐌',
  '🦖', '🐳', '🦩', '🦔', '🐧', '🦜', '🐴', '🦥',
] as const;
export type AvatarEmoji = (typeof AVATAR_EMOJIS)[number];

/** Paleta fechada; distinguível sob deuteranopia e protanopia (`07` §4). */
export const AVATAR_COLORS = [
  'amber', 'teal', 'rose', 'indigo', 'lime', 'sky', 'orange', 'violet',
] as const;
export type AvatarColor = (typeof AVATAR_COLORS)[number];

export interface Avatar {
  emoji: AvatarEmoji;
  color: AvatarColor;
  /**
   * Imagem enviada pelo dono da conta (P11, F5). Caminho servido pelo próprio
   * app, endereçado por conteúdo: `/avatares/<sha256>.webp`.
   *
   * É um CAMPO A MAIS, e não uma união com o emoji. O plano 01 §10 desenhou
   * como união (`{tipo:'emoji'} | {tipo:'imagem'}`) e três coisas fizeram
   * mudar de ideia ao implementar:
   *
   * 1. União obrigaria migrar todo avatar já gravado — no Postgres, no Redis
   *    das salas vivas e no `localStorage` de quem já jogou.
   * 2. O emoji vira o que a tela mostra **enquanto a imagem carrega** e se ela
   *    falhar. Numa união, o avatar de imagem não teria fallback nenhum.
   * 3. **Fecha um buraco que o plano tinha aceitado.** `04` §2 exige emoji e
   *    cor únicos na sala, e com as 8 cores esgotadas é o emoji único que
   *    ainda garante o par. Um avatar sem emoji perdia esse resgate — R-6 do
   *    §5.1 registrava isso como exceção deliberada. Com a imagem por cima de
   *    um emoji que continua existindo, a exceção deixa de ser necessária.
   */
  imagem?: string | undefined;
}

export type RoomStatus =
  | 'LOBBY' | 'INICIANDO' | 'EM_PARTIDA' | 'PAUSADA' | 'FIM_DE_PARTIDA' | 'ENCERRADA';

/**
 * `03` §2. `RECONECTANDO` é interno ao servidor e **NÃO** é transmitido:
 * a reciclagem de socket da plataforma precisa ser invisível ao jogador
 * (RNF-066), e enviá-la já a tornaria visível.
 */
export type ConnectionStatus = 'CONECTADO' | 'DESCONECTADO' | 'REMOVIDO' | 'SAIU';

/**
 * Dificuldades de bot (RF-018). `DIFICIL` e `REALISTA` estão declaradas antes
 * de existirem porque o valor viaja no protocolo e no estado persistido:
 * acrescentar depois obrigaria a migrar sala salva.
 */
export const BOT_DIFFICULTIES = ['FACIL', 'MEDIO', 'DIFICIL', 'REALISTA'] as const;
export type BotDifficulty = (typeof BOT_DIFFICULTIES)[number];

export interface PublicPlayer {
  id: PlayerId;
  nickname: string;
  avatar: Avatar;
  connection: ConnectionStatus;
  isSpectator: boolean;
  joinedAt: number;
  /**
   * Slug PÚBLICO da conta, quando há conta (plano 01 §5). `null` em convidado
   * e em bot.
   *
   * É o slug e não o id interno de propósito: o id nunca sai do servidor. É
   * por este campo que a mesa abre o perfil de quem está sentado.
   */
  conta: string | null;
  /**
   * Presente só em bot. É informação PÚBLICA de propósito: uma mesa que não
   * sabe quem é bot não sabe o que está jogando, e esconder isso seria a
   * primeira mentira do produto.
   */
  bot?: { difficulty: BotDifficulty };
}

/**
 * Mensagem de chat (RF-017).
 *
 * O `nickname` é COPIADO no envio, e não resolvido pelo `playerId` na hora de
 * exibir: quem troca de apelido ou sai da sala faria o histórico se reescrever
 * sozinho, e conversa que muda de autor depois de dita não é histórico.
 */
export interface ChatMessage {
  id: string;
  playerId: PlayerId;
  nickname: string;
  text: string;
  at: number;
}

export interface PauseInfo {
  since: number;
  absentPlayerIds: PlayerId[];
  decisionUnlockedAt: number;
  hardDeadline: number;
}

// ---------------------------------------------------------------------------
// Comandos: cliente → servidor (`05` §4)
// ---------------------------------------------------------------------------

export interface MoveBase {
  matchId: string;
  roundNumber: number;
  /** 0 na fase de apostas. Torna jogada atrasada inofensiva (`ERR-410`). */
  trickNumber: number;
}

export type Command =
  | { type: 'room:resync'; payload: Record<string, never> }
  | { type: 'player:setProfile'; payload: { nickname: string; avatar: Avatar } }
  | { type: 'player:leave'; payload: Record<string, never> }
  | { type: 'chat:send'; payload: { text: string } }
  | { type: 'host:kick'; payload: { playerId: PlayerId } }
  | { type: 'host:addBot'; payload: { difficulty: BotDifficulty } }
  | { type: 'host:removeBot'; payload: { playerId: PlayerId } }
  | { type: 'host:setOptions'; payload: { options: MatchOptions } }
  | { type: 'host:startMatch'; payload: Record<string, never> }
  | { type: 'host:endMatch'; payload: Record<string, never> }
  | { type: 'host:rematch'; payload: Record<string, never> }
  /** Volta à sala de espera sem começar nada — para mexer na mesa antes. */
  | { type: 'host:toLobby'; payload: Record<string, never> }
  | { type: 'host:resolveAbsence'; payload: { action: 'CONTINUAR_SEM' | 'ENCERRAR' } }
  | { type: 'move:bet'; payload: MoveBase & { bet: number } }
  | { type: 'move:playCard'; payload: MoveBase & { cardId: CardId } };

export type CommandType = Command['type'];

export const HOST_ONLY_COMMANDS = [
  'host:kick', 'host:setOptions', 'host:startMatch',
  'host:endMatch', 'host:rematch', 'host:resolveAbsence',
  'host:addBot', 'host:removeBot', 'host:toLobby',
] as const satisfies readonly CommandType[];

// ---------------------------------------------------------------------------
// Eventos: servidor → cliente (`05` §5)
// ---------------------------------------------------------------------------

export type ServerEvent =
  // EV-001..EV-008 — sala
  | { type: 'room:snapshot'; payload: unknown }
  | { type: 'room:playerJoined'; payload: { player: PublicPlayer } }
  | { type: 'room:playerLeft'; payload: { playerId: PlayerId; reason: LeaveReason } }
  | { type: 'room:playerUpdated'; payload: { player: PublicPlayer } }
  | { type: 'room:connectionChanged'; payload: { playerId: PlayerId; connection: ConnectionStatus } }
  | { type: 'room:hostChanged'; payload: { hostId: PlayerId } }
  | { type: 'room:optionsChanged'; payload: { options: MatchOptions } }
  | { type: 'room:statusChanged'; payload: { status: RoomStatus } }
  // EV-009..EV-014 — partida
  | { type: 'match:started'; payload: { matchId: string; playerOrder: PlayerId[]; lives: Record<PlayerId, number>; options: MatchOptions } }
  | { type: 'round:dealt'; payload: { hand: Card[] } }
  | { type: 'round:started'; payload: { roundNumber: number; cardsThisRound: number; deckCount: number; isForeheadRound: boolean; firstBidderId: PlayerId; foreheadCards: Record<PlayerId, Card> } }
  | { type: 'round:phaseChanged'; payload: { phase: RoundPhase; activePlayerId: PlayerId | null; deadline: number | null; forbiddenBet?: number | null; currentTrick: PublicTrick | null; trickNumber: number } }
  | { type: 'round:resolved'; payload: { summary: unknown; lives: Record<PlayerId, number>; eliminated: PlayerId[] } }
  | { type: 'match:ended'; payload: { winnerIds: PlayerId[]; lives: Record<PlayerId, number>; endReason: string } }
  // EV-040 — chat (RF-017)
  | { type: 'chat:message'; payload: { message: ChatMessage } }
  // EV-015..EV-017 — genéricos
  | { type: 'system:notice'; payload: { code: string; params?: Record<string, unknown> } }
  | { type: 'ack'; payload: { commandId: string } }
  | { type: 'error'; payload: ErrorPayload }
  // EV-020..EV-024 — jogadas
  | { type: 'move:betPlaced'; payload: { playerId: PlayerId; bet: number; betsSoFar: Record<PlayerId, number>; forbiddenBet: number | null } }
  | { type: 'move:cardPlayed'; payload: { playerId: PlayerId; card: Card; trickNumber: number; nextPlayerId: PlayerId | null; deadline: number | null } }
  | { type: 'trick:resolved'; payload: { trickNumber: number; winnerId: PlayerId | null; annulled: boolean; annulledValue: number | null; nextLeaderId: PlayerId | null; tricksWon: Record<PlayerId, number>; nextTrick: PublicTrick | null; nextTrickNumber: number; mortoEmVaza: Record<PlayerId, number | null> } }
  | { type: 'round:revealed'; payload: { cards: Record<PlayerId, Card> } }
  | { type: 'move:autoPlayed'; payload: { playerId: PlayerId; kind: 'BET' | 'CARD'; value: number | Card } }
  // EV-030..EV-034 — pausa (`03` §1.2)
  | { type: 'match:paused'; payload: PauseInfo }
  | { type: 'match:absenceChanged'; payload: { absentPlayerIds: PlayerId[] } }
  | { type: 'match:decisionUnlocked'; payload: { hostId: PlayerId } }
  | { type: 'match:resumed'; payload: { phase: RoundPhase; activePlayerId: PlayerId | null; deadline: number | null } }
  | { type: 'round:aborted'; payload: { roundNumber: number; withdrawnPlayerIds: PlayerId[] } };

export type ServerEventType = ServerEvent['type'];

export type LeaveReason = 'LEFT' | 'KICKED' | 'WITHDRAWN' | 'EXPIRED';

/**
 * Eventos que carregam conteúdo oculto e **DEVEM** ser projetados por
 * destinatário antes de sair. `round:started` está aqui por causa da rodada de
 * testa, em que a projeção se inverte (RJ-100/RJ-101).
 */
export const PER_RECIPIENT_EVENTS = [
  'room:snapshot', 'round:dealt', 'round:started', 'round:phaseChanged',
] as const satisfies readonly ServerEventType[];

// ---------------------------------------------------------------------------
// Erros (`05` §6)
// ---------------------------------------------------------------------------

export const ERROR_CODES = {
  ROOM_NOT_FOUND: 'ROOM_NOT_FOUND',
  ROOM_FULL: 'ROOM_FULL',
  INVALID_TOKEN: 'INVALID_TOKEN',
  NOT_HOST: 'NOT_HOST',
  WRONG_STATUS: 'WRONG_STATUS',
  NOT_YOUR_TURN: 'NOT_YOUR_TURN',
  ILLEGAL_MOVE: 'ILLEGAL_MOVE',
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  RATE_LIMITED: 'RATE_LIMITED',
  FORBIDDEN_CARD: 'FORBIDDEN_CARD',
  SESSION_TAKEN: 'SESSION_TAKEN',
  STALE_MOVE: 'STALE_MOVE',
  MATCH_PAUSED: 'MATCH_PAUSED',
  DECISION_LOCKED: 'DECISION_LOCKED',
  PROTOCOL_VERSION: 'PROTOCOL_VERSION',
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

export interface ErrorPayload {
  commandId?: string;
  code: ErrorCode;
  /**
   * Razão específica da recusa. Erro genérico em jogo de cartas é a maior
   * fonte de frustração — a UI traduz isto em texto humano.
   */
  params?: Record<string, unknown>;
}

/**
 * Códigos de fechamento do WebSocket.
 *
 * A faixa 4000–4999 é reservada à aplicação. Existem para que o cliente saiba
 * **se deve insistir**: um deploy pede reconexão imediata; um token inválido
 * pede limpar a sessão e recomeçar. Sem essa distinção, o cliente ou martela um
 * servidor que o recusa, ou desiste de uma partida que ainda está de pé.
 */
export const CLOSE_CODES = {
  /** RNF-065: desligamento gracioso. Reconecte já — a sala continua lá. */
  SERVER_RESTART: 4001,
  /** ERR-003: limpe a sessão e refaça o join. */
  INVALID_TOKEN: 4003,
  /** ERR-001: a sala não existe mais. */
  ROOM_NOT_FOUND: 4004,
  /** ERR-409: outra aba assumiu a sessão. Não reconecte por conta própria. */
  SESSION_TAKEN: 4009,
} as const;

export type CloseCode = (typeof CLOSE_CODES)[keyof typeof CLOSE_CODES];

/** Fechamentos em que reconectar sozinho é o comportamento certo. */
export function shouldReconnect(closeCode: number): boolean {
  return closeCode !== CLOSE_CODES.SESSION_TAKEN &&
    closeCode !== CLOSE_CODES.INVALID_TOKEN &&
    closeCode !== CLOSE_CODES.ROOM_NOT_FOUND;
}

// ---------------------------------------------------------------------------
// Limites (`05` §7)
// ---------------------------------------------------------------------------

export const LIMITS = {
  /** RNF-010 */
  commandsPerWindow: 20,
  commandWindowMs: 10_000,
  /** RNF-011 */
  maxMessageBytes: 32 * 1024,
  /** RNF-012 */
  maxPlayers: 8,
  /**
   * RF-018: até 7 bots, que é `maxPlayers - 1`. O −1 não é decoração: uma mesa
   * só de bots não é jogo, é demonstração, e ninguém precisa de sala para isso.
   */
  maxBots: 7,
  /**
   * Quanto um bot "pensa" antes de jogar. Não é dificuldade artificial: sem
   * pausa a mesa inteira resolve numa piscada e o humano não vê o que
   * aconteceu. Curto o bastante para não entediar.
   */
  botThinkMs: 900,
  minPlayers: 2,
  maxSpectators: 4,
  /** RNF-013: reenvio do mesmo `id` é idempotente nesta janela. */
  idempotencyWindowMs: 30_000,
  /** RNF-014: tamanho da mensagem de chat, depois de aparada. */
  chatTextMax: 280,
  /**
   * RNF-016: intervalo mínimo entre duas mensagens da MESMA pessoa.
   *
   * RNF-010 já limita a 20 comandos por 10 s, e por muito tempo isso bastou —
   * o argumento era que quem inunda o chat gasta o próprio direito de jogar.
   * O argumento estava certo sobre o abuso e errado sobre a mesa: 2 mensagens
   * por segundo não é ataque, é uma pessoa animada, e mesmo assim enche o
   * feltro de balões e empurra a conversa para fora do painel no meio de uma
   * mão. Uma por segundo é folgado para quem conversa e é o suficiente para
   * que nenhuma rajada tape o jogo.
   */
  chatMinIntervalMs: 1_000,
  /**
   * RNF-015: teto do histórico por sala. O histórico vive dentro do valor que
   * o Redis lê e escreve a cada mudança de estado — sem teto, uma sala de 4
   * horas com gente falante cresce sem limite.
   */
  chatHistoryMax: 200,
  /** `03` §2.1 */
  transportGraceMs: 10_000,
  reconnectGraceMs: 60_000,
  pauseMaxMs: 10 * 60_000,
  betTimeoutMs: 45_000,
  playTimeoutMs: 30_000,
  roomMaxLifeMs: 4 * 60 * 60_000,
  lobbyIdleMs: 15 * 60_000,
  /** Pausa de legibilidade das fases automáticas (`03` §4.2). */
  autoPhasePauseMs: 3_000,
  /**
   * Fim de vaza: quanto tempo as cartas ficam na mesa antes de recolher.
   *
   * `07` §2.4 admite de 1,5 a 3 s. São 1,5 s parado para ler a mesa mais os
   * 300 ms em que as cartas viajam até o vencedor — dentro da faixa, e perto do
   * piso porque isto acontece a CADA vaza: 3 s por vaza viram uma rodada
   * inteira de espera.
   */
  trickPauseMs: 1_800,
  /** Quanto dura a viagem das cartas até o vencedor (`07` §3: 150–300 ms). */
  trickCollectMs: 300,
} as const;

export const NICKNAME_MIN = 2;
export const NICKNAME_MAX = 16;
export const ROOM_CODE_LENGTH = 5;
/** Sem `I`, `O`, `0`, `1`: confundem ao ditar por voz (`06` §2). */
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
