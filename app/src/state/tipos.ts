import type { PlayerView, MatchOptions } from '@fdp/rules';
import type { PublicPlayer, RoomStatus } from '@fdp/protocol';

/** O retrato de `EV-001`, já projetado para quem está olhando. */
export interface Retrato {
  code: string;
  status: RoomStatus;
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
  match: PlayerView | null;
}

export type { PlayerView, PublicPlayer };
