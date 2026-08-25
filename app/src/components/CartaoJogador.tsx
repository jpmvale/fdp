import { Avatar } from './Avatar';
import { Vidas } from './Vidas';
import type { PlayerView, PublicPlayer } from '../state/tipos';

/**
 * O elemento mais consultado do jogo. Tudo que ele diz precisa ser legível de
 * relance, em 360 px, com oito deles na tela.
 */
export function CartaoJogador({ jogador, partida, souEu, ehHost, ausente }: {
  jogador: PublicPlayer;
  partida: PlayerView | null;
  souEu: boolean;
  ehHost: boolean;
  ausente: boolean;
}) {
  const vez = partida?.activePlayerId === jogador.id;
  const condenado = partida?.mortoEmVaza?.[jogador.id] != null;
  const aposta = partida?.bets?.[jogador.id];
  const vazas = partida?.tricksWon?.[jogador.id] ?? 0;
  const vidas = partida?.lives?.[jogador.id] ?? 0;

  return (
    <div
      style={{
        display: 'flex',
        gap: 10,
        alignItems: 'center',
        padding: '9px 10px',
        borderRadius: 'var(--r-md)',
        background: vez ? 'rgba(145,132,217,0.12)' : 'transparent',
        // A vez tem borda E seta, nunca só cor (RF-026).
        boxShadow: vez ? 'inset 0 0 0 1px var(--acento)' : 'inset 0 0 0 1px transparent',
        opacity: condenado ? 0.55 : 1,
      }}
    >
      <Avatar avatar={jogador.avatar} />

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          {vez && <span aria-hidden style={{ color: 'var(--acento)' }}>▸</span>}
          <span style={{
            fontWeight: 600,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}>
            {jogador.nickname}{souEu ? ' · você' : ''}
          </span>
          {ehHost && <Etiqueta>host</Etiqueta>}
          {ausente && <Etiqueta tom="alerta">✕ caiu</Etiqueta>}
        </div>

        {partida && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 }}>
            <Vidas quantas={vidas} />
            {aposta !== undefined ? (
              // `2/3` é A informação da tela: vazas ganhas contra aposta, sem
              // conta mental.
              <span style={{ fontVariantNumeric: 'tabular-nums' }}>
                <b>{vazas}</b>
                <span style={{ color: 'var(--texto-apagado)' }}>/{aposta}</span>
              </span>
            ) : (
              <span style={{ color: 'var(--texto-apagado)' }}>—</span>
            )}
          </div>
        )}
      </div>

      {condenado && <Etiqueta tom="morte">☠ já era</Etiqueta>}
    </div>
  );
}

function Etiqueta({ children, tom }: { children: React.ReactNode; tom?: 'alerta' | 'morte' }) {
  const cor = tom === 'alerta' ? 'var(--vidas)' : tom === 'morte' ? 'var(--texto-medio)' : 'var(--texto-fraco)';
  return (
    <span style={{
      fontSize: 10,
      letterSpacing: 0.04,
      textTransform: 'uppercase',
      padding: '2px 6px',
      borderRadius: 5,
      background: 'rgba(255,255,255,0.06)',
      color: cor,
      whiteSpace: 'nowrap',
    }}>
      {children}
    </span>
  );
}
