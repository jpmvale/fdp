import { useState } from 'react';
import {
  AVATAR_COLORS, AVATAR_EMOJIS, NICKNAME_MAX, NICKNAME_MIN,
  type Avatar as AvatarProto,
} from '@fdp/protocol';
import { Avatar } from '../components/Avatar';
import type { PublicPlayer } from '../state/tipos';

/**
 * Perfil: quem você é na mesa.
 *
 * Serve duas situações com a mesma tela — antes de entrar (escolhendo como
 * chegar) e já dentro da sala (trocando de ideia). A diferença é o botão e o
 * fato de que, dentro da sala, dá para saber quais cores já são de alguém.
 */
export function Perfil({ inicial, jaNaMesa, aoConfirmar, aoVoltar }: {
  inicial?: { nickname: string; avatar: AvatarProto } | undefined;
  /** Quem já está na sala, para não escolher a cara de outro. */
  jaNaMesa?: PublicPlayer[] | undefined;
  aoConfirmar: (nickname: string, avatar: AvatarProto) => void;
  aoVoltar: () => void;
}) {
  const [apelido, setApelido] = useState(
    inicial?.nickname ?? localStorage.getItem('fdp.apelido') ?? '',
  );
  const [cor, setCor] = useState<string>(inicial?.avatar.color ?? AVATAR_COLORS[0]);
  const [emoji, setEmoji] = useState<string>(inicial?.avatar.emoji ?? AVATAR_EMOJIS[0]);

  const avatar = { emoji, color: cor } as AvatarProto;
  const limpo = apelido.trim();
  const valido = limpo.length >= NICKNAME_MIN;

  // Cor de outra pessoa não é proibida pelo servidor — ele reacomoda quem
  // colidir. Mas escolher a cara de alguém que está na mesa é uma má ideia com
  // consequência prática: dois avatares iguais destroem o "de relance".
  const donoDaCor = (c: string) =>
    (jaNaMesa ?? []).find((p) => p.avatar.color === c && p.nickname !== inicial?.nickname);

  return (
    <div className="pilha">
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <button className="fantasma" onClick={aoVoltar} aria-label="Voltar" style={{ minWidth: 44, width: 44, padding: 0 }}>
          ←
        </button>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 500 }}>Perfil</h1>
          <span className="fraco">quem você é na mesa</span>
        </div>
      </div>

      {/* A prévia é o assento de verdade, não um enfeite: é exatamente assim
          que os outros vão te ver na mesa. */}
      <div className="cartao pilha" style={{ gap: 8, alignItems: 'center' }}>
        <div style={{
          width: 150, padding: 6, borderRadius: 10,
          background: 'rgba(8,14,23,0.88)', boxShadow: 'inset 0 0 0 1px var(--linha)',
        }}>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <Avatar avatar={avatar} tamanho={26} />
            <span style={{ fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {limpo || 'sem nome'}
            </span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 3 }}>
            <span style={{ color: 'var(--vidas)', fontSize: 10, letterSpacing: 1 }}>♥♥♥</span>
            <span style={{ fontSize: 12 }}><b>2</b><span style={{ color: 'var(--texto-apagado)' }}>/3</span></span>
          </div>
        </div>
        <p className="fraco">é exatamente assim que os outros te veem</p>
      </div>

      <div className="cartao pilha" style={{ gap: 6 }}>
        <span className="rotulo">apelido</span>
        <input
          value={apelido}
          onChange={(e) => setApelido(e.target.value)}
          maxLength={NICKNAME_MAX}
          placeholder="Como te chamam"
          autoComplete="nickname"
        />
        <span className="fraco">
          {limpo.length} de {NICKNAME_MAX} caracteres · mínimo {NICKNAME_MIN}
        </span>
      </div>

      <div className="cartao pilha" style={{ gap: 10 }}>
        <span className="rotulo">cor</span>
        <div role="radiogroup" aria-label="cor do avatar" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {AVATAR_COLORS.map((c) => {
            const dono = donoDaCor(c);
            return (
              <button
                key={c}
                role="radio"
                aria-checked={c === cor}
                aria-label={dono ? `cor ${c}, já é de ${dono.nickname}` : `cor ${c}`}
                onClick={() => setCor(c)}
                style={{
                  width: 44, height: 44, padding: 0, position: 'relative',
                  background: 'transparent',
                  boxShadow: `inset 0 0 0 ${c === cor ? 2 : 1}px ${c === cor ? 'var(--acento)' : 'var(--linha)'}`,
                  opacity: dono ? 0.5 : 1,
                }}
              >
                <span style={{ width: 22, height: 22, borderRadius: 7, background: `var(--avatar-${c})`, display: 'block', margin: '0 auto' }} />
                {/* Marca com símbolo, não só com opacidade: cor não pode ser o
                    único canal, e "apagado" sozinho não diz por quê. */}
                <span aria-hidden style={{ position: 'absolute', right: 3, bottom: 1, fontSize: 10 }}>
                  {c === cor ? '✓' : dono ? '✕' : ''}
                </span>
              </button>
            );
          })}
        </div>
        {donoDaCor(cor) && (
          <span className="fraco">{cor} já é de {donoDaCor(cor)!.nickname} nesta sala</span>
        )}
      </div>

      <div className="cartao pilha" style={{ gap: 10 }}>
        <span className="rotulo">emoji</span>
        <div role="radiogroup" aria-label="emoji do avatar" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {AVATAR_EMOJIS.map((e) => (
            <button
              key={e}
              role="radio"
              aria-checked={e === emoji}
              aria-label={`emoji ${e}`}
              onClick={() => setEmoji(e)}
              style={{
                width: 44, height: 44, padding: 0, fontSize: 20,
                background: e === emoji ? 'rgba(145,132,217,0.18)' : 'transparent',
                boxShadow: `inset 0 0 0 ${e === emoji ? 2 : 1}px ${e === emoji ? 'var(--acento)' : 'var(--linha)'}`,
              }}
            >
              {e}
            </button>
          ))}
        </div>
      </div>

      <button
        disabled={!valido}
        onClick={() => {
          localStorage.setItem('fdp.apelido', limpo);
          aoConfirmar(limpo, avatar);
        }}
      >
        {jaNaMesa ? 'Salvar' : 'Entrar na mesa'}
      </button>
    </div>
  );
}
