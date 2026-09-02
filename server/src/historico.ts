/**
 * A partida terminada, virando registro (plano 01 §9).
 *
 * Mora no SERVIDOR e não em `@fdp/room` de propósito: a sala não precisa saber
 * o que é conta, e fazê-la depender de `@fdp/contas` inverteria a direção das
 * camadas por uma conveniência.
 *
 * **Nenhum número é calculado aqui.** Colocação sai de `ranking()`, nota de
 * `desempenhoDaPartida()` e o resto de `numerosDaPartida()` — todas do motor,
 * todas as mesmas que a tela de fim usa. É o ponto inteiro de §9.1: se este
 * arquivo recalculasse qualquer coisa "igual", o histórico e a tela acabariam
 * discordando da mesma partida, e o desacordo ficaria GRAVADO.
 */

import {
  desempenhoDaPartida, numerosDaPartida, ranking,
  type MatchState,
} from '@fdp/rules';
import type { Room } from '@fdp/room';
import type { JogadorDaPartida, Partida } from '@fdp/contas';

/**
 * Monta o registro. Devolve `null` quando não há partida a gravar.
 *
 * Note que **não** decide se persiste: essa é a regra de RF-068 e mora no
 * repositório, onde ninguém consegue passar por fora dela.
 */
export function registroDaPartida(
  room: Room,
  estado: MatchState,
  terminouEm: number,
): Omit<Partida, 'id'> | null {
  if (estado.endReason === null) return null;

  const colocacoes = new Map(ranking(estado).map((id, i) => [id, i + 1]));
  const notas = new Map(desempenhoDaPartida(estado).map((d) => [d.playerId, d]));
  const numeros = numerosDaPartida(estado);
  const eliminados = new Map(estado.eliminated.map((e) => [e.playerId, e]));

  const jogadores: JogadorDaPartida[] = estado.playerOrder.map((id, posicao) => {
    const naSala = room.players.find((p) => p.id === id);
    const nota = notas.get(id);
    const n = numeros.get(id);
    const eliminado = eliminados.get(id);

    return {
      posicao,
      // Bot NUNCA leva conta, mesmo que a sala se confunda: é o que impede uma
      // mesa só de bots de fazer a partida entrar no histórico de alguém.
      contaId: naSala?.bot ? null : (naSala?.contaId ?? null),
      // Snapshot: quem trocar de apelido amanhã não reescreve a partida de
      // ontem, e o convidado sem conta precisa aparecer de algum jeito.
      apelido: naSala?.nickname ?? '—',
      avatar: naSala?.avatar ?? { emoji: '🦊', color: 'amber' },
      bot: naSala?.bot !== null && naSala?.bot !== undefined,
      dificuldade: naSala?.bot?.difficulty ?? null,
      colocacao: colocacoes.get(id) ?? estado.playerOrder.length,
      vidasFinais: estado.lives[id] ?? 0,
      eliminadoRodada: eliminado?.roundNumber ?? null,
      mortoEmVaza: eliminado?.mortoEmVaza ?? null,
      acertos: n?.acertos ?? 0,
      jogadas: n?.jogadas ?? 0,
      erroMedio: Math.round((n?.erroMedio ?? 0) * 100) / 100,
      piorErro: n?.pior ?? 0,
      nota: nota?.nota ?? 0,
      // O elo entra DEPOIS, quando a partida já existe no banco (plano 03
      // §6.1): calcular aqui exigiria ler o elo de todo mundo antes de gravar,
      // e uma gravação que falhasse depois disso deixaria o número na conta
      // sem a partida que o explica.
      eloAntes: null,
      eloDelta: null,
      // Expulso NÃO é abandono: o preço na ranqueada é diferente, e quem levou
      // o pé não escolheu sair.
      abandonou: naSala?.abandonou ?? false,
    };
  });

  return {
    salaCodigo: room.code,
    origem: room.origem,
    // `history[0]` é a primeira rodada; se ela faltar, a partida acabou antes
    // de existir, e o fim serve de começo.
    comecouEm: room.createdAt,
    terminouEm,
    motivoFim: estado.endReason,
    rodadas: estado.history.length,
    opcoes: estado.options,
    jogadores,
  };
}
