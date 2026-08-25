import { useEffect, useRef, useState } from 'react';
import { LIMITS } from '@fdp/protocol';
import { Carta } from '../components/Carta';
import { Chat } from '../components/Chat';
import { Feltro } from '../components/Feltro';
import { Vidas } from '../components/Vidas';
import type { Retrato, PlayerView } from '../state/tipos';

export function Mesa({ retrato, eu, partida, selecionada, aoSelecionar, aoApostar, aoJogar, aoAbrirRegras, aoEnviarChat }: {
  retrato: Retrato;
  eu: string;
  partida: PlayerView;
  selecionada: string | null;
  aoSelecionar: (cardId: string | null) => void;
  aoApostar: (valor: number) => void;
  aoJogar: (cardId: string) => void;
  aoAbrirRegras: () => void;
  aoEnviarChat: (texto: string) => void;
}) {
  const nome = (id: string) => retrato.players.find((p) => p.id === id)?.nickname ?? '—';
  const ausentes = new Set(retrato.pause?.absentPlayerIds ?? []);
  const minhaVez = partida.activePlayerId === eu;
  const pausada = retrato.status === 'PAUSADA';

  return (
    <div className="pilha">
      <Cabecalho partida={partida} retrato={retrato} aoAbrirRegras={aoAbrirRegras} />

      <AvisoDaVaza partida={partida} nome={nome} eu={eu} />

      {partida.isForeheadRound && <FaixaTesta />}

      <Feltro retrato={retrato} eu={eu} partida={partida} />

      {!partida.isForeheadRound && <EmpateNaVaza partida={partida} />}

      {!pausada && minhaVez && (
        partida.phase === 'APOSTAS'
          ? <Apostas partida={partida} aoApostar={aoApostar} />
          : <Jogar selecionada={selecionada} aoJogar={aoJogar} />
      )}

      {!pausada && !minhaVez && partida.activePlayerId && (
        <div className="cartao" style={{ textAlign: 'center' }}>
          <p className="fraco">
            {partida.phase === 'APOSTAS' ? 'Apostando: ' : 'Vez de '}
            <b style={{ color: 'var(--texto)' }}>{nome(partida.activePlayerId)}</b>
          </p>
        </div>
      )}

      {!partida.isForeheadRound && partida.hand.length > 0 && (
        <Mao partida={partida} selecionada={selecionada} aoSelecionar={aoSelecionar} podeJogar={minhaVez && partida.phase === 'VAZAS'} />
      )}

      <Chat mensagens={retrato.chat} eu={eu} aoEnviar={aoEnviarChat} />
    </div>
  );
}

function Cabecalho({ partida, retrato, aoAbrirRegras }: {
  partida: PlayerView; retrato: Retrato; aoAbrirRegras: () => void;
}) {
  const fase = partida.phase === 'APOSTAS' ? 'Fase de apostas' : 'Jogando as mãos';
  const daVez = partida.activePlayerId === retrato.match?.viewerId;
  const estavel = retrato.status !== 'PAUSADA';

  return (
    <div className="cartao" style={{ padding: '10px 0 0' }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '0 14px' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600 }}>
            Rodada {partida.roundNumber} · {partida.cardsThisRound} {partida.cardsThisRound === 1 ? 'carta' : 'cartas'}
          </div>
          <div className="fraco">
            {fase}{daVez ? ' · vez de você' : ''}
            {partida.phase !== 'APOSTAS' && !partida.isForeheadRound &&
              ` · mão ${partida.trickNumber} de ${partida.cardsThisRound}`}
          </div>
        </div>

        {/* Ponto E palavra: cor sozinha não comunica estado (RF-026). */}
        <span style={{ display: 'flex', gap: 4, alignItems: 'center', fontSize: 11, color: 'var(--texto-fraco)' }}>
          <span aria-hidden style={{
            width: 7, height: 7, borderRadius: '50%',
            background: estavel ? '#3fb98a' : 'var(--vidas)',
          }} />
          {estavel ? 'estável' : 'pausada'}
        </span>

        <button
          className="fantasma"
          onClick={aoAbrirRegras}
          aria-label="Abrir as regras"
          style={{ minWidth: 44, width: 44, padding: 0 }}
        >
          ☰
        </button>
      </div>

      <BarraDoTurno retrato={retrato} />
    </div>
  );
}

/**
 * Timer como barra, nunca número em contagem (RF-027): mesma informação, muito
 * menos ansiedade. Some quando não há prazo — barra parada mente sobre o que
 * está acontecendo.
 */
