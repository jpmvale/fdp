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
        // A cor fica MESMO com imagem: é o anel de identificação da mesa
        // (`07` §4) e o que aparece enquanto a foto carrega. Sem ela, um
        // avatar de imagem seria um buraco cinza até a rede responder.
        background: `var(--avatar-${avatar.color})`,
        display: 'grid',
        placeItems: 'center',
        fontSize: tamanho * 0.55,
        overflow: 'hidden',
        position: 'relative',
      }}
    >
      {avatar.emoji}
      {avatar.imagem && (
        <img
          src={tamanho <= 64 ? avatar.imagem.replace(/\.webp$/, '-64.webp') : avatar.imagem}
          alt=""
          width={tamanho}
          height={tamanho}
          loading="lazy"
          decoding="async"
          /* Some se a imagem falhar, e o emoji embaixo reaparece. Sem isto, o
             ícone quebrado do navegador tomaria o lugar do avatar. */
          onError={(e) => { e.currentTarget.style.display = 'none'; }}
          style={{
            position: 'absolute', inset: 0,
            width: '100%', height: '100%', objectFit: 'cover',
          }}
        />
      )}
    </span>
  );
}
