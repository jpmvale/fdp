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
export function Perfil({ inicial, jaNaMesa, eu, aoConfirmar, aoVoltar }: {
  inicial?: { nickname: string; avatar: AvatarProto } | undefined;
  /** Quem já está na sala, para não escolher a cara de outro. */
  jaNaMesa?: PublicPlayer[] | undefined;
  /** Meu id na sala, quando já estou nela: é por ele que eu me excluo. */
  eu?: string | undefined;
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

  // Identidade é única na mesa, e o SERVIDOR recusa (CA-375) — antes ele
  // reacomodava, e por isso esta tela só marcava as cores sem impedir nada.
  // Marcar e deixar clicar era o pior dos dois mundos: o toque parecia ter
  // funcionado e o erro só aparecia ao salvar.
  //
  // Eu me excluo pelo ID, não pelo apelido: comparar por nome fazia quem tinha
  // apelido igual ao de outro se ver como dono da cor alheia.
  const demais = (jaNaMesa ?? []).filter((p) => p.id !== eu);
  const donoDaCor = (c: string) => demais.find((p) => p.avatar.color === c);
  const donoDoEmoji = (e: string) => demais.find((p) => p.avatar.emoji === e);
  const donoDoApelido = demais.find(
    (p) => p.nickname.trim().toLocaleLowerCase('pt-BR') === limpo.toLocaleLowerCase('pt-BR'),
  );

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
        {donoDoApelido ? (
          <span style={{ color: 'var(--vidas)', fontSize: 12 }}>
            Esse apelido já é de alguém nesta mesa.
          </span>
        ) : (
          <span className="fraco">
            {limpo.length} de {NICKNAME_MAX} caracteres · mínimo {NICKNAME_MIN}
          </span>
        )}
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
                disabled={dono !== undefined}
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
          {AVATAR_EMOJIS.map((e) => {
            const dono = donoDoEmoji(e);
            return (
              <button
                key={e}
                role="radio"
                aria-checked={e === emoji}
                aria-label={dono ? `emoji ${e}, já é de ${dono.nickname}` : `emoji ${e}`}
                disabled={dono !== undefined}
                onClick={() => setEmoji(e)}
                style={{
                  width: 44, height: 44, padding: 0, fontSize: 20, position: 'relative',
                  background: e === emoji ? 'rgba(145,132,217,0.18)' : 'transparent',
                  boxShadow: `inset 0 0 0 ${e === emoji ? 2 : 1}px ${e === emoji ? 'var(--acento)' : 'var(--linha)'}`,
                  opacity: dono ? 0.4 : 1,
                }}
              >
                {e}
                {/* Símbolo junto da opacidade: apagado sozinho não diz por quê. */}
                {dono && (
                  <span aria-hidden style={{ position: 'absolute', right: 2, bottom: 0, fontSize: 10 }}>✕</span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      <button
        disabled={!valido || donoDoApelido !== undefined}
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
