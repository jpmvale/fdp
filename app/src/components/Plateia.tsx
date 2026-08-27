import { Avatar } from './Avatar';
import { Carta } from './Carta';
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
    .map((id) => ({
      id,
      cartas: partida.allHands[id] ?? [],
      nome: jogadores.find((p) => p.id === id),
    }))
    .filter((l) => l.cartas.length > 0);

  if (linhas.length === 0) return null;

  return (
    <div className="cartao pilha" style={{ gap: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <span className="rotulo">as cartas de todos</span>
        <span className="fraco" style={{ fontSize: 11 }}>você está assistindo</span>
      </div>

      {linhas.map(({ id, cartas, nome }) => (
        <div key={id} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <div style={{ display: 'flex', gap: 5, alignItems: 'center', width: 96, flexShrink: 0 }}>
            {nome && <Avatar avatar={nome.avatar} tamanho={20} />}
            <span style={{
              fontSize: 11, fontWeight: 600,
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            }}>
              {/* A vez de quem é continua marcada aqui: quem assiste acompanha
                  a ordem tanto quanto quem joga. */}
              {partida.activePlayerId === id && (
                <span aria-hidden style={{ color: 'var(--acento)' }}>▸ </span>
              )}
              {nome?.nickname ?? '—'}
            </span>
          </div>

          {/* Rola na horizontal em vez de espremer: sete cartas `mini` são
              210 px, e numa tela de 360 elas não cabem junto do nome. Espremer
              devolveria o mesmo problema que fez este painel existir. */}
          <div style={{ display: 'flex', gap: 3, overflowX: 'auto', paddingBottom: 2 }}>
            {cartas.map((c) => (
              <Carta key={c.id} carta={c} tamanho="mini" rotulo={`${nome?.nickname ?? ''} · ${c.rank}`} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
