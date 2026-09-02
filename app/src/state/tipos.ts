import type { Card, PlayerView, MatchOptions } from '@fdp/rules';
import type { ChatMessage, Origem, PublicPlayer, RoomStatus } from '@fdp/protocol';

/** O retrato de `EV-001`, já projetado para quem está olhando. */
export interface Retrato {
  code: string;
  status: RoomStatus;
  /** De onde a mesa veio. Numa mesa de fila o host não tem poderes (RF-101). */
  origem: Origem;
  hostId: string;
  options: MatchOptions;
  stateVersion: number;
  players: PublicPlayer[];
  pause: {
    since: number;
    absentPlayerIds: string[];
    decisionUnlockedAt: number;
    hardDeadline: number;
  } | null;
  phaseDeadline: number | null;
  chat: ChatMessage[];
  match: PlayerView | null;
}

export type { Card, PlayerView, PublicPlayer, ChatMessage };
