import { useEffect, useRef, useState } from 'react';
import type { PublicPlayer } from '../state/tipos';

/**
 * Quantos estão assistindo, e quem são.
 *
 * Quem assiste vê a mão de todo mundo (RJ-159), e isso muda o que é dito na
 * mesa: um palpite no chat vindo de fora vale outra coisa. Quem está jogando
 * precisa **saber que há plateia** sem precisar abrir o chat e reparar numa
 * etiqueta — daí o contador ficar no cabeçalho, ao lado do estado da conexão.
 *
 * O número sozinho não basta ("dois quem?"), e a lista aberta o tempo todo
 * roubaria espaço de algo que quase nunca muda. Então: número sempre, nomes sob
 * demanda.
 */
export function Assistindo({ plateia }: { plateia: PublicPlayer[] }) {
  const [aberto, setAberto] = useState(false);
  const caixa = useRef<HTMLDivElement>(null);

  /**
   * Fecha ao tocar fora, e ao apertar Esc.
   *
   * No celular não existe "tirar o mouse de cima": sem estas duas saídas, a
   * lista aberta por toque só fecharia tocando exatamente no mesmo botão, que
   * é o tipo de coisa que ninguém adivinha.
   */
  useEffect(() => {
    if (!aberto) return;
    const foraDaqui = (e: MouseEvent | TouchEvent): void => {
      if (!caixa.current?.contains(e.target as Node)) setAberto(false);
    };
    const escapou = (e: KeyboardEvent): void => { if (e.key === 'Escape') setAberto(false); };
    document.addEventListener('pointerdown', foraDaqui);
    document.addEventListener('keydown', escapou);
    return () => {
      document.removeEventListener('pointerdown', foraDaqui);
      document.removeEventListener('keydown', escapou);
    };
  }, [aberto]);

  // Ninguém assistindo não vira "0 assistindo": um contador zerado permanente é
  // ruído, e a ausência de plateia é o caso comum.
  if (plateia.length === 0) return null;

  const quantos = plateia.length;
  const rotulo = `${String(quantos)} ${quantos === 1 ? 'pessoa assistindo' : 'pessoas assistindo'}`;

  return (
    <div ref={caixa} style={{ position: 'relative', display: 'flex' }}>
      <button
        className="fantasma"
        onClick={() => setAberto((v) => !v)}
        onMouseEnter={() => setAberto(true)}
        onMouseLeave={() => setAberto(false)}
        aria-expanded={aberto}
        aria-label={`${rotulo}. Toque para ver quem.`}
        style={{
          display: 'flex', gap: 4, alignItems: 'center',
          fontSize: 11, color: 'var(--texto-fraco)',
          minHeight: 'var(--toque)', padding: '0 6px',
          background: 'transparent',
        }}
      >
        <span aria-hidden>👁</span>
        <span aria-hidden style={{ fontVariantNumeric: 'tabular-nums' }}>{quantos}</span>
      </button>

      {aberto && (
        <div
          role="list"
          aria-label="Quem está assistindo"
          style={{
            position: 'absolute', top: '100%', right: 0, marginTop: 2,
            minWidth: 140, maxWidth: 220, padding: '6px 8px',
            borderRadius: 8, zIndex: 12,
            background: 'var(--superficie-2)',
            boxShadow: '0 6px 20px rgba(0,0,0,0.55), inset 0 0 0 1px var(--linha)',
          }}
        >
          <div className="rotulo" style={{ fontSize: 9, marginBottom: 3 }}>assistindo</div>
          {plateia.map((p) => (
            <div
              key={p.id}
              role="listitem"
              style={{
                fontSize: 12, display: 'flex', gap: 5, alignItems: 'center',
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              }}
            >
              <span aria-hidden>{p.avatar.emoji}</span>
              {p.nickname}
            </div>
          ))}
          {/* Diz o que a plateia PODE fazer, e não só quem é: é a informação
              que muda como se lê um palpite vindo do chat (RJ-159). */}
          <div className="fraco" style={{ fontSize: 10, marginTop: 4, whiteSpace: 'normal' }}>
            veem as cartas de todos
          </div>
        </div>
      )}
    </div>
  );
}
