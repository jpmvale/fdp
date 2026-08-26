import { useEffect, useRef, useState } from 'react';
import { LIMITS } from '@fdp/protocol';
import type { ChatMessage } from '../state/tipos';

/**
 * Chat da mesa (RF-017).
 *
 * O histórico vem do RETRATO do servidor, não de uma pilha local — mesma razão
 * do log da partida: recarregar a página, cair a rede ou entrar no meio não
 * podem apagar a conversa de quem chega (CA-334, CA-335).
 *
 * O texto é renderizado como TEXTO. O React escapa por padrão, e é isso que
 * cumpre CA-340 — este é o único lugar do produto onde alguém escreve algo que
 * aparece na tela dos outros, então é a superfície de injeção inteira.
 */
export function Chat({ mensagens, eu, aoEnviar, inicialmenteAberto = false }: {
  mensagens: ChatMessage[];
  eu: string;
  aoEnviar: (texto: string) => void;
  inicialmenteAberto?: boolean;
}) {
  const [aberto, setAberto] = useState(inicialmenteAberto);
  const [texto, setTexto] = useState('');
  const fim = useRef<HTMLDivElement>(null);
  const vistas = useRef(mensagens.length);

  /**
   * Trava local de RNF-016.
   *
   * O servidor é quem manda — ele recusa com `RAPIDO_DEMAIS` de qualquer jeito.
   * Isto aqui existe para que a recusa não CHEGUE: apertar Enviar, ver a
   * mensagem sumir do campo e depois receber um erro vermelho é pior que o
   * botão simplesmente não estar disponível ainda. A margem de 150 ms cobre a
   * diferença entre o relógio desta aba e o do servidor, que é justamente onde
   * um envio no limite exato viraria erro.
   */
  const [emEspera, setEmEspera] = useState(false);
  useEffect(() => {
    if (!emEspera) return;
    const t = setTimeout(() => setEmEspera(false), LIMITS.chatMinIntervalMs + 150);
    return () => clearTimeout(t);
  }, [emEspera]);

  const limpo = texto.trim();
  const podeEnviar = !emEspera && limpo.length > 0 && limpo.length <= LIMITS.chatTextMax;

  // Rola para a última só com o painel aberto: rolar um painel fechado não faz
  // nada, e mexer no scroll da página por baixo seria pior que não fazer nada.
  useEffect(() => {
    if (aberto) fim.current?.scrollIntoView({ block: 'nearest' });
  }, [aberto, mensagens.length]);

  useEffect(() => {
    if (aberto) vistas.current = mensagens.length;
  }, [aberto, mensagens.length]);

  const naoLidas = aberto ? 0 : Math.max(0, mensagens.length - vistas.current);

  const enviar = () => {
    if (!podeEnviar) return;
    aoEnviar(limpo);
    setTexto('');
    setEmEspera(true);
  };

  return (
    <div className="cartao" style={{ padding: aberto ? 12 : '2px 12px' }}>
      <button
        onClick={() => setAberto((v) => !v)}
        aria-expanded={aberto}
        style={{
          background: 'transparent', color: 'inherit', padding: 0,
          width: '100%', minHeight: 'var(--toque)', display: 'flex',
          gap: 8, alignItems: 'center', fontWeight: 400,
        }}
      >
        <span aria-hidden>💬</span>
        <span className="rotulo" style={{ flex: 1, textAlign: 'left' }}>chat da mesa</span>
        {naoLidas > 0 && (
          <span
            aria-label={`${naoLidas} ${naoLidas === 1 ? 'mensagem nova' : 'mensagens novas'}`}
            style={{
              fontSize: 11, minWidth: 20, padding: '1px 6px', borderRadius: 10,
              background: 'var(--acento)', color: '#12101d', fontWeight: 600,
            }}
          >
            {naoLidas}
          </span>
        )}
        <span aria-hidden style={{ color: 'var(--texto-apagado)' }}>{aberto ? '⌃' : '⌄'}</span>
      </button>

      {aberto && (
        <div className="pilha" style={{ gap: 8, marginTop: 10 }}>
          <div
            role="log"
            aria-label="Mensagens da mesa"
            style={{
              maxHeight: 180, overflowY: 'auto', display: 'flex',
              flexDirection: 'column', gap: 6, padding: '2px 0',
            }}
          >
            {mensagens.length === 0 ? (
              <p className="fraco" style={{ textAlign: 'center', padding: '12px 0' }}>
                Ninguém falou nada ainda.
              </p>
            ) : (
              mensagens.map((m) => (
                <div key={m.id} style={{ fontSize: 13, lineHeight: 1.45 }}>
                  <span style={{
                    fontWeight: 600,
                    color: m.playerId === eu ? 'var(--acento-claro)' : 'var(--texto-medio)',
                  }}>
                    {m.nickname}
                  </span>
                  <span style={{ color: 'var(--texto-apagado)' }}> · </span>
                  {/* `text` entra como filho, nunca como HTML (CA-340). */}
                  <span style={{ wordBreak: 'break-word' }}>{m.text}</span>
                </div>
              ))
            )}
            <div ref={fim} />
          </div>

          <div style={{ display: 'flex', gap: 6 }}>
            <input
              value={texto}
              onChange={(e) => setTexto(e.target.value.slice(0, LIMITS.chatTextMax))}
              onKeyDown={(e) => { if (e.key === 'Enter') enviar(); }}
              maxLength={LIMITS.chatTextMax}
              placeholder="Escreva para a mesa"
              aria-label="Mensagem para a mesa"
              style={{ flex: 1 }}
            />
            <button
              onClick={enviar}
              disabled={!podeEnviar}
              aria-label={emEspera ? 'Espere um segundo para enviar de novo' : 'Enviar mensagem'}
              style={{ minWidth: 64 }}
            >
              Enviar
            </button>
          </div>

          {/* Só perto do teto: contador sempre visível é ruído em 99% das
              mensagens, e a régua só interessa a quem está encostando nela. */}
          {limpo.length > LIMITS.chatTextMax - 40 && (
            <span className="fraco" style={{ textAlign: 'right' }}>
              {limpo.length} de {LIMITS.chatTextMax}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
