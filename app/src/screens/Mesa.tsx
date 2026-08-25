import { Carta } from '../components/Carta';
import { CartaoJogador } from '../components/CartaoJogador';
import { Vidas } from '../components/Vidas';
import type { Retrato, PlayerView } from '../state/tipos';

export function Mesa({ retrato, eu, partida, selecionada, aoSelecionar, aoApostar, aoJogar }: {
  retrato: Retrato;
  eu: string;
  partida: PlayerView;
  selecionada: string | null;
  aoSelecionar: (cardId: string | null) => void;
  aoApostar: (valor: number) => void;
  aoJogar: (cardId: string) => void;
}) {
  const nome = (id: string) => retrato.players.find((p) => p.id === id)?.nickname ?? '—';
  const ausentes = new Set(retrato.pause?.absentPlayerIds ?? []);
  const minhaVez = partida.activePlayerId === eu;
  const pausada = retrato.status === 'PAUSADA';

  return (
    <div className="pilha">
      <Cabecalho partida={partida} />

      {partida.isForeheadRound && <FaixaTesta />}

      <div className="cartao pilha" style={{ gap: 3 }}>
        {partida.playerOrder.map((id) => {
          const jogador = retrato.players.find((p) => p.id === id);
          if (!jogador) return null;
          return (
            <CartaoJogador
              key={id}
              jogador={jogador}
              partida={partida}
              souEu={id === eu}
              ehHost={retrato.hostId === id}
              ausente={ausentes.has(id)}
            />
          );
        })}
      </div>

      {partida.isForeheadRound
        ? <Testa partida={partida} eu={eu} nome={nome} />
        : <Vaza partida={partida} nome={nome} />}

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
    </div>
  );
}

function Cabecalho({ partida }: { partida: PlayerView }) {
  const fase = partida.phase === 'APOSTAS' ? 'Fase de apostas' : 'Fase de vazas';
  return (
    <div className="cartao" style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '10px 14px' }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600 }}>
          Rodada {partida.roundNumber} · {partida.cardsThisRound} {partida.cardsThisRound === 1 ? 'carta' : 'cartas'}
        </div>
        <div className="fraco">{fase}</div>
      </div>
      {partida.deckCount > 1 && (
        <span className="rotulo" style={{ whiteSpace: 'nowrap' }}>{partida.deckCount} baralhos</span>
      )}
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

function Testa({ partida, eu, nome }: { partida: PlayerView; eu: string; nome: (id: string) => string }) {
  return (
    <div className="cartao pilha" style={{ gap: 10 }}>
      <span className="rotulo">as cartas da mesa</span>
      <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 4 }}>
        {partida.playerOrder.map((id) => {
          const souEu = id === eu;
          // RJ-101: a própria carta NUNCA vem no payload. O verso aqui não é
          // decisão de interface — é o que o servidor mandou.
          const carta = souEu ? null : partida.foreheadCards[id] ?? null;
          return (
            <div key={id} style={{ textAlign: 'center', flex: '0 0 auto' }}>
              <Carta carta={carta} rotulo={souEu ? 'a sua carta, que você não vê' : `carta de ${nome(id)}`} />
              <div style={{ fontSize: 11, color: souEu ? 'var(--acento-claro)' : 'var(--texto-apagado)', marginTop: 4 }}>
                {souEu ? 'você' : nome(id).slice(0, 8)}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Vaza({ partida, nome }: { partida: PlayerView; nome: (id: string) => string }) {
  const vaza = partida.currentTrick;
  if (!vaza || vaza.plays.length === 0) return null;

  return (
    <div className="cartao pilha" style={{ gap: 10, background: 'var(--feltro-escuro)' }}>
      <span className="rotulo">vaza {partida.trickNumber}</span>
      <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 4 }}>
        {vaza.plays.map((jogada) => (
          <div key={jogada.playerId} style={{ textAlign: 'center', flex: '0 0 auto' }}>
            <Carta carta={jogada.card} />
            <div style={{ fontSize: 11, color: 'var(--texto-apagado)', marginTop: 4 }}>
              {nome(jogada.playerId).slice(0, 8)}
            </div>
          </div>
        ))}
      </div>
      {vaza.annulledValue !== null && (
        // Empate silencioso parece defeito. Dizer é obrigação.
        <p className="fraco">Empate em {vaza.annulledValue} — ninguém leva a vaza.</p>
      )}
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
        <span className="rotulo">sua mão</span>
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

export function Resolucao({ partida, nome }: { partida: PlayerView; nome: (id: string) => string }) {
  const ultima = partida.history[partida.history.length - 1];
  if (!ultima) return null;
  return (
    <div className="cartao pilha" style={{ gap: 8 }}>
      <span className="rotulo">rodada {ultima.roundNumber} fechou</span>
      {Object.entries(ultima.bets ?? {}).map(([id, aposta]) => {
        const fez = ultima.tricksWon?.[id] ?? 0;
        const erro = Math.abs(fez - (aposta as number));
        return (
          <div key={id} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 }}>
            <span style={{ flex: 1, minWidth: 0 }}>{nome(id)}</span>
            {/* A conta à vista: um número que só muda não conta história. */}
            <span style={{ color: 'var(--texto-fraco)' }}>
              apostou {aposta as number} · fez {fez}
            </span>
            <span style={{ color: erro ? 'var(--vidas)' : 'var(--texto-medio)', fontWeight: 600 }}>
              {erro ? `−${erro}` : 'certo'}
            </span>
            <Vidas quantas={partida.lives[id] ?? 0} />
          </div>
        );
      })}
    </div>
  );
}
