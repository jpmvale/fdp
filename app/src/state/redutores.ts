import { LIMITS } from '@fdp/protocol';
import type { ChatMessage, PlayerView, PublicPlayer, Retrato } from './tipos';

/**
 * Redutores por evento (`11` §6).
 *
 * O cliente pedia o retrato inteiro a cada evento. Correto — o servidor é a
 * autoridade — e caro: uma jogada de carta trazia de volta a partida completa,
 * com a mão de todo mundo projetada, o histórico e o placar.
 *
 * ## O contrato, que é a única coisa que torna isto seguro
 *
 * Cada redutor devolve o retrato novo **ou `null`**. `null` quer dizer "não
 * consigo montar este estado com o que o evento me deu" — e o chamador pede o
 * retrato ao servidor, exatamente como antes. Nunca há terceiro caminho: ou o
 * redutor sabe produzir o estado inteiro e correto, ou admite que não sabe.
 *
 * Isso importa porque o modo de falha de um redutor errado é o pior que existe
 * neste produto: a tela fica *plausível* e diverge em silêncio. Melhor um
 * resync a mais do que uma mesa que mostra uma vaza que não aconteceu.
 *
 * ## O que ainda pede resync, e por quê
 *
 * As transições estruturais — começo de partida, começo e fim de rodada, pausa
 * — não cabem nos eventos que as anunciam: `match:started` não traz
 * `handCounts`, `trick:resolved` não traz a ordem de jogo da vaza seguinte.
 * Não é descuido do redutor, é o fluxo de eventos ser incompleto para
 * reconstruir esses pontos. Enquanto for, resync é a resposta certa — e são
 * eventos raros, um punhado por rodada, contra dezenas de jogadas.
 */

export type ServerEvent = {
  type: string;
  payload: unknown;
  /** A versão que o quadro carrega. Mantém o retrato local honesto. */
  stateVersion?: number;
};

/** `null` = não sei montar isto; peça o retrato. */
export type Reducao = Retrato | null;

export function reduzir(retrato: Retrato, evento: ServerEvent): Reducao {
  const reduzido = aplicar(retrato, evento);
  if (!reduzido) return null;
  // A versão avança junto com o estado. Sem isto o retrato local carrega para
  // sempre a versão do último snapshot, e um campo que mente é pior que um
  // campo ausente — sobretudo este, que é o que decide reconciliação.
  return typeof evento.stateVersion === 'number'
    ? { ...reduzido, stateVersion: evento.stateVersion }
    : reduzido;
}

