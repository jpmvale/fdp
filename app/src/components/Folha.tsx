/**
 * A folha: a sobreposição de tela cheia que o ☰ e as regras usam.
 *
 * Existe para haver UMA casca de diálogo. O menu da mesa e as regras na home
 * mostram conteúdos diferentes, mas são a mesma coisa para quem usa — cobre a
 * tela, rola sozinha, fecha no ✕ — e duas implementações disso divergem na
 * primeira correção de acessibilidade que alguém fizer só num dos lados.
 */
export function Folha({ rotulo, cabecalho, aoFechar, children }: {
  rotulo: string;
  /** Vai à esquerda do ✕, na faixa que gruda no topo. Abas, título, o que for. */
  cabecalho?: React.ReactNode;
  aoFechar: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={rotulo}
      style={{
        position: 'fixed', inset: 0, zIndex: 15,
        background: 'var(--fundo)',
        overflowY: 'auto',
        padding: '0 12px calc(24px + env(safe-area-inset-bottom))',
      }}
    >
      <div style={{ maxWidth: 460, margin: '0 auto' }} className="pilha">
        <div style={{
          position: 'sticky', top: 0, zIndex: 2,
          background: 'var(--fundo)', paddingTop: 12,
        }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <div style={{ flex: 1, minWidth: 0 }}>{cabecalho}</div>
            <button
              className="fantasma"
              onClick={aoFechar}
              aria-label="Fechar"
              style={{ minWidth: 44, width: 44, padding: 0 }}
            >
              ✕
            </button>
          </div>
          <div style={{ height: 12 }} />
        </div>

        {children}
      </div>
    </div>
  );
}
