import { useState } from 'react';
import { Avatar } from './Avatar';
import type { PublicPlayer } from '../state/tipos';

/**
 * O painel do host durante a partida (RF-096).
 *
 * **Por que um painel, e não um ✕ no assento.** O feltro é desenhado para
 * 360 px e cada assento tem 84: um botão de expulsar ali ficaria a poucos
 * pixels da carta que se joga, no dedo de quem só queria jogar. E o assento
 * escala junto com o zoom do desktop, então o alvo mudaria de tamanho com o
 * monitor. Aqui a lista é a mesma em qualquer tela.
 *
 * **Por que confirma.** Silenciar se desfaz; expulsar não. A confirmação
 * acontece na própria linha, com o nome dentro dela — um diálogo genérico
 * ("tem certeza?") é justamente o que se aprende a clicar sem ler.
 *
 * O painel não some com a partida em andamento: é exatamente aí que ele serve.
 */
export function Anfitriao({ jogadores, eu, souHost, aoExpulsar }: {
  jogadores: PublicPlayer[];
  eu: string;
  souHost: boolean;
  aoExpulsar: (playerId: string) => void;
}) {
  const [confirmando, setConfirmando] = useState<string | null>(null);
  const [aberto, setAberto] = useState(false);

  if (!souHost) return null;
  // O host não se expulsa, e bot sai de outro jeito.
  const alvos = jogadores.filter((p) => p.id !== eu && !p.bot);
  if (alvos.length === 0) return null;

  return (
    <div className="cartao pilha" style={{ gap: 6 }}>
      <button
        className="fantasma"
        onClick={() => { setAberto(!aberto); setConfirmando(null); }}
        aria-expanded={aberto}
        style={{ justifyContent: 'space-between', display: 'flex', width: '100%' }}
      >
        <span className="rotulo">a mesa é sua</span>
        <span aria-hidden="true">{aberto ? '▾' : '▸'}</span>
      </button>

      {aberto && (
        <>
          {alvos.map((p) => (
            <div key={p.id} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <Avatar avatar={p.avatar} tamanho={22} />
              <span style={{ flex: 1, fontSize: 13 }}>{p.nickname}</span>
              {confirmando === p.id ? (
                <>
                  <button
                    onClick={() => { aoExpulsar(p.id); setConfirmando(null); }}
                    style={{ fontSize: 12, padding: '4px 8px' }}
                  >
                    expulsar
                  </button>
                  <button
                    className="fantasma"
                    onClick={() => setConfirmando(null)}
                    style={{ fontSize: 12, padding: '4px 8px' }}
                  >
                    não
                  </button>
                </>
              ) : (
                <button
                  className="fantasma"
                  aria-label={`Expulsar ${p.nickname}`}
                  onClick={() => setConfirmando(p.id)}
                  style={{ minWidth: 44, padding: 0 }}
                >
                  ✕
                </button>
              )}
            </div>
          ))}
          <p className="fraco" style={{ fontSize: 11 }}>
            {/* Dizer o que acontece ANTES de acontecer. O host não deve
                descobrir que a rodada continua depois de já ter expulsado
                alguém — e "a rodada não recomeça" é a diferença entre uma
                expulsão e um estrago para os outros quatro. */}
            Um bot assume a mão, a aposta e as vidas de quem sair, e a rodada
            continua. Quem for expulso não volta nesta sala.
          </p>
        </>
      )}
    </div>
  );
}
