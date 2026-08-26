import { useEffect, useRef, useState } from 'react';
import { LIMITS } from '@fdp/protocol';
import { deveAvisarVez, fracaoDaBarra, intervaloDoTique, urgenciaDoTique, verPrazo } from '../avisos';
import type { PrazoVisto } from '../avisos';
import { tocarSuaVez, tocarTique } from '../som';
import { Carta } from '../components/Carta';
import { Chat } from '../components/Chat';
import { Historico } from '../components/Historico';
import { Feltro } from '../components/Feltro';
import { Vidas } from '../components/Vidas';
import type { Retrato, PlayerView } from '../state/tipos';

export function Mesa({ retrato, eu, partida, selecionada, aoSelecionar, aoApostar, aoJogar, aoAbrirRegras, aoEnviarChat, preJogada, aoPreJogar }: {
  retrato: Retrato;
  eu: string;
  partida: PlayerView;
  selecionada: string | null;
  aoSelecionar: (cardId: string | null) => void;
  aoApostar: (valor: number) => void;
  aoJogar: (cardId: string) => void;
  aoAbrirRegras: () => void;
  aoEnviarChat: (texto: string) => void;
  preJogada: string | null;
  aoPreJogar: (id: string | null) => void;
}) {
  const nome = (id: string) => retrato.players.find((p) => p.id === id)?.nickname ?? '—';

  useAvisosSonoros(retrato, eu);
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
          : <Jogar selecionada={selecionada} aoJogar={aoJogar} unica={partida.hand.length === 1} />
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
        <Mao
          partida={partida}
          selecionada={selecionada}
          preJogada={preJogada}
          aoSelecionar={aoSelecionar}
          aoPreJogar={aoPreJogar}
          podeJogar={minhaVez && partida.phase === 'VAZAS'}
        />
      )}

      <Chat mensagens={retrato.chat} eu={eu} aoEnviar={aoEnviarChat} />

      <Historico partida={partida} jogadores={retrato.players} eu={eu} />
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
 * Os dois avisos sonoros da vez: quando ela chega, e quando está acabando.
 *
 * Vive aqui, e não dentro da barra, porque o som não depende de a barra estar
 * na tela — e porque um efeito que toca som escondido dentro de um componente
 * de desenho é o tipo de coisa que ninguém acha depois.
 */
function useAvisosSonoros(retrato: Retrato, eu: string): void {
  const daVez = retrato.match?.activePlayerId ?? null;
  const anterior = useRef<string | null>(null);
  const prazo = retrato.phaseDeadline;
  // Mesma dedução de duração que a barra usa, e de propósito a mesma função:
  // com duas cópias da conta, o tique e a barra acabariam discordando sobre
  // quanto tempo resta, e o som avisaria de um aperto que a barra não mostra.
  const inicio = useRef<PrazoVisto>({ prazo: 0, total: 1 });

  useEffect(() => {
    if (deveAvisarVez(anterior.current, daVez, eu, retrato.status === 'PAUSADA')) tocarSuaVez();
    anterior.current = daVez;
  }, [daVez, eu, retrato.status]);

  useEffect(() => {
    if (prazo === null || daVez !== eu || retrato.status === 'PAUSADA') return;

    inicio.current = verPrazo(inicio.current, prazo, Date.now());

    let vivo = true;
    let timer: ReturnType<typeof setTimeout>;

    // O intervalo é recalculado a cada tique, e é isso que produz a
    // aceleração: um `setInterval` fixo daria um metrônomo, que não comunica
    // que o tempo está acabando.
    const proximo = () => {
      if (!vivo) return;
      const fracao = fracaoDaBarra(inicio.current, prazo, Date.now());
      const espera = intervaloDoTique(fracao);
      if (espera === null) { timer = setTimeout(proximo, 250); return; }
      if (fracao <= 0) return;
      tocarTique(urgenciaDoTique(fracao));
      timer = setTimeout(proximo, espera);
    };

    timer = setTimeout(proximo, 250);
    return () => { vivo = false; clearTimeout(timer); };
  }, [prazo, daVez, eu, retrato.status]);
}

/**
 * Timer como barra, nunca número em contagem (RF-027): mesma informação, muito
 * menos ansiedade. Some quando não há prazo — barra parada mente sobre o que
 * está acontecendo.
 */
