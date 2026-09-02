import { Avatar } from './Avatar';
import { Carta, VERSO_DA_CARTA_MINI } from './Carta';
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

/**
 * Altura do aviso "É A SUA VEZ!", em px do feltro (que tem 372).
 *
 * Foi MEDIDA na mesa cheia, não escolhida. Na coluna do meio — que é onde o
 * aviso fica, centralizado — o espaço está ocupado assim, com 8 jogadores:
 *
 *     4–106    assento de cima do meio (com carta de testa, o caso mais alto)
 *   142–207    o contador do centro, enquanto não há carta na mesa
 *   112–246    as cartas jogadas (`Vaza` começa em 112 e QUEBRA em duas
 *              fileiras a partir de 5 cartas — foi isto que derrubou as duas
 *              primeiras posições que tentei)
 *   290–392    o meu assento
 *
 * Sobra **246 a 290**, e não é coincidência que seja apertado: quando a vez é
 * minha e eu jogo por último, há exatamente 7 cartas na mesa — o caso mais
 * fundo coincide com o único momento em que o aviso aparece. Por isso ele é
 * compacto, e por isso o número é medido e não estimado.
 *
 * Tentei 86 (logo acima das cartas): cabem 6 px. Tentei 226: a segunda fileira
 * de cartas passa por cima.
 *
 * CA-362 defende os quatro lados. Se um assento crescer, se a carta mudar de
 * tamanho, se a fileira quebrar mais cedo ou se o contador ganhar uma linha, o
 * teste cai antes de a mesa ficar embolada na tela de alguém.
 */
export const AVISO_DA_VEZ = 254;

/** Altura do feltro. Sai daqui para o `style` para que o teste use a mesma. */
export const ALTURA_DO_FELTRO = 372;

/** Altura do aviso: 2+2 de respiro, 15 de linha, 1,5+1,5 de borda. Medida. */
export const ALTURA_DO_AVISO = 22;

/**
 * O que ocupa a coluna do meio, MEDIDO na mesa de 8 em 360 px.
 *
 * Não sai de cálculo — sai de `getBoundingClientRect` com a mesa cheia. Está
 * aqui para o teste poder cobrar, e para que quem mexer em assento, carta ou
 * contador tenha onde atualizar o número junto.
 */
export const OCUPADO = {
  /** Assentos de cima, com carta de testa (o caso mais alto). */
  assentosDeCima: { de: 4, ate: 106 },
  /** Cartas jogadas: `Vaza` começa em 112 e quebra fileira a partir de 5. */
  cartasNaMesa: { de: 112, ate: 246 },
  /** O contador do centro, enquanto não há carta na mesa. */
  contadorDoCentro: { de: 142, ate: 207 },
} as const;

/** O pano, em px do feltro: `left/right 54, top 8, bottom 30`. */
export const PANO = { de: 8, ate: ALTURA_DO_FELTRO - 30 } as const;

/** Onde o meu assento começa — sou sempre o índice 0 de `posicoes`. */
export function topoDoMeuAssento(total: number): number {
  return (posicoes(total)[0]!.y / 100) * ALTURA_DO_FELTRO - 22;
}

