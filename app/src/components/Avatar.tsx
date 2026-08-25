import type { Avatar as AvatarProto } from '@fdp/protocol';

/**
 * Cor E emoji, sempre os dois. A cor sozinha não identifica ninguém (RF-026):
 * a paleta foi otimizada para deuteranopia e protanopia, mas dois canais
 * continuam melhor que um bem escolhido.
 */
export function Avatar({ avatar, tamanho = 34 }: { avatar: AvatarProto; tamanho?: number }) {
  return (
    <span
      aria-hidden
      style={{
        width: tamanho,
        height: tamanho,
        flex: `0 0 ${tamanho}px`,
        borderRadius: tamanho / 3,
        background: `var(--avatar-${avatar.color})`,
        display: 'grid',
        placeItems: 'center',
        fontSize: tamanho * 0.55,
      }}
    >
      {avatar.emoji}
    </span>
  );
}
