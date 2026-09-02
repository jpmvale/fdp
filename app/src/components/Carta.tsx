import type { Card } from '@fdp/rules';

/**
 * A textura do verso, num lugar só.
 *
 * O contador de cartas na mão, lá no assento, desenha versos de 9 px — e
 * desenhava um gradiente roxo liso, escolhido à parte. Ficavam dois versos
 * diferentes no mesmo jogo: o que a pessoa segura e o que ela vê do
 * adversário. Miniatura do mesmo desenho lê como carta; retângulo colorido lê
 * como barra de progresso.
 *
 * A listra é fina de propósito — 5 px sumiriam num quadrado de 9.
 */
export const VERSO_DA_CARTA =
  'repeating-linear-gradient(45deg,#2a3457,#2a3457 5px,#1f2743 5px,#1f2743 10px)';

export const VERSO_DA_CARTA_MINI =
  'repeating-linear-gradient(45deg,#2a3457,#2a3457 1.5px,#1f2743 1.5px,#1f2743 3px)';

/** Naipe é ILUSTRAÇÃO (RJ-022): não decide vaza nenhuma, só colore a carta. */
const NAIPES: Record<string, string> = {
  copas: '♥', ouros: '♦', espadas: '♠', paus: '♣',
};
const VERMELHOS = new Set(['copas', 'ouros']);

export function Carta({ carta, tamanho = 'media', selecionada, aoClicar, rotulo }: {
  carta: Card | null;
  tamanho?: 'media' | 'pequena' | 'mini' | undefined;
  selecionada?: boolean | undefined;
  aoClicar?: (() => void) | undefined;
  rotulo?: string | undefined;
}) {
  // `mini` existe pela aritmética da mesa cheia: com 8 cartas no centro, a
  // faixa livre entre os assentos laterais tem ~137 px em 360, e 4 cartas de
  // 38 não cabem. Ver `Vaza`.
  const largura = tamanho === 'mini' ? 30 : tamanho === 'pequena' ? 38 : 48;
  const altura = tamanho === 'mini' ? 42 : tamanho === 'pequena' ? 54 : 68;

  const conteudo = carta ? (
    <>
      <span style={{ fontSize: tamanho === 'mini' ? 12 : tamanho === 'pequena' ? 14 : 17, fontWeight: 700, lineHeight: 1 }}>
        {carta.rank}
      </span>
      <span style={{ fontSize: tamanho === 'mini' ? 11 : tamanho === 'pequena' ? 13 : 16, lineHeight: 1 }}>
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
    background: carta ? '#f3f5fe' : VERSO_DA_CARTA,
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
