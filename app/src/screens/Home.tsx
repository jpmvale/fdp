import { useState } from 'react';
import { ROOM_CODE_LENGTH, type ModoDeFila } from '@fdp/protocol';

/**
 * Home: só a porta de entrada.
 *
 * Quem você é na mesa fica no Perfil, na tela seguinte. Juntei as duas por um
 * tempo para economizar um passo, mas separar é o que o design pede e tem uma
 * razão melhor: entrar por link não é a mesma coisa que criar sala, e a Home
 * enxuta deixa as duas portas do mesmo tamanho.
 */
export function Home({
  aoCriar, aoEntrar, aoAbrirRegras, codigoInicial, conta, aoAbrirConta, aoSairDaConta,
  aoEditarPerfil, aoVerPerfil, aoEntrarNaFila, temConta,
}: {
  aoCriar: () => void;
  aoEntrar: (codigo: string) => void;
  aoAbrirRegras: () => void;
  codigoInicial: string;
  /** `null` é visitante, e é o estado normal (plano 01, I-1). */
  conta: { slug: string; apelido: string } | null;
  aoAbrirConta: () => void;
  aoSairDaConta: () => void;
  /** Só com conta: sem ela não há nada que sobreviva ao fim da sala. */
  aoEditarPerfil: () => void;
  /** O próprio perfil, com o histórico de partidas. */
  aoVerPerfil: () => void;
  /** As filas públicas (plano 03). Só a ranqueada exige conta (D-1). */
  aoEntrarNaFila: (modo: ModoDeFila) => void;
  temConta: boolean;
}) {
  const [codigo, setCodigo] = useState(codigoInicial.toUpperCase());
  const completo = codigo.length === ROOM_CODE_LENGTH;

  return (
    <div className="pilha" style={{ gap: 16 }}>
      <header className="pilha" style={{ gap: 10, paddingTop: 24, alignItems: 'flex-start' }}>
        <h1 style={{ fontSize: 44, fontWeight: 500, letterSpacing: '-0.03em', lineHeight: 1 }}>
          FDP
        </h1>
        {/* O que sobrou das duas linhas de texto: quantas pessoas cabem. É a
            única coisa dali que alguém precisa saber antes de decidir entrar,
            e cabe num símbolo. */}
        <span
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            padding: '4px 10px', borderRadius: 999,
            background: 'var(--superficie)', boxShadow: 'inset 0 0 0 1px var(--linha)',
            color: 'var(--texto-medio)', fontSize: 14, fontVariantNumeric: 'tabular-nums',
          }}
        >
          <IconeJogadores />
          2–8
          <span className="sr-only">jogadores</span>
        </span>
      </header>

      <button onClick={aoCriar} style={{ height: 52 }}>Criar sala</button>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ flex: 1, height: 1, background: 'var(--linha)' }} />
        <span className="fraco">ou</span>
        <span style={{ flex: 1, height: 1, background: 'var(--linha)' }} />
      </div>

      {/* As filas ficam ABAIXO de "criar sala", e não acima.

          A sala por link é o caminho principal do FDP e continua sendo (plano
          03, I-1): a fila é mais um caminho, nunca o caminho. Pôr "Jogar agora"
          no topo transformaria um jogo que se joga com os amigos num jogo que
          se joga com estranhos, por decisão de layout. */}
      <div className="pilha" style={{ gap: 8 }}>
        <span className="rotulo">jogar com quem estiver online</span>
        {/* Os dois lado a lado, e empilhados quando não couberem.

            `flex: 1` sozinho NÃO encolhe abaixo do conteúdo — `min-width: auto`
            segura o item no tamanho do texto —, e a 200% de zoom "Ranqueada"
            transbordava a tela em 19 px. Rolagem horizontal é falha de WCAG
            1.4.10, e foi o CA-144 que a encontrou.

            `flex-basis` de 120 px com `wrap` resolve sem cortar palavra nem pôr
            reticências: acima disso ficam lado a lado, abaixo empilham. */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button
            className="fantasma"
            onClick={() => aoEntrarNaFila('NORMAL')}
            style={{ flex: '1 1 120px', minWidth: 0, height: 46 }}
          >
            Jogar agora
          </button>
          <button
            className="fantasma"
            onClick={() => aoEntrarNaFila('RANQUEADA')}
            style={{ flex: '1 1 120px', minWidth: 0, height: 46 }}
          >
            Ranqueada
          </button>
        </div>
        <span className="fraco" style={{ fontSize: 11 }}>
          {/* Dizer o requisito ANTES do clique. Descobrir que precisa de conta
              depois de já ter escolhido é o passo em que se perde gente. */}
          {temConta
            ? 'Mesa de 4 a 8 pessoas, começando direto.'
            : 'A ranqueada precisa de conta — é onde o seu elo mora.'}
        </span>
      </div>

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

      {/* A conta fica ABAIXO das duas portas, e de propósito.

          Ela não é caminho para jogar: quem chega por link não passa por aqui,
          e pôr "Entrar na conta" acima de "Criar sala" faria o jogo parecer
          que pede cadastro (plano 01, I-1). É oferta, não portão. */}
      {conta ? (
        <div className="pilha" style={{ gap: 6, alignItems: 'center' }}>
          <span className="fraco" style={{ fontSize: 13 }}>
            entrando como <b style={{ color: 'var(--texto)' }}>{conta.apelido}</b>
          </span>
          {/* RF-078. Editar o perfil só existia DENTRO da sala, e isso deixava
              a conta sem dono: o apelido e a cara com que a pessoa entra em
              toda mesa só podiam ser trocados estando numa — e a foto, que é
              da conta e não da sala, junto. Aqui é o único lugar fora da
              partida em que a conta aparece, então é aqui que ela se edita. */}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'center' }}>
            {/* Ver o próprio perfil só existia DENTRO da partida, pelo assento
                — e o assento é de quem está jogando, então quem não estava numa
                mesa não tinha caminho nenhum até o próprio histórico. */}
            <button className="fantasma" onClick={aoVerPerfil} style={{ minHeight: 36, padding: '0 12px' }}>
              meu perfil
            </button>
            <button className="fantasma" onClick={aoEditarPerfil} style={{ minHeight: 36, padding: '0 12px' }}>
              editar
            </button>
            <button className="fantasma" onClick={aoSairDaConta} style={{ minHeight: 36, padding: '0 12px' }}>
              sair
            </button>
          </div>
        </div>
      ) : (
        <button
          className="fantasma"
          onClick={aoAbrirConta}
          style={{ alignSelf: 'center', minHeight: 40, padding: '0 18px' }}
        >
          Entrar ou criar conta
        </button>
      )}

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

/** Duas silhuetas. Desenho, não emoji: emoji muda de forma a cada plataforma. */
function IconeJogadores() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden focusable="false">
      <circle cx="9" cy="8" r="3.2" stroke="currentColor" strokeWidth="1.6" />
      <path d="M3.5 19c0-3 2.5-5 5.5-5s5.5 2 5.5 5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="17" cy="9" r="2.4" stroke="currentColor" strokeWidth="1.6" />
      <path d="M15.5 15.2c2.6-.5 5 1.3 5 3.8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}
