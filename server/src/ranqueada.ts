/**
 * O elo de uma partida ranqueada, do fim da mesa até o banco (plano 03 §6).
 *
 * A conta em si é de `elo.ts`, pura. Aqui só mora a costura: ler o elo de
 * antes, chamar a conta, gravar. Separado do `historico.ts` porque as duas
 * gravações são sequenciais e a ordem importa — a partida precisa existir para
 * a participação poder receber `elo_antes`.
 */

import type { Dados, Partida } from '@fdp/contas';
import type { Room } from '@fdp/room';
import type { MatchState } from '@fdp/rules';
import { deltasDaMesa, type JogadorRanqueado } from './elo.js';
import { registroDaPartida } from './historico.js';

/**
 * Aplica o elo de uma partida já GRAVADA.
 *
 * Recebe a partida do banco, e não a sala, porque é dela que sai o
 * `partida.id` — e sem ele não há onde gravar `elo_antes`. Também é o que
 * garante a ordem: elo que existisse sem a partida que o explica seria um
 * número no perfil de alguém sem nada por trás.
 *
 * Só mexe em quem tem conta. Bot e convidado não entram — bot não tem conta por
 * construção (RF-068), e convidado não tem onde guardar.
 */
export async function aplicarElo(dados: Dados, partida: Partida): Promise<void> {
  if (partida.origem !== 'RANQUEADA') return;

  const comConta = partida.jogadores.filter((j) => j.contaId !== null && !j.bot);
  if (comConta.length === 0) return;

  const antes = await dados.elos.porContas(comConta.map((j) => j.contaId!));

  /**
   * `naMesa` é quantos JOGARAM, e não quantos têm conta.
   *
   * A colocação de cada um se formou contra a mesa inteira — incluindo os
   * convidados e o assento que virou bot. Normalizar por "quantos têm conta"
   * faria a mesma colocação valer coisas diferentes conforme quantas pessoas
   * por acaso estavam logadas, que é exatamente o tipo de número que ninguém
   * consegue explicar depois.
   */
  const naMesa = partida.jogadores.length;

  const entradas: JogadorRanqueado[] = comConta.map((j) => {
    const registro = antes.get(j.contaId!);
    return {
      contaId: j.contaId!,
      colocacao: j.colocacao,
      eloAntes: registro?.pontos ?? 0,
      partidasAntes: registro?.partidas ?? 0,
      abandonou: j.abandonou,
    };
  });

  const deltas = deltasDaMesa(entradas, naMesa);
  await dados.elos.aplicar(
    partida.id,
    deltas.map((d) => ({
      contaId: d.contaId,
      eloAntes: d.eloAntes,
      delta: d.delta,
      eloDepois: d.eloDepois,
      abandonou: entradas.find((e) => e.contaId === d.contaId)?.abandonou ?? false,
    })),
  );
}

/**
 * A partida que acabou virando registro — e, se for ranqueada, elo.
 *
 * Existe como função, e não solta dentro do `main.ts`, porque é uma **emenda**:
 * de um lado o fim da mesa, do outro duas gravações em ordem. Emenda que só
 * existe na fiação de produção é emenda que nenhum teste alcança, e foi
 * exatamente aí que nasceram os dois piores defeitos deste projeto — o `v: 1`
 * fixo no hub e o `isPresent` que deixava o expulso voltar. Os dois lados
 * estavam testados; a emenda, não.
 *
 * **Nunca lança.** `onFimDePartida` é chamado de dentro do `settle` do hub, e
 * uma exceção daqui derrubaria a entrega dos eventos e a mesa junto (RF-071).
 * Histórico é registro, não jogo: com o Postgres fora do ar, a partida termina
 * normalmente e o que se perde é uma linha no perfil de alguém.
 */
export async function registrarFimDePartida(
  dados: Dados | null,
  room: Room,
  estado: MatchState,
  terminouEm: number,
): Promise<void> {
  if (!dados) return;
  try {
    const registro = registroDaPartida(room, estado, terminouEm);
    if (!registro) return;

    // O elo vem DEPOIS da partida, e só se ela foi gravada: um número no perfil
    // de alguém sem a partida que o explica é pior que nenhum.
    const gravada = await dados.partidas.gravar(registro);
    if (gravada) await aplicarElo(dados, gravada);
  } catch (erro) {
    console.error('falha ao registrar a partida:', erro);
  }
}