function BarraDoTurno({ retrato }: { retrato: Retrato }) {
  const [agora, setAgora] = useState(Date.now());
  const prazo = retrato.phaseDeadline;

  useEffect(() => {
    if (prazo === null) return;
    const t = setInterval(() => setAgora(Date.now()), 250);
    return () => clearInterval(t);
  }, [prazo]);

  if (prazo === null || retrato.status === 'PAUSADA') {
    return <div style={{ height: 4, margin: '10px 14px 14px' }} />;
  }

  const restante = Math.max(0, prazo - agora);
  // A fração é do prazo mais longo do jogo (a aposta). Não é precisão de
  // cronômetro — é a sensação de tempo passando, que é o que a barra entrega.
  const fracao = Math.min(1, restante / LIMITS.betTimeoutMs);

  return (
    <div style={{ height: 4, borderRadius: 2, background: 'var(--superficie-2)', margin: '10px 14px 14px', overflow: 'hidden' }}>
      <span style={{
        display: 'block', height: '100%', width: `${fracao * 100}%`,
        background: 'var(--acento)', transition: 'width 250ms linear',
      }} />
    </div>
  );
}

/**
 * Quem levou a vaza, dito em palavras, no topo (`07` §2.4).
 *
 * Dispara pelo CRESCIMENTO de `resolvedTricks`, não pela fase: a última vaza
 * da rodada não passa por `RECOLHIMENTO` — vai direto ao acerto de contas — e
 * mesmo assim alguém a levou. Amarrar o aviso à fase deixaria justamente a
 * vaza que fecha a rodada sem anúncio.
 *
 * A referência inicial é a contagem no momento em que a tela monta, e não
 * zero: quem recarrega a página no meio da rodada não deve ver o anúncio de
 * uma vaza que já assistiu.
 */
function AvisoDaVaza({ partida, nome, eu }: {
  partida: PlayerView;
  nome: (id: string) => string;
  eu: string;
}) {
  const [aviso, setAviso] = useState<string | null>(null);
  const [saindo, setSaindo] = useState(false);
  const vistas = useRef(partida.resolvedTricks.length);
  const rodada = useRef(partida.roundNumber);

  useEffect(() => {
    // Rodada nova zera a lista; isso não é vaza recolhida.
    if (partida.roundNumber !== rodada.current) {
      rodada.current = partida.roundNumber;
      vistas.current = partida.resolvedTricks.length;
      return;
    }
    if (partida.resolvedTricks.length <= vistas.current) return;
    vistas.current = partida.resolvedTricks.length;

    const ultima = partida.resolvedTricks[partida.resolvedTricks.length - 1];
    if (!ultima) return;

    setSaindo(false);
    if (ultima.winnerId === null) {
      // Empate silencioso passa por bug (`07` §2.4): diz o valor e quem puxa.
      const puxa = ultima.nextLeaderId;
      setAviso(
        `Empate em ${ultima.annulledValue} — ninguém levou a mão.` +
        (puxa ? ` ${puxa === eu ? 'Você puxa' : `${nome(puxa)} puxa`} a próxima.` : ''),
      );
    } else {
      setAviso(ultima.winnerId === eu ? 'Você levou a mão' : `${nome(ultima.winnerId)} levou a mão`);
    }

    // Dois tempos: aos 2 s começa a sair, e só some do DOM quando a saída
    // termina. Desmontar direto cortaria a animação pela metade.
    const some = setTimeout(() => setSaindo(true), 2_000);
    const desmonta = setTimeout(() => setAviso(null), 2_220);
    return () => { clearTimeout(some); clearTimeout(desmonta); };
  }, [partida.resolvedTricks, partida.roundNumber, nome, eu]);

  if (aviso === null) return null;

  return (
    <div
      // `polite`: o resultado é anunciado sem cortar o que o leitor de tela
      // estiver falando (RNF-035).
      role="status"
      aria-live="polite"
      className={saindo ? 'aviso-vaza saindo' : 'aviso-vaza'}
      style={{
        padding: '8px 12px', borderRadius: 'var(--r-md)', fontSize: 13,
        textAlign: 'center', fontWeight: 600,
        background: 'rgba(63,185,138,0.14)',
        boxShadow: 'inset 0 0 0 1px rgba(63,185,138,0.5)',
      }}
    >
      {aviso}
    </div>
  );
}

/** A tela mais distintiva do jogo, e a que mais precisa de texto explícito. */
function FaixaTesta() {
  return (
    <div style={{
      padding: '10px 12px',
      borderRadius: 'var(--r-md)',
      background: 'rgba(145,132,217,0.12)',
      boxShadow: 'inset 0 0 0 1px var(--acento)',
      fontSize: 13,
    }}>
      <b>Rodada de testa.</b> Você não vê a sua carta — todos os outros veem.
      Aposte pela cara deles.
    </div>
  );
}

function EmpateNaVaza({ partida }: { partida: PlayerView }) {
  const valor = partida.currentTrick?.annulledValue;
  if (valor === null || valor === undefined) return null;
  return (
    <div style={{
      padding: '8px 12px', borderRadius: 'var(--r-md)', fontSize: 13,
      background: 'rgba(255,255,255,0.05)', textAlign: 'center',
    }}>
      Empate em {valor} — ninguém leva a mão.
    </div>
  );
}

