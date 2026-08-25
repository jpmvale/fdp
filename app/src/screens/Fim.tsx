import { Avatar } from '../components/Avatar';
import { Vidas } from '../components/Vidas';
import type { Retrato, PlayerView } from '../state/tipos';

const MOTIVOS: Record<string, string> = {
  LAST_STANDING: 'Último de pé.',
  ALL_ELIMINATED: 'Todo mundo caiu na mesma rodada — vence quem tinha mais vidas antes.',
  ROUNDS_EXHAUSTED: 'As rodadas acabaram.',
  HOST_ENDED: 'O host encerrou a partida.',
  ABANDONED: 'A mesa esvaziou.',
};

export function Fim({ retrato, eu, partida, aoRevanche }: {
  retrato: Retrato;
  eu: string;
  partida: PlayerView;
  aoRevanche: () => void;
}) {
  const vencedores = partida.winnerIds ?? [];
  const souHost = retrato.hostId === eu;
  const saiu = new Set(partida.withdrawn.map((w) => w.playerId));

  // Quem abandonou fica ABAIXO de todos (RJ-129), independente das vidas com
  // que saiu: sair não pode ser um jeito de terminar melhor.
  const ordem = [...partida.playerOrder].sort((a, b) => {
    if (saiu.has(a) !== saiu.has(b)) return saiu.has(a) ? 1 : -1;
    return (partida.lives[b] ?? 0) - (partida.lives[a] ?? 0);
  });

  return (
    <div className="pilha">
      <div className="cartao pilha" style={{ gap: 8, textAlign: 'center', padding: 20 }}>
        <span className="rotulo">fim de partida</span>
        <div style={{ fontSize: 28, fontWeight: 500 }}>
          {vencedores.length === 0
            ? 'Sem vencedor'
            : vencedores.map((id) => retrato.players.find((p) => p.id === id)?.nickname ?? '?').join(' e ')}
        </div>
        <p className="fraco">{MOTIVOS[partida.endReason ?? ''] ?? partida.endReason}</p>
      </div>

      <div className="cartao pilha" style={{ gap: 4 }}>
        <span className="rotulo">classificação</span>
        {ordem.map((id, i) => {
          const jogador = retrato.players.find((p) => p.id === id);
          if (!jogador) return null;
          return (
            <div key={id} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '8px 4px' }}>
              <span style={{
                width: 20, textAlign: 'right', color: 'var(--texto-apagado)',
                fontVariantNumeric: 'tabular-nums',
              }}>
                {i + 1}
              </span>
              <Avatar avatar={jogador.avatar} tamanho={28} />
              <span style={{ flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {jogador.nickname}{id === eu ? ' · você' : ''}
              </span>
              {saiu.has(id)
                ? <span className="fraco">abandonou</span>
                : <Vidas quantas={partida.lives[id] ?? 0} />}
            </div>
          );
        })}
      </div>

      {souHost
        ? <button onClick={aoRevanche}>Revanche com o mesmo grupo</button>
        : <p className="fraco" style={{ textAlign: 'center' }}>O host pode pedir revanche.</p>}
    </div>
  );
}