export function Feltro({ retrato, eu, partida, aoAbrirPerfil }: {
  retrato: Retrato;
  eu: string;
  partida: PlayerView;
  /** Abre o perfil de quem tem conta. Convidado e bot não têm o que abrir. */
  aoAbrirPerfil?: ((slug: string) => void) | undefined;
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

  // Mesa parada não tem vez de ninguém: acender o feltro enquanto se espera
  // alguém reconectar mandaria jogar quem não pode jogar.
  const minhaVez = partida.activePlayerId === eu && retrato.status !== 'PAUSADA';

  return (
    <div style={{ position: 'relative', height: ALTURA_DO_FELTRO, marginTop: 4 }}>
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

      {/* A mesa inteira acende na sua vez.

          Sobre o pano e sob todo o resto: é moldura, não conteúdo, e não pode
          disputar leitura com carta, nome ou vidas. A geometria é a MESMA do
          pano acima — se um dia a elipse mudar, as duas mudam juntas ou a
          borda descola do feltro. */}
      {minhaVez && (
        <div
          aria-hidden
          className="vez-borda"
          style={{
            position: 'absolute',
            left: 54, right: 54, top: 8, bottom: 30,
            borderRadius: '50% / 32%',
            pointerEvents: 'none',
            zIndex: 1,
          }}
        />
      )}

      {/* E o aviso escrito, logo acima das cartas.

          A borda diz "alguma coisa é com você"; só o texto diz o quê. Vale
          para quem não distingue o vermelho, para quem joga no mudo, e para
          quem olhou a tela agora e não viu a transição — RNF-031 de novo: o
          aviso tem quatro canais e nenhum deles é obrigatório.

          `aria-live="polite"` porque isto é mudança de estado do jogo
          (RNF-035); "polite" e não "assertive" porque a vez pode esperar o
          leitor de tela terminar a frase — não é erro. */}
      {minhaVez && (
        <div
          role="status"
          aria-live="polite"
          className="vez-aviso"
          style={{
            position: 'absolute',
            top: AVISO_DA_VEZ, left: '50%', transform: 'translateX(-50%)',
            padding: '2px 11px',
            borderRadius: 999,
            border: '1.5px solid var(--vidas)',
            background: 'rgba(8,14,23,0.94)',
            color: 'var(--vidas)',
            fontSize: 11, fontWeight: 700, letterSpacing: '.08em', lineHeight: '15px',
            whiteSpace: 'nowrap',
            pointerEvents: 'none',
            zIndex: 5,
          }}
        >
          É A SUA VEZ!
        </div>
      )}

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
              aoAbrirPerfil={aoAbrirPerfil}
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
export function posicoes(total: number): { x: number; y: number }[] {
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

function Assento({ jogador, partida, souEu, ehHost, ausente, x, y, carta, perdeu, puxa, aoAbrirPerfil }: {
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
  aoAbrirPerfil?: ((slug: string) => void) | undefined;
}) {
  const vez = partida.activePlayerId === jogador.id;
  const condenado = partida.mortoEmVaza?.[jogador.id] != null;
  const aposta = partida.bets[jogador.id];
  const vazas = partida.tricksWon[jogador.id] ?? 0;
  const vidas = partida.lives[jogador.id] ?? 0;
  const naMao = partida.handCounts[jogador.id] ?? 0;

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
        {/* Com conta, o nome vira o botão do perfil (D-4). Sem conta não há
            o que abrir, e um nome que parece clicável e não abre nada é pior
            que um nome comum — por isso o `<span>` continua existindo. */}
        {jogador.conta && aoAbrirPerfil ? (
          <button
            className="fantasma"
            onClick={() => aoAbrirPerfil(jogador.conta!)}
            aria-label={`Ver o perfil de ${jogador.nickname}`}
            style={{
              all: 'unset', cursor: 'pointer',
              fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap',
              overflow: 'hidden', textOverflow: 'ellipsis',
              textDecoration: 'underline', textDecorationStyle: 'dotted',
              textUnderlineOffset: 3, textDecorationColor: 'var(--texto-apagado)',
            }}
          >
            {vez && <span aria-hidden style={{ color: 'var(--acento)' }}>▸ </span>}
            {souEu ? 'você' : jogador.nickname}
          </button>
        ) : (
          <span style={{
            fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap',
            overflow: 'hidden', textOverflow: 'ellipsis',
          }}>
            {vez && <span aria-hidden style={{ color: 'var(--acento)' }}>▸ </span>}
            {souEu ? 'você' : jogador.nickname}
          </span>
        )}
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span
          // Gancho da suíte E2E (CA-040, CA-041): só no MEU assento, para o
          // teste comparar as minhas vidas antes e depois de uma queda sem
          // depender de posição na mesa — que muda com o número de jogadores.
          {...(souEu ? { 'data-minhas-vidas': true } : {})}
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

      <CartasNaMao quantas={naMao} nome={souEu ? 'você' : jogador.nickname} />

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

/**
 * Quantas cartas a pessoa ainda tem na mão, em cartas viradas.
 *
 * A informação já existia — `handCounts` vem na projeção, e é pública por
 * RJ-102 — mas não estava em lugar nenhum da mesa. Quem quisesse saber quantas
 * cartas ainda restam ao adversário tinha de contar as mãos já jogadas de
 * cabeça, no meio de uma rodada, que é exatamente o tipo de conta que `07` §2.4
 * pede para a tela fazer pela pessoa.
 *
 * **Viradas, e do tamanho do coração.** Viradas porque o conteúdo é segredo
 * (RJ-102) e uma carta desenhada de frente prometeria uma informação que não
 * existe; do tamanho do coração porque a linha de baixo do assento é uma linha
 * de contadores, e um deles maior que os outros roubaria a leitura.
 */
function CartasNaMao({ quantas, nome }: { quantas: number; nome: string }) {
  // Zero não vira uma linha vazia: no fim da rodada todo mundo fica sem cartas
  // ao mesmo tempo, e oito espaços em branco piscando é ruído puro.
  if (quantas <= 0) return null;

  /**
   * Acima de cinco vira número, como as vidas.
   *
   * Sete cartas desenhadas lado a lado não cabem nos 84 px do assento sem
   * virar uma tira ilegível — e "sete" se lê mais rápido que sete retângulos
   * que precisam ser contados. É a mesma regra do `♥×6` logo acima, e ser a
   * mesma é metade do valor: a linha inteira se lê do mesmo jeito.
   */
  const desenhadas = quantas <= 5;

  return (
    <div
      // Sem `gap`: as cartas se sobrepõem, e o espaçamento é o `marginLeft`
      // negativo de cada uma. A altura NÃO muda — o assento é medido, e crescer
      // aqui moveria a geometria que CA-362 defende.
      style={{ display: 'flex', alignItems: 'center', height: 12 }}
      aria-label={`${nome}: ${String(quantas)} ${quantas === 1 ? 'carta na mão' : 'cartas na mão'}`}
    >
      {desenhadas ? (
        Array.from({ length: quantas }, (_, i) => <Verso key={i} primeira={i === 0} />)
      ) : (
        <>
          <Verso primeira />
          <span aria-hidden style={{ fontSize: 10, color: 'var(--texto-fraco)' }}>
            ×{quantas}
          </span>
        </>
      )}
    </div>
  );
}

/** O verso de uma carta: 8×11, a proporção de um baralho de verdade. */
/**
 * Uma carta virada em miniatura.
 *
 * Era um retângulo com gradiente roxo liso, e lia como barra de progresso, não
 * como carta. Agora é a MESMA textura do verso grande (`VERSO_DA_CARTA_MINI`),
 * com listra proporcionalmente mais fina para aparecer em 9 px — dois versos
 * diferentes no mesmo jogo era a raiz do problema.
 *
 * As três coisas que fazem ler como carta, e nenhuma é enfeite: a textura
 * diagonal (que é o desenho do baralho), a borda clara (que é a **margem
 * branca** de uma carta de verdade, o detalhe que o olho usa para reconhecer
 * uma), e a sobreposição, porque mão de cartas fica em leque e não em fileira
 * espaçada.
 */
function Verso({ primeira }: { primeira: boolean }) {
  return (
    <span
      aria-hidden
      style={{
        width: 9,
        height: 12,
        borderRadius: 1.5,
        background: VERSO_DA_CARTA_MINI,
        // Margem clara por fora e sombra por baixo: é o que separa uma carta
        // da carta atrás dela num leque, e o que impede a fileira de virar um
        // borrão listrado.
        boxShadow: 'inset 0 0 0 0.5px rgba(226,232,255,0.55), -1px 0 1px rgba(0,0,0,0.45)',
        display: 'block',
        flexShrink: 0,
        // Sobrepostas como um leque. Ainda contáveis: sobram 6 px de cada
        // carta à vista, e são no máximo cinco.
        marginLeft: primeira ? 0 : -3,
      }}
    />
  );
}
