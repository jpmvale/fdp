import { useState } from 'react';
import { Regras } from './Regras';
import { Log } from './Log';
import type { PlayerView, Retrato } from '../state/tipos';

/**
 * O ☰: as regras e o log da partida, na mesma gaveta.
 *
 * Juntos porque são a mesma necessidade em dois tempos — "como isso funciona?"
 * e "o que aconteceu até agora?". Separar em dois botões gastaria o topo da
 * tela mais apertada do produto para uma distinção que ninguém faz na cabeça.
 *
 * Abre no log quando há partida: no meio do jogo a pergunta quase sempre é o
 * que rolou, e quem quer as regras clica uma vez. Sem partida, só há regras.
 */
export function Menu({ retrato, partida, aoFechar, aoSair }: {
  retrato: Retrato;
  partida: PlayerView | null;
  aoFechar: () => void;
  aoSair: () => void;
}) {
  const [aba, setAba] = useState<'log' | 'regras'>(partida ? 'log' : 'regras');
  const [confirmando, setConfirmando] = useState(false);

  const emPartida = partida !== null && partida.endReason === null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Regras e log da partida"
      style={{
        position: 'fixed', inset: 0, zIndex: 15,
        background: 'var(--fundo)',
        overflowY: 'auto',
        padding: '0 12px calc(24px + env(safe-area-inset-bottom))',
      }}
    >
      <div style={{ maxWidth: 460, margin: '0 auto' }} className="pilha">
        <div style={{
          position: 'sticky', top: 0, zIndex: 2,
          background: 'var(--fundo)', paddingTop: 12,
        }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <div role="tablist" aria-label="Seções" style={{ display: 'flex', gap: 6, flex: 1 }}>
              <Aba atual={aba} valor="log" aoEscolher={setAba}>O que rolou</Aba>
              <Aba atual={aba} valor="regras" aoEscolher={setAba}>Como se joga</Aba>
            </div>
            <button
              className="fantasma"
              onClick={aoFechar}
              aria-label="Fechar"
              style={{ minWidth: 44, width: 44, padding: 0 }}
            >
              ✕
            </button>
          </div>
          <div style={{ height: 12 }} />
        </div>

        {aba === 'log'
          ? <Log retrato={retrato} partida={partida} />
          : <Regras />}

        <button onClick={aoFechar}>Voltar para a mesa</button>

        {/* Sair no meio da partida é RETIRADA (RJ-154): as cartas e as vidas
            vão embora e a rodada é refeita sem a pessoa. Por isso o segundo
            toque — não é cerimônia, é que um toque acidental aqui custaria a
            partida de quem tocou e atrapalharia a mesa inteira. */}
        {confirmando ? (
          <div className="cartao pilha" style={{ gap: 8 }}>
            <p className="fraco" style={{ textAlign: 'center' }}>
              {emPartida
                ? 'Sair agora é desistir: suas vidas e cartas vão embora e a rodada recomeça sem você.'
                : 'Você sai da mesa e volta ao início.'}
            </p>
            <button className="perigo" onClick={aoSair}>
              {emPartida ? 'Desistir e sair' : 'Sair da mesa'}
            </button>
            <button className="fantasma" onClick={() => setConfirmando(false)}>
              Ficar
            </button>
          </div>
        ) : (
          <button className="fantasma" onClick={() => setConfirmando(true)}>
            Sair da mesa
          </button>
        )}
      </div>
    </div>
  );
}

function Aba({ atual, valor, aoEscolher, children }: {
  atual: 'log' | 'regras';
  valor: 'log' | 'regras';
  aoEscolher: (v: 'log' | 'regras') => void;
  children: React.ReactNode;
}) {
  const ativa = atual === valor;
  return (
    <button
      role="tab"
      aria-selected={ativa}
      onClick={() => aoEscolher(valor)}
      className={ativa ? '' : 'fantasma'}
      style={{ flex: 1, fontSize: 14 }}
    >
      {children}
    </button>
  );
}