function BarraDoTurno({ retrato }: { retrato: Retrato }) {
  const [agora, setAgora] = useState(Date.now());
  const prazo = retrato.phaseDeadline;

  /**
   * Quanto durava este prazo quando ele apareceu.
   *
   * A barra normalizava pelo prazo da APOSTA (45 s) sempre — então uma vez de
   * jogar carta (30 s) nascia em 67% e a vez de um bot (900 ms) nascia em 2%.
   * O cliente não recebe a duração, só o instante final; guardar o maior
   * restante já visto para cada prazo dá a duração sem inventar tabela de
   * fases, e funciona igual para prazo que ainda não existe hoje.
   *
   * Se a tela só vir o prazo no meio dele — depois de um resync, por exemplo —,
   * a barra começa cheia e esvazia até o fim. É o comportamento certo: ela
   * mostra o tempo que RESTA, não o que já passou.
   */
  const duracao = useRef<PrazoVisto>({ prazo: 0, total: 1 });
  if (prazo !== null) duracao.current = verPrazo(duracao.current, prazo, Date.now());

  useEffect(() => {
    if (prazo === null) return;
    const t = setInterval(() => setAgora(Date.now()), 250);
    return () => clearInterval(t);
  }, [prazo]);

  if (prazo === null || retrato.status === 'PAUSADA') {
    return <div style={{ height: 4, margin: '10px 14px 14px' }} />;
  }

  const fracao = fracaoDaBarra(duracao.current, prazo, agora);
  // Só o dono da vez precisa se apressar; para os outros a barra é informação,
  // não pressão. Sem isto a mesa inteira ficaria vermelha ao mesmo tempo.
  const minhaVez = retrato.match?.activePlayerId === retrato.match?.viewerId;
  const apertando = minhaVez && fracao <= 0.25;

  return (
    <div style={{ height: 4, borderRadius: 2, background: 'var(--superficie-2)', margin: '10px 14px 14px', overflow: 'hidden' }}>
      <span
        className={apertando ? 'barra-apertando' : undefined}
        style={{
          display: 'block', height: '100%', width: `${fracao * 100}%`,
          background: apertando ? 'var(--vidas)' : 'var(--acento)',
          transition: 'width 250ms linear, background 400ms ease',
        }}
      />
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

function Jogar({ selecionada, aoJogar, unica }: {
  selecionada: string | null;
  aoJogar: (id: string) => void;
  /** Só resta uma carta: ela sai sozinha, e o botão vira aviso. */
  unica: boolean;
}) {
  if (unica) {
    return (
      <div className="cartao" style={{ textAlign: 'center' }}>
        <p className="fraco">Sua última carta — ela sai sozinha.</p>
      </div>
    );
  }
  return <JogarBotao selecionada={selecionada} aoJogar={aoJogar} />;
}

function JogarBotao({ selecionada, aoJogar }: { selecionada: string | null; aoJogar: (id: string) => void }) {
  return (
    <button disabled={!selecionada} onClick={() => selecionada && aoJogar(selecionada)}>
      {selecionada ? 'Jogar esta carta' : 'Escolha uma carta abaixo'}
    </button>
  );
}

function Mao({ partida, selecionada, preJogada, aoSelecionar, aoPreJogar, podeJogar }: {
  partida: PlayerView;
  selecionada: string | null;
  preJogada: string | null;
  aoSelecionar: (id: string | null) => void;
  aoPreJogar: (id: string | null) => void;
  podeJogar: boolean;
}) {
  // Fora da vez, na fase de vazas, o toque deixa a carta engatilhada.
  const podePreJogar = !podeJogar && partida.phase === 'VAZAS' && partida.hand.length > 0;

  return (
    <div className="pilha" style={{ gap: 6 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <span className="rotulo">suas cartas</span>
        {preJogada
          ? <span className="fraco" style={{ color: 'var(--acento-claro)' }}>sai sozinha na sua vez</span>
          /* RJ-023: nenhuma carta fica desabilitada — todas são sempre jogáveis. */
          : <span className="fraco">{podePreJogar ? 'toque para deixar engatilhada' : 'toda carta é jogável'}</span>}
      </div>
      <div style={{ display: 'flex', gap: 6, overflowX: 'auto', padding: '10px 2px 4px' }}>
        {partida.hand.map((carta) => {
          const engatilhada = preJogada === carta.id;
          return (
            <div key={carta.id} style={{ flex: '0 0 auto', position: 'relative' }}>
              <Carta
                carta={carta}
                selecionada={selecionada === carta.id || engatilhada}
                rotulo={engatilhada
                  ? `${carta.rank} de ${carta.suit}, engatilhada para a sua vez`
                  : undefined}
                aoClicar={
                  podeJogar
                    ? () => aoSelecionar(selecionada === carta.id ? null : carta.id)
                    : podePreJogar
                      ? () => aoPreJogar(engatilhada ? null : carta.id)
                      : undefined
                }
              />
              {/* A marca é o que separa "escolhida" de "vai sair sozinha".
                  Sem ela, as duas se parecem e a segunda surpreende. */}
              {engatilhada && (
                <span
                  aria-hidden
                  style={{
                    position: 'absolute', top: -6, right: -4,
                    background: 'var(--acento)', color: '#12101d',
                    fontSize: 9, fontWeight: 700, lineHeight: 1,
                    padding: '2px 4px', borderRadius: 6,
                  }}
                >
                  ⏱
                </span>
              )}
            </div>
          );
        })}
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
