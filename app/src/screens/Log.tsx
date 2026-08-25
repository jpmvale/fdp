import type { PlayerView, Retrato } from '../state/tipos';

/**
 * Log da partida (RF-016): o que aconteceu, da rodada atual para trás.
 *
 * É montado a partir do RETRATO, e não de uma pilha de eventos acumulada no
 * cliente. A diferença aparece no pior momento: recarregar a página, cair a
 * rede, entrar como espectador no meio. Uma pilha local começaria vazia nos
 * três casos, e o log ficaria mentindo por omissão justamente para quem mais
 * precisa saber o que perdeu. O retrato vem do servidor, que é a autoridade —
 * e chega inteiro em toda reconexão.
 *
 * A ordem é do mais recente para o mais antigo: no meio de uma partida, "o que
 * acabou de acontecer" é a pergunta, e ela não pode custar rolagem.
 */
export function Log({ retrato, partida }: { retrato: Retrato; partida: PlayerView | null }) {
  if (!partida) {
    return (
      <p className="fraco" style={{ padding: '20px 4px', textAlign: 'center' }}>
        A partida ainda não começou. Aqui vai ficar tudo o que rolar nela.
      </p>
    );
  }

  const nome = (id: string | null | undefined) =>
    retrato.players.find((p) => p.id === id)?.nickname ?? 'alguém';

  const vazasDaRodada = [...partida.resolvedTricks].reverse();
  const rodadasAnteriores = [...partida.history].reverse();

  return (
    <div className="pilha" style={{ gap: 12 }}>
      {/* A rodada em curso primeiro, e ela não tem resumo ainda — tem o que já
          aconteceu dentro dela. */}
      <section className="cartao pilha" style={{ gap: 8 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <span className="rotulo">rodada {partida.roundNumber} · agora</span>
          <span className="fraco">
            {partida.cardsThisRound} {partida.cardsThisRound === 1 ? 'carta' : 'cartas'}
          </span>
        </div>

        {Object.keys(partida.bets).length > 0 && (
          <Linha>
            <b>Apostas:</b>{' '}
            {partida.playerOrder
              .filter((id) => partida.bets[id] !== undefined)
              .map((id) => `${nome(id)} ${partida.bets[id]}`)
              .join(' · ')}
          </Linha>
        )}

        {vazasDaRodada.map((vaza, i) => {
          const numero = vazasDaRodada.length - i;
          const cartas = vaza.plays
            .map((j) => `${nome(j.playerId)} ${j.card.rank}`)
            .join(', ');
          return (
            <Linha key={numero}>
              <b>Vaza {numero}:</b> {cartas}.{' '}
              {vaza.annulledValue !== null
                ? <span style={{ color: 'var(--texto-medio)' }}>Empate em {vaza.annulledValue} — de ninguém.</span>
                : <span style={{ color: 'var(--texto-medio)' }}>{nome(vaza.winnerId)} levou.</span>}
            </Linha>
          );
        })}

        {vazasDaRodada.length === 0 && Object.keys(partida.bets).length === 0 && (
          <Linha><span className="fraco">Ainda não rolou nada nesta rodada.</span></Linha>
        )}
      </section>

      {rodadasAnteriores.map((rodada) => {
        const jogadores = partida.playerOrder.filter((id) => rodada.bets[id] !== undefined);
        return (
          <section key={rodada.roundNumber} className="cartao pilha" style={{ gap: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <span className="rotulo">rodada {rodada.roundNumber}</span>
              <span className="fraco">
                {rodada.aborted
                  ? 'abortada'
                  : `${rodada.cardsThisRound} ${rodada.cardsThisRound === 1 ? 'carta' : 'cartas'}`}
              </span>
            </div>

            {rodada.aborted ? (
              <Linha>
                <span className="fraco">
                  Alguém saiu no meio: a rodada foi refeita e ninguém perdeu vida.
                </span>
              </Linha>
            ) : (
              jogadores.map((id) => {
                const apostou = rodada.bets[id] ?? 0;
                const fez = rodada.tricksWon[id] ?? 0;
                const perdeu = rodada.livesLost[id] ?? 0;
                return (
                  <div key={id} style={{ display: 'flex', gap: 8, alignItems: 'baseline', fontSize: 13 }}>
                    <span style={{ flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {nome(id)}
                    </span>
                    <span style={{ color: 'var(--texto-fraco)' }}>
                      apostou {apostou} · fez {fez}
                    </span>
                    <span style={{
                      color: perdeu > 0 ? 'var(--vidas)' : 'var(--texto-medio)',
                      minWidth: 34, textAlign: 'right', fontWeight: 600,
                    }}>
                      {perdeu > 0 ? `−${perdeu}` : '✓'}
                    </span>
                  </div>
                );
              })
            )}

            {rodada.annulledTricks > 0 && (
              <Linha>
                <span className="fraco">
                  {rodada.annulledTricks === 1
                    ? '1 vaza empatou e não foi de ninguém.'
                    : `${rodada.annulledTricks} vazas empataram e não foram de ninguém.`}
                </span>
              </Linha>
            )}

            {rodada.eliminatedThisRound.length > 0 && (
              <div style={{
                display: 'flex', gap: 6, alignItems: 'center',
                padding: '6px 10px', borderRadius: 'var(--r-sm)',
                background: 'rgba(239,77,90,0.12)',
                boxShadow: 'inset 0 0 0 1px var(--vidas)', fontSize: 12,
              }}>
                <span aria-hidden>☠</span>
                <span>
                  {rodada.eliminatedThisRound.map(nome).join(' e ')} zerou as vidas nesta rodada.
                </span>
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}

function Linha({ children }: { children: React.ReactNode }) {
  return (
    <p style={{ fontSize: 13, lineHeight: 1.6, color: 'var(--texto-medio)', textWrap: 'pretty' }}>
      {children}
    </p>
  );
}