function aplicar(retrato: Retrato, evento: ServerEvent): Reducao {
  const p = evento.payload as Record<string, never>;

  switch (evento.type) {
    // --- narração pura: não mexem em estado nenhum -------------------------
    case 'move:autoPlayed':
    case 'system:notice':
    case 'match:decisionUnlocked':
      return retrato;

    case 'chat:message': {
      const { message } = evento.payload as { message: ChatMessage };
      return { ...retrato, chat: [...retrato.chat, message].slice(-LIMITS.chatHistoryMax) };
    }

    // --- sala ---------------------------------------------------------------
    case 'room:playerJoined': {
      const { player } = evento.payload as { player: PublicPlayer };
      if (retrato.players.some((x) => x.id === player.id)) {
        return { ...retrato, players: retrato.players.map((x) => (x.id === player.id ? player : x)) };
      }
      return { ...retrato, players: [...retrato.players, player] };
    }

    case 'room:playerUpdated': {
      const { player } = evento.payload as { player: PublicPlayer };
      if (!retrato.players.some((x) => x.id === player.id)) return null;
      return { ...retrato, players: retrato.players.map((x) => (x.id === player.id ? player : x)) };
    }

    case 'room:playerLeft': {
      const id = p['playerId'] as unknown as string;
      // O retrato do servidor só traz quem está presente, então sair é sumir.
      // Mas sair NO MEIO DA PARTIDA é retirada (RJ-154), que refaz a rodada —
      // isso o evento não descreve, e vem com `round:aborted` junto.
      if (retrato.match && retrato.match.endReason === null) return null;
      return { ...retrato, players: retrato.players.filter((x) => x.id !== id) };
    }

    case 'room:connectionChanged': {
      const id = p['playerId'] as unknown as string;
      const conexao = p['connection'] as unknown as PublicPlayer['connection'];
      if (!retrato.players.some((x) => x.id === id)) return null;
      return {
        ...retrato,
        players: retrato.players.map((x) => (x.id === id ? { ...x, connection: conexao } : x)),
      };
    }

    case 'room:hostChanged':
      return { ...retrato, hostId: p['hostId'] as unknown as string };

    case 'room:optionsChanged':
      return { ...retrato, options: p['options'] as unknown as Retrato['options'] };

    case 'match:absenceChanged': {
      if (!retrato.pause) return null;
      const ausentes = p['absentPlayerIds'] as unknown as string[];
      return { ...retrato, pause: { ...retrato.pause, absentPlayerIds: ausentes } };
    }

    // --- partida ------------------------------------------------------------
    case 'round:phaseChanged': {
      const m = retrato.match;
      if (!m) return null;

      const fase = p['phase'] as unknown as PlayerView['phase'];
      // O prazo é da SALA, não da partida — e muda a cada turno. Esquecê-lo
      // deixava a barra do turno congelada no prazo anterior.
      const comPrazo = {
        ...retrato,
        phaseDeadline: (p['deadline'] as unknown as number | null | undefined) ?? null,
      };
      return comPartida(comPrazo, {
        ...m,
        phase: fase,
        // Entrar em VAZAS cria a primeira vaza no servidor, com líder e ordem
        // de jogo. O evento passou a carregá-la justamente para o cliente não
        // precisar derivar nada — derivar seria decidir regra aqui.
        currentTrick: (p['currentTrick'] as unknown as PlayerView['currentTrick']) ?? null,
        trickNumber: (p['trickNumber'] as unknown as number) ?? m.trickNumber,
        activePlayerId: p['activePlayerId'] as unknown as string | null,
        // Só quem está na vez recebe `forbiddenBet`; ausente no payload
        // significa "não é você", e `null` é a resposta certa (RJ-054).
        forbiddenBet: (p['forbiddenBet'] as unknown as number | null | undefined) ?? null,
      });
    }

    case 'move:betPlaced': {
      const m = retrato.match;
      if (!m) return null;
      // `betsSoFar` é o mapa INTEIRO, não um delta: adotar o que veio é mais
      // seguro que somar em cima do que se tinha.
      return comPartida(retrato, {
        ...m,
        bets: { ...(p['betsSoFar'] as unknown as Record<string, number>) },
      });
    }

    case 'move:cardPlayed': {
      const m = retrato.match;
      // Sem vaza corrente não dá para acrescentar jogada sem inventar a ordem
      // de quem joga — que é regra, e regra não se decide no cliente.
      if (!m || !m.currentTrick) return null;
      const quem = p['playerId'] as unknown as string;
      const carta = p['card'] as unknown as PlayerView['hand'][number];

      // Entre as cartas de uma vaza a fase não muda, então este evento é o
      // único que anuncia de quem passou a ser a vez — e até quando.
      const comPrazo = {
        ...retrato,
        phaseDeadline: (p['deadline'] as unknown as number | null | undefined) ?? null,
      };

      return comPartida(comPrazo, {
        ...m,
        activePlayerId: (p['nextPlayerId'] as unknown as string | null) ?? null,
        currentTrick: {
          ...m.currentTrick,
          plays: [...m.currentTrick.plays, { playerId: quem, card: carta }],
        },
        handCounts: {
          ...m.handCounts,
          [quem]: Math.max(0, (m.handCounts[quem] ?? 0) - 1),
        },
        // A própria mão só encolhe quando fui eu que joguei. A carta dos outros
        // nunca esteve aqui.
        hand: quem === m.viewerId ? m.hand.filter((c) => c.id !== carta.id) : m.hand,
      });
    }

    case 'trick:resolved': {
      const m = retrato.match;
      if (!m || !m.currentTrick) return null;

      // A vaza que estava em curso vira resolvida, com o veredito colado nela.
      const fechada = {
        ...m.currentTrick,
        winnerId: (p['winnerId'] as unknown as string | null) ?? null,
        annulledValue: (p['annulledValue'] as unknown as number | null) ?? null,
        nextLeaderId: (p['nextLeaderId'] as unknown as string | null) ?? null,
      };

      return comPartida(retrato, {
        ...m,
        resolvedTricks: [...m.resolvedTricks, fechada],
        // `null` quando a rodada acabou — e aí o que vem a seguir é
        // `round:resolved`, que continua pedindo o retrato.
        currentTrick: (p['nextTrick'] as unknown as PlayerView['currentTrick']) ?? null,
        trickNumber: (p['nextTrickNumber'] as unknown as number) ?? m.trickNumber,
        // Mapas inteiros, não deltas.
        tricksWon: { ...(p['tricksWon'] as unknown as Record<string, number>) },
        mortoEmVaza: { ...(p['mortoEmVaza'] as unknown as Record<string, number | null>) },
      });
    }

    case 'round:revealed': {
      const m = retrato.match;
      if (!m) return null;
      return comPartida(retrato, {
        ...m,
        foreheadCards: p['cards'] as unknown as PlayerView['foreheadCards'],
      });
    }

    default:
      // Tudo que não está aqui — `match:started`, `round:started`,
      // `round:resolved`, `match:ended`, o ciclo de pausa — pede o retrato.
      return null;
  }
}

const comPartida = (retrato: Retrato, match: PlayerView): Retrato => ({ ...retrato, match });
