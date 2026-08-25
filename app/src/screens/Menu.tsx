import { useState } from 'react';
import { Folha } from '../components/Folha';
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
    <Folha
      rotulo="Regras e log da partida"
      aoFechar={aoFechar}
      cabecalho={
        <div role="tablist" aria-label="Seções" style={{ display: 'flex', gap: 6 }}>
          <Aba atual={aba} valor="log" aoEscolher={setAba}>O que rolou</Aba>
          <Aba atual={aba} valor="regras" aoEscolher={setAba}>Como se joga</Aba>
        </div>
      }
    >
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
    </Folha>
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
