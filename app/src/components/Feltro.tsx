import { Avatar } from './Avatar';
import { Carta } from './Carta';
import { Vaza, useRecolhimento, type JogadaNaMesa } from './Vaza';
import { Balao, useBaloes } from './Balao';
import type { PlayerView, PublicPlayer, Retrato } from '../state/tipos';

/**
 * O feltro: os jogadores em volta de uma mesa oval, você sempre na base.
 *
 * As posições são calculadas, não fixadas: o design mostra 6 e 8 assentos, e
 * escrever uma tabela por quantidade daria seis layouts para manter. O círculo
 * se ajusta ao número de gente, que é o que o próprio design diz.
 *
 * Por que a mesa e não uma lista: a lista respondia "quem tem quantas vidas" e
 * a mesa responde "como está a mesa" — quem já apostou, quem falta, de quem é
 * a vez, e a vaza no meio com cada carta junto de quem a jogou. É a diferença
 * entre um placar e um jogo.
 */

/**
 * Largura do assento. O teto é aritmético e não estético: são 3 lado a lado na
 * fileira de cima, dentro de 336 px úteis (360 menos o respiro da casca).
 * 3 × 104 = 312, com ~8 px de respiro entre eles. Passar disso encosta.
 */
const ASSENTO = 104;

export function Feltro({ retrato, eu, partida }: {
  retrato: Retrato;
  eu: string;
  partida: PlayerView;
}) {
  const ausentes = new Set(retrato.pause?.absentPlayerIds ?? []);

  // A ordem começa em mim: assim eu caio sempre na base, e os outros seguem no
  // sentido do jogo. Sem isso a minha posição mudaria a cada partida.
  const ordem = partida.playerOrder;
  const meuIndice = Math.max(0, ordem.indexOf(eu));
  const daMinha = [...ordem.slice(meuIndice), ...ordem.slice(0, meuIndice)];

  const total = daMinha.length;
  const lugares = posicoes(total);
  const apostaram = Object.keys(partida.bets).length;
  const vazasFeitas = Object.values(partida.tricksWon).reduce((a, b) => a + b, 0);

  const ondeSenta = (id: string) => {
    const i = daMinha.indexOf(id);
    return lugares[i] ?? { x: 50, y: 50 };
  };

  // Durante o recolhimento a vaza fechada vive só em `resolvedTricks` — o
  // motor esvazia `currentTrick` para não contar as cartas duas vezes.
  const recolhendo = partida.phase === 'RECOLHIMENTO';
  const fechada = partida.resolvedTricks[partida.resolvedTricks.length - 1];
  // Na testa as cartas ficam nas testas ENQUANTO se aposta. Na revelação elas
  // vão para a mesa, como em qualquer rodada — é lá que se comparam, e é a
  // única chance de o dono ver a própria carta antes de a rodada fechar.
  const revelando = partida.isForeheadRound && partida.phase === 'REVELACAO';
  const naMesa: JogadaNaMesa[] = revelando
    ? partida.playerOrder
        .filter((id) => partida.foreheadCards[id])
        .map((id) => ({ playerId: id, card: partida.foreheadCards[id]! }))
    : partida.isForeheadRound
      ? []
      : recolhendo
        ? fechada?.plays ?? []
        : partida.currentTrick?.plays ?? [];
  const viajando = useRecolhimento(recolhendo, retrato.phaseDeadline);
  const { baloes, descartar, perdasRecentes } = useBaloes(retrato.chat, partida);

  // O contador do meio cede o lugar às cartas: era ele que as cartas cobriam.
  const centroLivre = naMesa.length === 0;

  return (
    <div style={{ position: 'relative', height: 372, marginTop: 4 }}>
      {/* O pano. `50% / 32%` é o que dá a elipse achatada de mesa vista de
          cima, em vez do círculo de um relógio. */}
      <div
        aria-hidden
        style={{
          position: 'absolute',
          left: 54, right: 54, top: 8, bottom: 30,
          borderRadius: '50% / 32%',
          background: 'radial-gradient(ellipse at 50% 38%, var(--feltro-claro), var(--feltro-escuro))',
          boxShadow: 'inset 0 0 40px rgba(0,0,0,0.45)',
        }}
      />

      {/* Centro: o estado da MESA, não o de ninguém — e só enquanto não há
          carta nenhuma nela. Com cartas, quem conta a rodada é o cabeçalho. */}
      {centroLivre && <div style={{
        position: 'absolute', left: 0, right: 0, top: 142,
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3,
        pointerEvents: 'none',
      }}>
        <span className="rotulo" style={{ color: '#7f9ab5' }}>
          {partida.phase === 'APOSTAS' ? 'apostas da mesa' : 'mãos da rodada'}
        </span>
        <span style={{ fontSize: 26, fontWeight: 500, lineHeight: 1 }}>
          {partida.phase === 'APOSTAS' ? somaDeApostas(partida) : vazasFeitas}
          <span style={{ color: '#7f9ab5', fontSize: 16 }}> de {partida.cardsThisRound} mãos</span>
        </span>
        {/* Só nas apostas: com as mãos rolando, "mão X de Y" já está no
            cabeçalho, e repetir a mesma contagem a 200 px de distância não
            informa — só ocupa o espaço que as cartas vão usar. */}
        {partida.phase === 'APOSTAS' && (
          <span style={{ fontSize: 11, color: '#9dbad4' }}>
            {apostaram} de {total} já apostaram
          </span>
        )}
      </div>}

      <Vaza
        jogadas={naMesa}
        jogadores={retrato.players}
        regraEmpate={retrato.options.regraEmpate}
        recolhendo={viajando}
        posicaoDe={ondeSenta}
        eu={eu}
      />

      {/* Balões por cima de tudo: são transitórios e não disputam espaço com
          nada — some em segundos e a mesa continua legível por baixo. */}
      {baloes.map((balao, i) => {
        const { x, y } = ondeSenta(balao.playerId);
        // Quantos balões do mesmo jogador vieram antes deste.
        const empilhado = baloes.slice(0, i).filter((b) => b.playerId === balao.playerId).length;
        return (
          <Balao
            key={balao.id}
            balao={balao}
            x={x}
            y={y}
            empilhado={empilhado}
            aoSumir={descartar}
          />
        );
      })}

      {daMinha.map((id, i) => {
        const jogador = retrato.players.find((p) => p.id === id);
        if (!jogador) return null;

        const { x, y } = lugares[i] ?? { x: 50, y: 50 };
        const souEu = id === eu;
        return (
          <div key={id}>
            <Assento
              jogador={jogador}
              partida={partida}
              souEu={souEu}
              ehHost={retrato.hostId === id}
              ausente={ausentes.has(id)}
              x={x}
              y={y}
              carta={cartaDoAssento(partida, id, souEu)}
              puxa={id === puxadorDaMao(partida)}
              perdeu={perdasRecentes[id] ?? 0}
            />
          </div>
        );
      })}
    </div>
  );
}

