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
export function Chat({
  mensagens, eu, aoEnviar, inicialmenteAberto = false,
  souHost = false, silenciados, estouSilenciado = false, aoSilenciar,
  mudos, aoAlternarMudo,
}: {
  mensagens: ChatMessage[];
  eu: string;
  aoEnviar: (texto: string) => void;
  inicialmenteAberto?: boolean;
  /** RF-095: o host cala quem incomoda, ali onde a mensagem aparece. */
  souHost?: boolean;
  silenciados?: Set<string> | undefined;
  estouSilenciado?: boolean;
  aoSilenciar?: ((playerId: string, silenciado: boolean) => void) | undefined;
  /**
   * Silenciar para mim (plano 03 §9.1) — outra coisa do `silenciados` acima.
   *
   * Aquele é moderação do host: o servidor recusa a mensagem e a pessoa fica
   * sem voz para a mesa inteira. Este é alívio de quem lê: a mensagem chega,
   * chega a todo mundo, e só a MINHA tela deixa de mostrá-la. Existe porque
   * numa mesa de fila não há host (plano 03, D-8), e mesmo numa sala de amigos
   * nem todo incômodo merece uma decisão sobre a voz de alguém.
   */
  mudos?: Set<string> | undefined;
  aoAlternarMudo?: ((playerId: string) => void) | undefined;
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
                  {/* A mensagem silenciada não SOME: vira uma linha apagada com
                      o nome de quem falou e um caminho de volta.

                      Apagar a linha inteira faria a conversa dos outros ficar
                      cheia de buracos — alguém responde a algo que você não vê,
                      e a mesa parece quebrada. E deixaria você sem como
                      desfazer, porque não haveria onde clicar. */}
                  <span style={{
                    fontWeight: 600,
                    color: m.playerId === eu ? 'var(--acento-claro)' : 'var(--texto-medio)',
                  }}>
                    {m.nickname}
                  </span>
                  {/* Quem assiste vê a mão de todo mundo (RJ-159). "Joga o 3 de
                      paus" dito de dentro da mesa é palpite; dito de fora é
                      outra coisa, e quem lê precisa poder distinguir. */}
                  {/* RF-095. Aqui, e não numa lista de gente à parte: você
                      vê a mensagem que incomoda e cala o autor no mesmo lugar,
                      sem procurar quem é numa segunda tela. */}
                  {/* Todo mundo pode calar para si. Não é privilégio: não
                      decide nada sobre ninguém. */}
                  {m.playerId !== eu && aoAlternarMudo && (
                    <button
                      className="fantasma"
                      aria-pressed={mudos?.has(m.playerId) ?? false}
                      aria-label={mudos?.has(m.playerId)
                        ? `Voltar a ver as mensagens de ${m.nickname}`
                        : `Não ver mais as mensagens de ${m.nickname}`}
                      onClick={() => aoAlternarMudo(m.playerId)}
                      style={{
                        all: 'unset', cursor: 'pointer', marginLeft: 5,
                        fontSize: 10, verticalAlign: 'middle',
                        opacity: mudos?.has(m.playerId) ? 1 : 0.45,
                      }}
                    >
                      {mudos?.has(m.playerId) ? '🙈' : '👁'}
                    </button>
                  )}
                  {souHost && m.playerId !== eu && aoSilenciar && (
                    <button
                      className="fantasma"
                      aria-pressed={silenciados?.has(m.playerId) ?? false}
                      aria-label={silenciados?.has(m.playerId)
                        ? `Devolver a voz a ${m.nickname}`
                        : `Silenciar ${m.nickname}`}
                      onClick={() => aoSilenciar(m.playerId, !(silenciados?.has(m.playerId) ?? false))}
                      style={{
                        all: 'unset', cursor: 'pointer', marginLeft: 5,
                        fontSize: 10, verticalAlign: 'middle',
                        opacity: silenciados?.has(m.playerId) ? 1 : 0.45,
                      }}
                    >
                      {silenciados?.has(m.playerId) ? '🔇' : '🔈'}
                    </button>
                  )}
                  {m.spectator && (
                    <span
                      title="assistindo — vê as cartas de todo mundo"
                      style={{
                        marginLeft: 5, fontSize: 9, padding: '0 4px',
                        borderRadius: 4, verticalAlign: 'middle',
                        background: 'var(--superficie-2)', color: 'var(--texto-fraco)',
                        boxShadow: 'inset 0 0 0 1px var(--linha)',
                      }}
                    >
                      assiste
                    </span>
                  )}
                  <span style={{ color: 'var(--texto-apagado)' }}> · </span>
                  {/* `text` entra como filho, nunca como HTML (CA-340). */}
                  {mudos?.has(m.playerId) ? (
                    <span className="fraco" style={{ fontStyle: 'italic' }}>
                      mensagem escondida
                    </span>
                  ) : (
                    <span style={{ wordBreak: 'break-word' }}>{m.text}</span>
                  )}
                </div>
              ))
            )}
            <div ref={fim} />
          </div>

          <div style={{ display: 'flex', gap: 6 }}>
            <input
              value={texto}
              disabled={estouSilenciado}
              onChange={(e) => setTexto(e.target.value.slice(0, LIMITS.chatTextMax))}
              onKeyDown={(e) => { if (e.key === 'Enter') enviar(); }}
              maxLength={LIMITS.chatTextMax}
              // Diz o ESTADO no lugar onde a pessoa vai tentar escrever.
              // Um campo desabilitado sem explicação lê como defeito.
              placeholder={estouSilenciado
                ? 'O host silenciou você nesta mesa'
                : 'Escreva para a mesa'}
              aria-label="Mensagem para a mesa"
              style={{ flex: 1 }}
            />
            <button
              onClick={enviar}
              disabled={!podeEnviar || estouSilenciado}
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
