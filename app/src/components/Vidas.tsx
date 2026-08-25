/**
 * Vidas como ícone repetido, não número solto: ♥♥♥ se lê de relance, "3" exige
 * leitura. Acima de 5 o desenho vira `♥ ×N` — oito corações em 360 px não cabem
 * sem virar mancha.
 */
export function Vidas({ quantas }: { quantas: number }) {
  if (quantas <= 0) {
    return <span style={{ color: 'var(--texto-apagado)' }} aria-label="sem vidas">☠</span>;
  }
  const rotulo = `${quantas} ${quantas === 1 ? 'vida' : 'vidas'}`;
  if (quantas > 5) {
    return (
      <span style={{ color: 'var(--vidas)', fontVariantNumeric: 'tabular-nums' }} aria-label={rotulo}>
        ♥ ×{quantas}
      </span>
    );
  }
  return (
    <span style={{ color: 'var(--vidas)', letterSpacing: 1 }} aria-label={rotulo}>
      {'♥'.repeat(quantas)}
    </span>
  );
}
