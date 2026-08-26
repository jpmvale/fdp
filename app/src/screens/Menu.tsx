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
export function Menu({ retrato, partida, eu, aoFechar, aoSair, aoEncerrar }: {
  retrato: Retrato;
  partida: PlayerView | null;
  eu: string;
  aoFechar: () => void;
  aoSair: () => void;
  aoEncerrar: () => void;
}) {
  const [aba, setAba] = useState<'log' | 'regras'>(partida ? 'log' : 'regras');
  const [confirmando, setConfirmando] = useState(false);

  const emPartida = partida !== null && partida.endReason === null;

  /**
   * Encerrar a partida só aparece quando **não há outra pessoa na mesa** — só
   * eu e bots.
   *
   * O comando é do host e sempre existiu (`host:endMatch`), mas nunca teve
   * botão, e é por bom motivo: com gente jogando, encerrar por conta própria
   * tira a partida de todo mundo sem que ninguém possa discordar. Contra bots
   * não há de quem discordar, e ficar preso numa partida que já não interessa
   * é o problema real.
   */
  const souHost = retrato.hostId === eu;
  const outrosHumanos = retrato.players.filter(
    (p) => !p.bot && !p.isSpectator && p.id !== eu && p.connection !== 'SAIU' && p.connection !== 'REMOVIDO',
  ).length;
  const podeEncerrar = emPartida && souHost && outrosHumanos === 0;

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
        {podeEncerrar && !confirmando && (
          <button className="fantasma" onClick={aoEncerrar}>
            Encerrar a partida e voltar ao lobby
          </button>
        )}

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
