import { useState } from 'react';
import { AVATAR_COLORS, AVATAR_EMOJIS, NICKNAME_MAX, ROOM_CODE_LENGTH } from '@fdp/protocol';
import type { Avatar as AvatarProto } from '@fdp/protocol';
import { Avatar } from '../components/Avatar';

/**
 * Home e perfil na MESMA tela, de propósito: a métrica que importa é do link
 * até jogando em menos de 45 s (`00` §7), e um passo a menos é a forma mais
 * barata de ganhar segundos.
 */
export function Home({ aoCriar, aoEntrar, codigoInicial }: {
  aoCriar: (apelido: string, avatar: AvatarProto) => void;
  aoEntrar: (codigo: string, apelido: string, avatar: AvatarProto) => void;
  codigoInicial: string;
}) {
  const [apelido, setApelido] = useState(() => localStorage.getItem('fdp.apelido') ?? '');
  const [codigo, setCodigo] = useState(codigoInicial);
  const [emoji, setEmoji] = useState<string>(AVATAR_EMOJIS[0]);
  const [cor, setCor] = useState<string>(AVATAR_COLORS[0]);

  const avatar = { emoji, color: cor } as AvatarProto;
  const valido = apelido.trim().length >= 2;

  const lembrar = () => localStorage.setItem('fdp.apelido', apelido.trim());

  return (
    <div className="pilha">
      <header className="pilha" style={{ gap: 6, paddingTop: 8 }}>
        <span className="rotulo">jogo de vazas, aposta e blefe</span>
        <h1 style={{ fontSize: 40, fontWeight: 500, letterSpacing: '-0.02em', lineHeight: 1.05 }}>
          FDP
        </h1>
        <p style={{ color: 'var(--texto-medio)', fontSize: 15, textWrap: 'pretty' }}>
          Aposte quantas vazas você ganha. Errou, perde vida. A soma da mesa nunca
          fecha — alguém sempre se dá mal.
        </p>
      </header>

      <div className="cartao pilha">
        <label className="pilha" style={{ gap: 6 }}>
          <span className="rotulo">seu apelido</span>
          <input
            value={apelido}
            onChange={(e) => setApelido(e.target.value)}
            maxLength={NICKNAME_MAX}
            placeholder="Como te chamam"
            autoComplete="nickname"
          />
        </label>

        <div className="pilha" style={{ gap: 6 }}>
          <span className="rotulo">sua cara na mesa</span>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <Avatar avatar={avatar} tamanho={44} />
            <p className="fraco" style={{ flex: 1 }}>
              Cor e bicho juntos — é assim que a mesa te reconhece de relance.
            </p>
          </div>
          <Seletor rotulo="cor" itens={[...AVATAR_COLORS]} atual={cor} aoEscolher={setCor}
            desenhar={(c) => (
              <span style={{
                width: 22, height: 22, borderRadius: 7, display: 'block',
                background: `var(--avatar-${c})`,
              }} />
            )} />
          <Seletor rotulo="bicho" itens={[...AVATAR_EMOJIS]} atual={emoji} aoEscolher={setEmoji}
            desenhar={(e) => <span style={{ fontSize: 20 }}>{e}</span>} />
        </div>
      </div>

      <button disabled={!valido} onClick={() => { lembrar(); aoCriar(apelido.trim(), avatar); }}>
        Criar uma sala
      </button>

      <div className="cartao pilha" style={{ gap: 10 }}>
        <span className="rotulo">ou entre com um código</span>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            value={codigo}
            onChange={(e) => setCodigo(e.target.value.toUpperCase().slice(0, ROOM_CODE_LENGTH))}
            placeholder="ABCDE"
            inputMode="text"
            autoCapitalize="characters"
            style={{
              flex: 1, fontFamily: 'ui-monospace, monospace', fontSize: 20,
              letterSpacing: 4, textTransform: 'uppercase',
            }}
          />
          <button
            className="fantasma"
            disabled={!valido || codigo.length !== ROOM_CODE_LENGTH}
            onClick={() => { lembrar(); aoEntrar(codigo, apelido.trim(), avatar); }}
          >
            Entrar
          </button>
        </div>
      </div>
    </div>
  );
}

function Seletor<T extends string>({ rotulo, itens, atual, aoEscolher, desenhar }: {
  rotulo: string;
  itens: T[];
  atual: T;
  aoEscolher: (v: T) => void;
  desenhar: (v: T) => React.ReactNode;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={rotulo}
      style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 2 }}
    >
      {itens.map((item) => (
        <button
          key={item}
          role="radio"
          aria-checked={item === atual}
          aria-label={`${rotulo} ${item}`}
          onClick={() => aoEscolher(item)}
          style={{
            minWidth: 44, minHeight: 44, flex: '0 0 auto',
            display: 'grid', placeItems: 'center',
            background: item === atual ? 'rgba(145,132,217,0.18)' : 'transparent',
            boxShadow: `inset 0 0 0 ${item === atual ? 2 : 1}px ${item === atual ? 'var(--acento)' : 'var(--linha)'}`,
            padding: 0,
          }}
        >
          {desenhar(item)}
        </button>
      ))}
    </div>
  );
}
