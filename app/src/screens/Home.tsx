import { useState } from 'react';
import { ROOM_CODE_LENGTH } from '@fdp/protocol';

/**
 * Home: só a porta de entrada.
 *
 * Quem você é na mesa fica no Perfil, na tela seguinte. Juntei as duas por um
 * tempo para economizar um passo, mas separar é o que o design pede e tem uma
 * razão melhor: entrar por link não é a mesma coisa que criar sala, e a Home
 * enxuta deixa as duas portas do mesmo tamanho.
 */
export function Home({ aoCriar, aoEntrar, aoAbrirRegras, codigoInicial }: {
  aoCriar: () => void;
  aoEntrar: (codigo: string) => void;
  aoAbrirRegras: () => void;
  codigoInicial: string;
}) {
  const [codigo, setCodigo] = useState(codigoInicial.toUpperCase());
  const completo = codigo.length === ROOM_CODE_LENGTH;

  return (
    <div className="pilha" style={{ gap: 16 }}>
      <header className="pilha" style={{ gap: 6, paddingTop: 24 }}>
        <span className="rotulo">jogo de vazas, aposta e blefe</span>
        <h1 style={{ fontSize: 44, fontWeight: 500, letterSpacing: '-0.03em', lineHeight: 1 }}>
          FDP
        </h1>
        <p style={{ color: 'var(--texto-medio)', fontSize: 15, textWrap: 'pretty' }}>
          Vazas, aposta e blefe. De 2 a 8 pessoas, cada uma no seu celular.
        </p>
      </header>

      <button onClick={aoCriar} style={{ height: 52 }}>Criar sala</button>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ flex: 1, height: 1, background: 'var(--linha)' }} />
        <span className="fraco">ou</span>
        <span style={{ flex: 1, height: 1, background: 'var(--linha)' }} />
      </div>

      <div className="pilha" style={{ gap: 10 }}>
        <span className="rotulo">entrar com código</span>
        <CaixasDeCodigo valor={codigo} aoMudar={setCodigo} />
        <button className="fantasma" disabled={!completo} onClick={() => aoEntrar(codigo)}>
          Entrar na sala
        </button>
      </div>

      {/* `07` §2.1. Faltava aqui, que é o único lugar onde alguém chega sem
          nunca ter visto o jogo: no lobby e na mesa as regras já estavam no ☰,
          mas quem abre o link e não conhece FDP para nesta tela. */}
      <button
        className="fantasma"
        onClick={aoAbrirRegras}
        style={{ alignSelf: 'center', minHeight: 44, padding: '0 18px' }}
      >
        Como se joga
      </button>
    </div>
  );
}

/**
 * Cinco caixas, um caractere cada.
 *
 * É UM campo só por baixo: cinco `<input>` de verdade dariam cinco alvos de
 * foco, colagem quebrada e teclado brigando com o autofill. As caixas são
 * desenho; quem guarda o texto é o campo invisível por cima delas.
 */
function CaixasDeCodigo({ valor, aoMudar }: { valor: string; aoMudar: (v: string) => void }) {
  const casas = Array.from({ length: ROOM_CODE_LENGTH });

  return (
    <div style={{ position: 'relative' }}>
      <div style={{ display: 'flex', gap: 6 }} aria-hidden>
        {casas.map((_, i) => (
          <span
            key={i}
            style={{
              flex: 1,
              height: 56,
              borderRadius: 8,
              background: 'var(--superficie)',
              border: `1px solid ${i === valor.length ? 'var(--acento)' : 'var(--linha)'}`,
              display: 'grid',
              placeItems: 'center',
              fontFamily: 'ui-monospace, monospace',
              fontSize: 22,
              fontWeight: 600,
            }}
          >
            {valor[i] ?? ''}
          </span>
        ))}
      </div>

      <input
        value={valor}
        onChange={(e) => aoMudar(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, ROOM_CODE_LENGTH))}
        maxLength={ROOM_CODE_LENGTH}
        inputMode="text"
        autoCapitalize="characters"
        autoComplete="off"
        aria-label="Código da sala"
        style={{
          position: 'absolute', inset: 0, width: '100%', height: 56,
          opacity: 0, border: 0, background: 'transparent',
          // O cursor precisa caber onde o dedo toca: o campo cobre as caixas.
          fontSize: 16,
        }}
      />
    </div>
  );
}