function Apostas({ partida, aoApostar }: { partida: PlayerView; aoApostar: (v: number) => void }) {
  const opcoes = Array.from({ length: partida.cardsThisRound + 1 }, (_, i) => i);
  const testa = partida.cardsThisRound === 1;

  return (
    <div className="cartao pilha" style={{ gap: 10 }}>
      <span className="rotulo">sua aposta</span>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {opcoes.map((valor) => {
          const proibida = partida.forbiddenBet === valor;
          // Na testa, "Ganho"/"Perco" em vez de 1/0: é o que a pessoa está
          // realmente dizendo, e some a conta mental.
          const rotulo = testa ? (valor === 1 ? 'Ganho' : 'Perco') : String(valor);
          return (
            <button
              key={valor}
              disabled={proibida}
              onClick={() => aoApostar(valor)}
              style={{ minWidth: 52, flex: testa ? 1 : '0 0 auto' }}
            >
              {rotulo}
              {proibida && <span style={{ display: 'block', fontSize: 9 }}>proibido</span>}
            </button>
          );
        })}
      </div>
      {partida.forbiddenBet !== null && (
        // A regra mais peculiar do jogo. Ninguém pode descobri-la errando.
        <p className="fraco">
          Você é o último a apostar: {partida.forbiddenBet} está proibido porque a
          soma da mesa fecharia em {partida.cardsThisRound}. Alguém vai errar hoje.
        </p>
      )}
    </div>
  );
}

function Jogar({ selecionada, aoJogar }: { selecionada: string | null; aoJogar: (id: string) => void }) {
  return (
    <button disabled={!selecionada} onClick={() => selecionada && aoJogar(selecionada)}>
      {selecionada ? 'Jogar esta carta' : 'Escolha uma carta abaixo'}
    </button>
  );
}

function Mao({ partida, selecionada, aoSelecionar, podeJogar }: {
  partida: PlayerView;
  selecionada: string | null;
  aoSelecionar: (id: string | null) => void;
  podeJogar: boolean;
}) {
  return (
    <div className="pilha" style={{ gap: 6 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <span className="rotulo">suas cartas</span>
        {/* RJ-023: nenhuma carta fica desabilitada — todas são sempre jogáveis. */}
        <span className="fraco">toda carta é jogável</span>
      </div>
      <div style={{ display: 'flex', gap: 6, overflowX: 'auto', padding: '10px 2px 4px' }}>
        {partida.hand.map((carta) => (
          <div key={carta.id} style={{ flex: '0 0 auto' }}>
            <Carta
              carta={carta}
              selecionada={selecionada === carta.id}
              aoClicar={podeJogar ? () => aoSelecionar(selecionada === carta.id ? null : carta.id) : undefined}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * O acerto de contas da rodada, com a conta à vista.
 *
 * `livesLost` vem do servidor e NÃO é recalculado aqui. Eu tinha escrito
 * `|fez − aposta|`, que acerta na rodada comum e erra na abortada (RJ-155),
 * onde ninguém perde vida — a tela mostraria débito que não houve.
 */
export function Resolucao({ partida, nome }: { partida: PlayerView; nome: (id: string) => string }) {
  const ultima = partida.history[partida.history.length - 1];
  if (!ultima) return null;

  const caiu = new Set(ultima.eliminatedThisRound);

  return (
    <div className="cartao pilha" style={{ gap: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <span className="rotulo">rodada {ultima.roundNumber} · acerto de contas</span>
        {ultima.aborted && <span className="fraco">rodada abortada</span>}
      </div>

      {partida.playerOrder.map((id) => {
        const aposta = ultima.bets[id];
        if (aposta === undefined) return null;
        const fez = ultima.tricksWon[id] ?? 0;
        const perdeu = ultima.livesLost[id] ?? 0;

        return (
          <div key={id} className="pilha" style={{ gap: 4 }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 }}>
              <span style={{ flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {nome(id)}
              </span>
              <span style={{ color: 'var(--texto-fraco)' }}>
                apostou {aposta} · fez {fez}
              </span>
              <span style={{
                color: perdeu > 0 ? 'var(--vidas)' : 'var(--texto-medio)',
                fontWeight: 600, minWidth: 44, textAlign: 'right',
              }}>
                {perdeu > 0 ? `−${perdeu} ${perdeu === 1 ? 'vida' : 'vidas'}` : '✓ acertou'}
              </span>
            </div>

            {/* Eliminação tem peso próprio: alguém saiu do jogo, e isso não pode
                passar como mais uma linha de tabela. */}
            {caiu.has(id) && (
              <div style={{
                display: 'flex', gap: 6, alignItems: 'center',
                padding: '6px 10px', borderRadius: 'var(--r-sm)',
                background: 'rgba(239,77,90,0.12)',
                boxShadow: 'inset 0 0 0 1px var(--vidas)',
                fontSize: 12,
              }}>
                <span aria-hidden>☠</span>
                <span><b>{nome(id)}</b> zerou as vidas e está fora.</span>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
