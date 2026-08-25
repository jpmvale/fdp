import { useState } from 'react';
import type { PlayerView, PublicPlayer } from '../state/tipos';

/**
 * O que aconteceu com as vidas, rodada a rodada.
 *
 * Fica embaixo do chat e sobrevive a recarregar a página, porque sai de
 * `history` — o retrato do servidor — e não de uma pilha que o cliente foi
 * juntando. Quem entra no meio da partida vê o mesmo que quem estava lá desde
 * o começo.
 *
 * **Vida é debitada por RODADA, não por mão.** RJ-090 fecha a conta quando a
 * rodada acaba: `|aposta − mãos feitas|`. Por isso a linha diz "na rodada 3" e
 * não "na rodada 3, mão 2" — não existe a mão em que a vida caiu. O que existe
 * com número de mão é a **condenação** (RJ-008): o instante em que a queda
 * virou inevitável, que o motor grava em `mortoEmVaza`. Essa aparece quando há.
 */
export function Historico({ partida, jogadores, eu }: {
  partida: PlayerView;
  jogadores: PublicPlayer[];
  eu: string;
}) {
  const [aberto, setAberto] = useState(false);
  const nome = (id: string) =>
    id === eu ? 'Você' : jogadores.find((p) => p.id === id)?.nickname ?? '?';

  // Da mais recente para a mais antiga: a pergunta quase sempre é "o que
  // acabou de acontecer", não "como começou".
  const rodadas = [...partida.history].reverse();

  return (
    <div className="cartao" style={{ padding: aberto ? 12 : '2px 12px' }}>
      <button
        onClick={() => setAberto((v) => !v)}
        aria-expanded={aberto}
        style={{
          background: 'transparent', color: 'inherit', padding: 0,
          width: '100%', minHeight: 'var(--toque)', display: 'flex',
          gap: 8, alignItems: 'center', fontWeight: 400,
        }}
      >
        <span aria-hidden>♥</span>
        <span className="rotulo" style={{ flex: 1, textAlign: 'left' }}>vidas perdidas</span>
        {rodadas.length > 0 && (
          <span className="fraco">{rodadas.length} {rodadas.length === 1 ? 'rodada' : 'rodadas'}</span>
        )}
        <span aria-hidden style={{ color: 'var(--texto-apagado)' }}>{aberto ? '⌃' : '⌄'}</span>
      </button>

      {aberto && (
        <div className="pilha" style={{ gap: 10, marginTop: 10, maxHeight: 220, overflowY: 'auto' }}>
          {rodadas.length === 0 && (
            <p className="fraco" style={{ textAlign: 'center', padding: '12px 0' }}>
              Nenhuma rodada fechou ainda.
            </p>
          )}

          {rodadas.map((rodada) => {
            const perdas = partida.playerOrder
              .map((id) => ({ id, perdeu: rodada.livesLost[id] ?? 0, morreu: rodada.mortoEmVaza[id] ?? null }))
              .filter((p) => p.perdeu > 0);
            const caiu = new Set(rodada.eliminatedThisRound);

            return (
              <div key={rodada.roundNumber} className="pilha" style={{ gap: 4 }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
                  <span className="rotulo">
                    rodada {rodada.roundNumber} · {rodada.cardsThisRound}{' '}
                    {rodada.cardsThisRound === 1 ? 'carta' : 'cartas'}
                  </span>
                  {rodada.aborted && <span className="fraco">abortada</span>}
                </div>

                {/* Rodada abortada não debita vida de ninguém (RJ-155). Dizer
                    "ninguém perdeu vida" ali seria verdade por acidente e
                    esconderia o motivo. */}
                {rodada.aborted ? (
                  <p className="fraco">A rodada recomeçou sem quem saiu — ninguém perdeu vida.</p>
                ) : perdas.length === 0 ? (
                  <p className="fraco">Todo mundo acertou a aposta.</p>
                ) : (
                  perdas.map(({ id, perdeu, morreu }) => (
                    <div key={id} style={{ fontSize: 13, lineHeight: 1.5 }}>
                      <b>{nome(id)}</b> perdeu {perdeu} {perdeu === 1 ? 'vida' : 'vidas'}
                      <span style={{ color: 'var(--texto-apagado)' }}>
                        {' '}· apostou {rodada.bets[id] ?? 0}, fez {rodada.tricksWon[id] ?? 0}
                      </span>
                      {morreu !== null && (
                        <span style={{ color: 'var(--texto-fraco)' }}> · já era desde a mão {morreu}</span>
                      )}
                      {caiu.has(id) && (
                        <span style={{ color: 'var(--vidas)', fontWeight: 600 }}> · zerou e saiu</span>
                      )}
                    </div>
                  ))
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