/**
 * Onde cada um senta, em porcentagem do contêiner.
 *
 * NÃO é uma elipse com os assentos distribuídos por ângulo. Tentei assim
 * primeiro e com 8 jogadores os cartões de 96 px se atropelam nas laterais e
 * vazam para fora dos 360 px — não cabe, e nenhum ajuste de raio resolve,
 * porque o problema é largura de cartão contra largura de tela.
 *
 * O arranjo é o do design: **até 3 em cima, o resto dividido entre as duas
 * laterais, e você sempre na base**. As laterais empilham em vez de se
 * espalhar, que é o que mantém tudo dentro da tela com a mesa cheia.
 */
function posicoes(total: number): { x: number; y: number }[] {
  const outros = total - 1;
  const emCima = Math.min(3, outros);
  const sobra = outros - emCima;
  const naEsquerda = Math.ceil(sobra / 2);
  const naDireita = sobra - naEsquerda;

  const lugares: { x: number; y: number }[] = [];

  // Índice 0 sou eu, na base. Os outros seguem no sentido do jogo: primeiro a
  // lateral esquerda subindo, depois o topo, depois a direita descendo — que é
  // a ordem em que a vez circula numa mesa de verdade.
  lugares.push({ x: 50, y: 84 });

  const alturaLateral = (i: number, quantos: number) =>
    quantos === 1 ? 46 : 30 + (i * 34) / Math.max(1, quantos - 1);

  for (let i = 0; i < naEsquerda; i++) {
    lugares.push({ x: 16.5, y: alturaLateral(naEsquerda - 1 - i, naEsquerda) });
  }

  for (let i = 0; i < emCima; i++) {
    const x = emCima === 1 ? 50 : 16.5 + (i * 67) / (emCima - 1);
    lugares.push({ x, y: 7 });
  }

  for (let i = 0; i < naDireita; i++) {
    lugares.push({ x: 83.5, y: alturaLateral(i, naDireita) });
  }

  return lugares;
}

const somaDeApostas = (partida: PlayerView) =>
  Object.values(partida.bets).reduce((a, b) => a + b, 0);

/**
 * Quem começa a mão que está aberta.
 *
 * Na fase de vazas é o líder da vaza corrente (RJ-065: quem levou a anterior
 * puxa a seguinte). Na aposta, é quem abre a rodada. Sem isso a mesa não tem
 * como saber de quem parte a mão — e é informação que muda a decisão de quem
 * joga por último.
 */
export function puxadorDaMao(partida: PlayerView): string | null {
  if (partida.phase === 'APOSTAS') return partida.firstBidderId;
  return partida.currentTrick?.leaderId ?? null;
}

/**
 * Que carta esse assento mostra: **só** a da testa, na rodada de 1 carta.
 *
 * A carta de testa não é uma carta jogada — está na cabeça da pessoa, à vista
 * de todos menos dela. É a única que pertence ao assento; as jogadas vão para
 * o centro, onde se comparam (`07` §2.4).
 *
 * No meu assento durante a testa, `null` é o VERSO: a carta não chega até aqui
 * (RJ-101).
 */
