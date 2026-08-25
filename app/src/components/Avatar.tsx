import type { Avatar as AvatarProto } from '@fdp/protocol';

/**
 * Cor E emoji, sempre os dois. A cor sozinha não identifica ninguém (RF-026).
 *
 * A paleta é verificada sob deuteranopia e protanopia por CA-344 — e foi o
 * emoji que segurou a mesa enquanto ela não era: `lime` e `orange` ficaram um
 * tempo indistinguíveis para quem tem deuteranopia sem que ninguém notasse.
 * Dois canais não são redundância; são o que faz um erro no outro ser
 * recuperável.
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
