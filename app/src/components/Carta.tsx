import type { Card } from '@fdp/rules';

/** Naipe é ILUSTRAÇÃO (RJ-022): não decide vaza nenhuma, só colore a carta. */
const NAIPES: Record<string, string> = {
  copas: '♥', ouros: '♦', espadas: '♠', paus: '♣',
};
const VERMELHOS = new Set(['copas', 'ouros']);

export function Carta({ carta, tamanho = 'media', selecionada, aoClicar, rotulo }: {
  carta: Card | null;
  tamanho?: 'media' | 'pequena' | undefined;
  selecionada?: boolean | undefined;
  aoClicar?: (() => void) | undefined;
  rotulo?: string | undefined;
}) {
  const largura = tamanho === 'pequena' ? 38 : 48;
  const altura = tamanho === 'pequena' ? 54 : 68;

  const conteudo = carta ? (
    <>
      <span style={{ fontSize: tamanho === 'pequena' ? 14 : 17, fontWeight: 700, lineHeight: 1 }}>
        {carta.rank}
      </span>
      <span style={{ fontSize: tamanho === 'pequena' ? 13 : 16, lineHeight: 1 }}>
        {NAIPES[carta.suit]}
      </span>
    </>
  ) : (
    // Verso: NENHUM valor aqui, nem em atributo, nem escondido por CSS
    // (RF-035). É a regra mais fácil de quebrar sem perceber.
    <span aria-hidden style={{ fontSize: 20, color: '#8e97c8' }}>?</span>
  );

  const estilo: React.CSSProperties = {
    width: largura,
    height: altura,
    borderRadius: 8,
    display: 'grid',
    placeContent: 'center',
    padding: 0,
    border: 0,
    background: carta
      ? '#f3f5fe'
      : 'repeating-linear-gradient(45deg,#2a3457,#2a3457 5px,#1f2743 5px,#1f2743 10px)',
    color: carta && VERMELHOS.has(carta.suit) ? '#d1263c' : '#16181f',
    transform: selecionada ? 'translateY(-8px)' : undefined,
    boxShadow: selecionada ? '0 0 0 3px var(--acento)' : undefined,
    transition: 'transform 120ms ease',
    minHeight: 0,
    cursor: aoClicar ? 'pointer' : 'default',
  };

  const texto = carta ? `${carta.rank} de ${carta.suit}` : 'carta virada';

  if (!aoClicar) return <div style={estilo} role="img" aria-label={rotulo ?? texto}>{conteudo}</div>;

  return (
    <button
      type="button"
      onClick={aoClicar}
      aria-pressed={selecionada}
      aria-label={rotulo ?? texto}
      style={estilo}
    >
      {conteudo}
    </button>
  );
}
