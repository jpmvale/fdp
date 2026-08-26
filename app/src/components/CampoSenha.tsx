import { useId, useState } from 'react';

/**
 * Campo de senha com alternador de visibilidade.
 *
 * Não é conveniência: **este produto não tem recuperação de senha** (D-5 do
 * plano 01). Errar um caractere no cadastro e só descobrir depois custa a conta
 * e o histórico junto. Poder conferir o que se digitou é a defesa mais barata
 * contra isso, e é o que a pessoa já espera de qualquer campo de senha.
 *
 * O estado nasce escondido e volta a esconder ao desmontar por construção —
 * ninguém deixa a senha à mostra numa tela que ficou aberta.
 */
export function CampoSenha({
  rotulo, valor, aoMudar, autoComplete, ajuda, invalido, aoEnter,
}: {
  rotulo: string;
  valor: string;
  aoMudar: (v: string) => void;
  autoComplete: 'new-password' | 'current-password';
  ajuda?: React.ReactNode;
  invalido?: boolean | undefined;
  aoEnter?: (() => void) | undefined;
}) {
  const [visivel, setVisivel] = useState(false);
  const id = useId();

  return (
    <div className="pilha" style={{ gap: 4 }}>
      <label className="rotulo" htmlFor={id}>{rotulo}</label>
      <div style={{ position: 'relative', display: 'flex' }}>
        <input
          id={id}
          type={visivel ? 'text' : 'password'}
          value={valor}
          onChange={(e) => aoMudar(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && aoEnter) aoEnter(); }}
          autoComplete={autoComplete}
          aria-invalid={invalido ?? undefined}
          // Espaço para o botão não cobrir o que se digita.
          style={{ flex: 1, paddingRight: 52 }}
        />
        <button
          type="button"
          onClick={() => setVisivel((v) => !v)}
          // O estado vai no rótulo, não só no ícone: quem usa leitor de tela
          // precisa saber se a senha está à mostra antes de decidir mostrar.
          aria-label={visivel ? 'Esconder a senha' : 'Mostrar a senha'}
          aria-pressed={visivel}
          className="fantasma"
          style={{
            position: 'absolute', right: 4, top: 4, bottom: 4,
            width: 44, minWidth: 44, minHeight: 0, padding: 0,
            background: 'transparent', boxShadow: 'none',
            display: 'grid', placeItems: 'center',
          }}
        >
          {visivel ? <OlhoFechado /> : <OlhoAberto />}
        </button>
      </div>
      {ajuda}
    </div>
  );
}

/* Desenhados, não emoji: emoji muda de forma a cada plataforma e nenhum deles
   lê como "olho" em todas. */

function OlhoAberto() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden focusable="false">
      <path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z"
        stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <circle cx="12" cy="12" r="2.6" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

function OlhoFechado() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden focusable="false">
      <path d="M3 4l18 16" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M9.9 5.2A9.9 9.9 0 0 1 12 5c6 0 9.5 6 9.5 6a17 17 0 0 1-3.2 3.7M6.4 7.1A17 17 0 0 0 2.5 11s3.5 6 9.5 6a9.7 9.7 0 0 0 3.4-.6"
        stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