function cartaDoAssento(partida: PlayerView, id: string, souEu: boolean) {
  if (!partida.isForeheadRound) return { mostra: false, carta: null };
  // Na revelação as cartas saem das testas e vão para o centro: deixá-las
  // também no assento mostraria a mesma carta em dois lugares.
  if (partida.phase === 'REVELACAO') return { mostra: false, carta: null };
  // `null` é o VERSO. E ele vem de a carta NÃO estar na projeção, não de um
  // `if` aqui: enquanto se aposta, o servidor não manda a minha (RJ-100), e é
  // essa ausência que a tela desenha. Escrever `souEu ? null` mentiria na
  // revelação, quando o servidor passa a mandá-la.
  return { mostra: true, carta: partida.foreheadCards[id] ?? null };
}

function Assento({ jogador, partida, souEu, ehHost, ausente, x, y, carta, perdeu, puxa }: {
  jogador: PublicPlayer;
  partida: PlayerView;
  souEu: boolean;
  ehHost: boolean;
  ausente: boolean;
  x: number;
  y: number;
  carta: { mostra: boolean; carta: import('@fdp/rules').Card | null };
  /** Puxa esta mão: joga primeiro, e a legenda gira com o puxador (RJ-065). */
  puxa: boolean;
  /** Vidas que acabaram de ser debitadas: caem do próprio contador. */
  perdeu: number;
}) {
  const vez = partida.activePlayerId === jogador.id;
  const condenado = partida.mortoEmVaza?.[jogador.id] != null;
  const aposta = partida.bets[jogador.id];
  const vazas = partida.tricksWon[jogador.id] ?? 0;
  const vidas = partida.lives[jogador.id] ?? 0;

  return (
    <div
      style={{
        position: 'absolute',
        left: `calc(${x}% - ${ASSENTO / 2}px)`,
        top: `calc(${y}% - 22px)`,
        width: ASSENTO,
        padding: 5,
        borderRadius: 10,
        background: 'rgba(8,14,23,0.88)',
        boxShadow: vez
          ? 'inset 0 0 0 1px var(--acento), 0 0 0 3px rgba(145,132,217,0.22)'
          : 'inset 0 0 0 1px var(--linha)',
        display: 'flex',
        flexDirection: 'column',
        gap: 3,
        opacity: condenado ? 0.6 : 1,
        zIndex: souEu ? 4 : 2,
      }}
    >
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        {/* A carta de TESTA fica no assento, porque é lá que ela está: na
            cabeça da pessoa, à vista de todos menos dela. As cartas JOGADAS
            vão para o centro (`Vaza`), onde se comparam — uma mão é uma
            disputa, e espalhá-la pelos assentos obrigaria a comparar oito
            cantos da tela. Na revelação, a carta de testa também vai para o
            centro e este espaço fica vazio. */}
        {carta.mostra && (
          <Carta
            carta={carta.carta}
            tamanho="pequena"
            rotulo={carta.carta
              ? `${jogador.nickname} · ${carta.carta.rank}`
              : 'a sua carta, que você não vê'}
          />
        )}
        <Avatar avatar={jogador.avatar} tamanho={26} />
        <span style={{
          fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap',
          overflow: 'hidden', textOverflow: 'ellipsis',
        }}>
          {vez && <span aria-hidden style={{ color: 'var(--acento)' }}>▸ </span>}
          {souEu ? 'você' : jogador.nickname}
        </span>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span
          style={{ color: vidas > 0 ? 'var(--vidas)' : 'var(--texto-apagado)', fontSize: 10, letterSpacing: 1 }}
          aria-label={`${vidas} ${vidas === 1 ? 'vida' : 'vidas'}`}
        >
          {vidas > 0 ? (vidas > 5 ? `♥×${vidas}` : '♥'.repeat(vidas)) : '☠'}
          {/* Os corações debitados caem de onde estavam. O número novo já está
              certo ao lado; estes são os que saíram, e existem só para a queda
              ser vista em vez de deduzida. */}
          {perdeu > 0 && (
            <span aria-hidden className="coracao-caindo" style={{ opacity: 0.85 }}>
              {'♥'.repeat(Math.min(perdeu, 3))}
            </span>
          )}
        </span>
        <span style={{ fontSize: 12, fontVariantNumeric: 'tabular-nums' }}>
          {aposta === undefined
            ? <span style={{ color: 'var(--texto-apagado)' }}>—</span>
            : <><b>{vazas}</b><span style={{ color: 'var(--texto-apagado)' }}>/{aposta}</span></>}
        </span>
      </div>

      {(ausente || condenado || ehHost || puxa) && (
        <div style={{ display: 'flex', gap: 4, fontSize: 9, color: 'var(--texto-fraco)' }}>
          {/* Quem puxa vem primeiro na linha: é o que muda a leitura da mão em
              curso, e gira a cada mão (RJ-065). */}
          {puxa && <span style={{ color: 'var(--acento-claro)' }}>↳ inicia a mão</span>}
          {ehHost && <span>host</span>}
          {ausente && <span style={{ color: 'var(--vidas)' }}>✕ caiu</span>}
          {condenado && <span>☠ já era</span>}
          {jogador.bot && <span>bot</span>}
        </div>
      )}
    </div>
  );
}
