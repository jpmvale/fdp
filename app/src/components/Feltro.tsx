import { Avatar } from './Avatar';
import { Carta } from './Carta';
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

      {/* Centro: o estado da MESA, não o de ninguém. */}
      <div style={{
        position: 'absolute', left: 0, right: 0, top: 142,
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3,
        pointerEvents: 'none',
      }}>
        <span className="rotulo" style={{ color: '#7f9ab5' }}>
          {partida.phase === 'APOSTAS' ? 'apostas da mesa' : 'vazas da rodada'}
        </span>
        <span style={{ fontSize: 26, fontWeight: 500, lineHeight: 1 }}>
          {partida.phase === 'APOSTAS' ? somaDeApostas(partida) : vazasFeitas}
          <span style={{ color: '#7f9ab5', fontSize: 16 }}> de {partida.cardsThisRound} vazas</span>
        </span>
        <span style={{ fontSize: 11, color: '#9dbad4' }}>
          {partida.phase === 'APOSTAS'
            ? `${apostaram} de ${total} já apostaram`
            : `vaza ${partida.trickNumber} de ${partida.cardsThisRound}`}
        </span>
      </div>

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
 * Que carta esse assento mostra: a da testa na rodada de 1 carta, a jogada na
 * vaza corrente no resto. `null` quando não há nenhuma — e, no meu assento
 * durante a testa, `null` é o VERSO, porque a carta não chega até aqui
 * (RJ-101).
 */
function cartaDoAssento(partida: PlayerView, id: string, souEu: boolean) {
  if (partida.isForeheadRound) {
    return { mostra: true, carta: souEu ? null : partida.foreheadCards[id] ?? null };
  }
  const jogada = partida.currentTrick?.plays.find((j) => j.playerId === id);
  return jogada ? { mostra: true, carta: jogada.card } : { mostra: false, carta: null };
}

function Assento({ jogador, partida, souEu, ehHost, ausente, x, y, carta }: {
  jogador: PublicPlayer;
  partida: PlayerView;
  souEu: boolean;
  ehHost: boolean;
  ausente: boolean;
  x: number;
  y: number;
  carta: { mostra: boolean; carta: import('@fdp/rules').Card | null };
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
        {/* A carta fica DENTRO do assento, e não solta no feltro.
            Ancorada ao centro da mesa ela ficaria mais bonita, mas com 8
            jogadores em 360 px as cartas cobrem os nomes e o placar do meio —
            e uma mesa ilegível não é fidelidade, é decoração. Aqui não há
            dúvida de quem jogou o quê, em nenhum tamanho de tela. */}
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
        </span>
        <span style={{ fontSize: 12, fontVariantNumeric: 'tabular-nums' }}>
          {aposta === undefined
            ? <span style={{ color: 'var(--texto-apagado)' }}>—</span>
            : <><b>{vazas}</b><span style={{ color: 'var(--texto-apagado)' }}>/{aposta}</span></>}
        </span>
      </div>

      {(ausente || condenado || ehHost) && (
        <div style={{ display: 'flex', gap: 4, fontSize: 9, color: 'var(--texto-fraco)' }}>
          {ehHost && <span>host</span>}
          {ausente && <span style={{ color: 'var(--vidas)' }}>✕ caiu</span>}
          {condenado && <span>☠ já era</span>}
          {jogador.bot && <span>bot</span>}
        </div>
      )}
    </div>
  );
}
