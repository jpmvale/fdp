import { LIMITS } from '@fdp/protocol';
import { CartaoJogador } from '../components/CartaoJogador';
import type { Retrato } from '../state/tipos';

export function Lobby({ retrato, eu, aoIniciar, aoExpulsar }: {
  retrato: Retrato;
  eu: string;
  aoIniciar: () => void;
  aoExpulsar: (playerId: string) => void;
}) {
  const jogadores = retrato.players.filter((p) => !p.isSpectator);
  const souHost = retrato.hostId === eu;
  const suficiente = jogadores.length >= LIMITS.minPlayers;
  const convite = `${location.origin}/?sala=${retrato.code}`;

  return (
    <div className="pilha">
      <div className="cartao pilha" style={{ gap: 10 }}>
        <span className="rotulo">código da sala</span>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <span style={{
            fontFamily: 'ui-monospace, monospace', fontSize: 32, fontWeight: 700,
            letterSpacing: 6, color: 'var(--acento-claro)',
          }}>
            {retrato.code}
          </span>
          <button
            className="fantasma"
            style={{ marginLeft: 'auto' }}
            onClick={() => void navigator.clipboard?.writeText(convite)}
          >
            Copiar convite
          </button>
        </div>
        <p className="fraco">
          Quem receber o link entra direto — sem conta, sem instalar nada.
        </p>
      </div>

      <div className="cartao pilha" style={{ gap: 4 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <span className="rotulo">na mesa</span>
          <span className="fraco">{jogadores.length} de {LIMITS.maxPlayers}</span>
        </div>
        {jogadores.map((p) => (
          <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <CartaoJogador
                jogador={p}
                partida={null}
                souEu={p.id === eu}
                ehHost={retrato.hostId === p.id}
                ausente={false}
              />
            </div>
            {souHost && p.id !== eu && (
              <button
                className="fantasma"
                aria-label={`Expulsar ${p.nickname}`}
                onClick={() => aoExpulsar(p.id)}
                style={{ minWidth: 44, padding: 0 }}
              >
                ✕
              </button>
            )}
          </div>
        ))}
      </div>

      {souHost ? (
        <div className="pilha" style={{ gap: 8 }}>
          <button disabled={!suficiente} onClick={aoIniciar}>Começar a partida</button>
          {!suficiente && (
            <p className="fraco">
              Falta gente: são precisos {LIMITS.minPlayers} para começar.
            </p>
          )}
        </div>
      ) : (
        <div className="cartao" style={{ textAlign: 'center' }}>
          <p className="fraco">
            Esperando {retrato.players.find((p) => p.id === retrato.hostId)?.nickname ?? 'o host'} começar.
          </p>
        </div>
      )}
    </div>
  );
}
