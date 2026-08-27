import { Avatar } from './Avatar';
import { Carta } from './Carta';
import { cartasDoJogador } from '../plateia';
import type { PlayerView, PublicPlayer } from '../state/tipos';

/**
 * A mesa aberta, para quem está assistindo (RJ-159).
 *
 * **Por que um painel e não as cartas no assento.** O assento tem 84 px e uma
 * carta `mini` tem 30: três cabem, sete não. Sobrepô-las em leque deixaria uns
 * 10 px visíveis de cada uma, que não é largura para ler um naipe — e o
 * espectador é justamente quem está ali para acompanhar as cartas.
 *
 * O feltro fica **idêntico** ao de quem joga, e isso é metade da ideia: quem
 * assiste vê a mesma partida que os outros veem, mais um painel. Se as cartas
 * aparecessem nos assentos, o espectador e o jogador estariam olhando para
 * duas mesas diferentes, e comentar uma jogada ficaria confuso para os dois.
 */
export function Plateia({ partida, jogadores }: {
  partida: PlayerView;
  jogadores: PublicPlayer[];
}) {
  // Só para quem assiste, e só quando há o que mostrar. Para quem joga,
  // `allHands` chega VAZIO do servidor — não é a tela que esconde.
  if (!partida.isSpectator) return null;

  // A ordem é a da mesa, e não a do objeto: `playerOrder` é a ordem em que se
  // joga, e é por ela que a pessoa acompanha quem vem depois de quem.
  const linhas = partida.playerOrder
    .map((id) => ({ id, ...cartasDoJogador(partida, id), nome: jogadores.find((p) => p.id === id) }))
    .filter((l) => l.naMao.length > 0 || l.jogadas.length > 0);

  if (linhas.length === 0) return null;

  return (
    <div className="cartao pilha" style={{ gap: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <span className="rotulo">as cartas de todos</span>
        <span className="fraco" style={{ fontSize: 11 }}>
          na mão · <span style={{ opacity: 0.45 }}>jogadas</span>
        </span>
      </div>

      {linhas.map(({ id, naMao, jogadas, nome }) => (
        <div key={id} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {/* 120 px, e não 96: em 96 o "2 na mão · 2 jogadas" saía cortado no
              meio da palavra, que é pior que não ter contador nenhum — um
              número truncado convida a ler errado. As cartas ao lado rolam,
              então a largura sai de onde não custa. */}
          <div style={{ display: 'flex', gap: 5, alignItems: 'center', width: 120, flexShrink: 0 }}>
            {nome && <Avatar avatar={nome.avatar} tamanho={20} />}
            <div style={{ minWidth: 0 }}>
              <div style={{
                fontSize: 11, fontWeight: 600,
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              }}>
                {/* A vez de quem é continua marcada aqui: quem assiste acompanha
                    a ordem tanto quanto quem joga. */}
                {partida.activePlayerId === id && (
                  <span aria-hidden style={{ color: 'var(--acento)' }}>▸ </span>
                )}
                {nome?.nickname ?? '—'}
              </div>
              {/* A conta em números, para não depender de contar retângulos. */}
              <div className="fraco" style={{ fontSize: 9, whiteSpace: 'nowrap' }}>
                {naMao.length} na mão · {jogadas.length} {jogadas.length === 1 ? 'jogada' : 'jogadas'}
              </div>
            </div>
          </div>

          {/* Rola na horizontal em vez de espremer: sete cartas `mini` são
              210 px, e numa tela de 360 elas não cabem junto do nome. Espremer
              devolveria o mesmo problema que fez este painel existir. */}
          <div style={{ display: 'flex', gap: 3, overflowX: 'auto', paddingBottom: 2, alignItems: 'center' }}>
            {/* O que AINDA dá para fazer vem primeiro, e é a informação que
                interessa a quem acompanha: o que já saiu é história. */}
            {naMao.map((c) => (
              <Carta key={c.id} carta={c} tamanho="mini" rotulo={`${nome?.nickname ?? ''} · ${c.rank} · na mão`} />
            ))}

            {jogadas.length > 0 && naMao.length > 0 && (
              // Separador, e não só a opacidade: opacidade sozinha some numa
              // tela clara, e "meio apagado" não diz o que a diferença
              // significa (`08` §2 — nunca só a cor).
              <span aria-hidden style={{
                width: 1, alignSelf: 'stretch', margin: '0 3px',
                background: 'var(--linha)', flexShrink: 0,
              }} />
            )}

            {jogadas.map(({ carta, mao }) => (
              <span key={carta.id} style={{ position: 'relative', display: 'block', flexShrink: 0 }}>
                <span style={{ display: 'block', opacity: 0.4, filter: 'saturate(0.5)' }}>
                  <Carta
                    carta={carta}
                    tamanho="mini"
                    rotulo={`${nome?.nickname ?? ''} · ${carta.rank} · jogada na mão ${String(mao)}`}
                  />
                </span>
                {/* O número da mão em que ela saiu. É o que responde "quando",
                    e sem ele as jogadas viram um monte indistinto assim que
                    passam de duas. */}
                <span
                  aria-hidden
                  style={{
                    position: 'absolute', top: -2, right: -2,
                    fontSize: 8, lineHeight: 1, padding: '1px 2px',
                    borderRadius: 3, fontVariantNumeric: 'tabular-nums',
                    background: 'var(--superficie-2)', color: 'var(--texto-fraco)',
                    boxShadow: 'inset 0 0 0 1px var(--linha)',
                  }}
                >
                  {mao}
                </span>
              </span>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
