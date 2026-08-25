import { useState } from 'react';

/**
 * Chat da mesa (RF-018 do escopo, `00` §4.1) — **a casca, ainda sem função**.
 *
 * O desenho existe e entra aqui para a interface ficar fiel ao design; o
 * servidor ainda não tem chat: não há evento em `05` nem campo em `04`, então
 * não existe para onde mandar mensagem nem de onde receber.
 *
 * Por isso o campo entra DESABILITADO e dizendo isso. Um campo de texto que
 * aceita digitação e engole a mensagem é pior que nenhum chat: a pessoa
 * escreve, ninguém recebe, e ela não descobre — passa a partida achando que
 * está sendo ignorada pelo grupo.
 */
export function Chat({ inicialmenteAberto = false }: { inicialmenteAberto?: boolean }) {
  const [aberto, setAberto] = useState(inicialmenteAberto);

  return (
    <div className="cartao" style={{ padding: aberto ? 12 : '2px 12px' }}>
      <button
        onClick={() => setAberto((v) => !v)}
        aria-expanded={aberto}
        style={{
          background: 'transparent', color: 'inherit', padding: 0,
          // 44 e não 28: alvo de toque mínimo vale para tudo que é clicável,
          // inclusive o que só abre e fecha um painel (RF-021).
          width: '100%', minHeight: 'var(--toque)', display: 'flex',
          gap: 8, alignItems: 'center', fontWeight: 400,
        }}
      >
        <span aria-hidden>💬</span>
        <span className="rotulo" style={{ flex: 1, textAlign: 'left' }}>chat da mesa</span>
        <span aria-hidden style={{ color: 'var(--texto-apagado)' }}>{aberto ? '⌃' : '⌄'}</span>
      </button>

      {aberto && (
        <div className="pilha" style={{ gap: 8, marginTop: 10 }}>
          <div style={{
            padding: '14px 10px', borderRadius: 'var(--r-sm)',
            background: 'var(--poco)', textAlign: 'center',
          }}>
            <p className="fraco" style={{ margin: 0 }}>
              O chat ainda não está ligado. A tela existe, o servidor ainda não —
              nada digitado aqui chegaria a ninguém.
            </p>
          </div>

          <input
            disabled
            placeholder="ainda não dá para escrever"
            aria-label="Mensagem para a mesa (indisponível)"
          />
        </div>
      )}
    </div>
  );
}
