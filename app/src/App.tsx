import { useEffect, useRef } from 'react';
import type { Avatar as AvatarProto } from '@fdp/protocol';
import { conectar, type Conexao } from './net/socket';
import * as sessao from './net/sessao';
import { frase } from './net/mensagens';
import { useEstado, definir, ler, avisar, errar } from './state/loja';
import type { Retrato } from './state/tipos';
import { FaixaConexao } from './components/Conexao';
import { Home } from './screens/Home';
import { Lobby } from './screens/Lobby';
import { Mesa, Resolucao } from './screens/Mesa';
import { Pausa } from './screens/Pausa';
import { Fim } from './screens/Fim';

export function App() {
  const estado = useEstado();
  const conexao = useRef<Conexao | null>(null);

  const entrar = (s: sessao.Sessao) => {
    sessao.guardar(s.roomCode, s.sessionToken);
    sessao.lembrarSala(s.roomCode);
    definir({ tela: 'sala', eu: s.playerId, codigo: s.roomCode });
    conexao.current?.fechar();
    conexao.current = conectar(s.wsUrl, s.sessionToken, {
      aoReceber: (msg) => receber(msg, () => conexao.current),
      aoMudarEstado: (c) => definir({ conexao: c }),
    });
  };

  // Retomar a sessão guardada é a primeira coisa que acontece: recarregar a
  // página não pode custar o lugar na mesa (CA-007).
  useEffect(() => {
    void sessao.retomar().then((s) => { if (s) entrar(s); });
    return () => conexao.current?.fechar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const enviar = (tipo: string, payload?: unknown) =>
    conexao.current?.enviar(tipo as never, payload);

  if (estado.tela === 'home' || !estado.retrato) {
    return (
      <Casca>
        <FaixaConexao estado={estado.tela === 'home' ? 'CONECTADO' : estado.conexao} />
        {estado.tela === 'home' ? (
          <Home
            codigoInicial={new URLSearchParams(location.search).get('sala') ?? ''}
            aoCriar={(apelido, avatar) => criar(apelido, avatar, entrar)}
            aoEntrar={(codigo, apelido, avatar) => juntar(codigo, apelido, avatar, entrar)}
          />
        ) : (
          <p className="fraco">Entrando na sala…</p>
        )}
        <Erro texto={estado.erro} />
      </Casca>
    );
  }

  const retrato = estado.retrato;
  const eu = estado.eu!;
  const partida = retrato.match;
  const acabou = partida?.endReason != null;
  const nome = (id: string) => retrato.players.find((p) => p.id === id)?.nickname ?? '—';

  return (
    <Casca>
      <FaixaConexao estado={estado.conexao} />

      {retrato.status === 'PAUSADA' && (
        <Pausa
          retrato={retrato}
          eu={eu}
          aoResolver={(action) => enviar('host:resolveAbsence', { action })}
        />
      )}

      {acabou && partida ? (
        <Fim retrato={retrato} eu={eu} partida={partida} aoRevanche={() => enviar('host:rematch')} />
      ) : partida ? (
        <>
          <Mesa
            retrato={retrato}
            eu={eu}
            partida={partida}
            selecionada={estado.cartaSelecionada}
            aoSelecionar={(id) => definir({ cartaSelecionada: id })}
            aoApostar={(bet) => enviar('move:bet', {
              matchId: partida.matchId,
              roundNumber: partida.roundNumber,
              trickNumber: partida.trickNumber,
              bet,
            })}
            aoJogar={(cardId) => {
              enviar('move:playCard', {
                matchId: partida.matchId,
                roundNumber: partida.roundNumber,
                trickNumber: partida.trickNumber,
                cardId,
              });
              definir({ cartaSelecionada: null });
            }}
          />
          {partida.phase === 'RESOLUCAO' && <Resolucao partida={partida} nome={nome} />}
        </>
      ) : (
        <Lobby
          retrato={retrato}
          eu={eu}
          aoIniciar={() => enviar('host:startMatch')}
          aoExpulsar={(playerId) => enviar('host:kick', { playerId })}
          aoAdicionarBot={(difficulty) => enviar('host:addBot', { difficulty })}
          aoRemoverBot={(playerId) => enviar('host:removeBot', { playerId })}
        />
      )}

      <Avisos avisos={estado.avisos} />
      <Erro texto={estado.erro} />
    </Casca>
  );
}

function Casca({ children }: { children: React.ReactNode }) {
  return (
    <main style={{
      maxWidth: 460,
      margin: '0 auto',
      padding: '12px 12px calc(16px + env(safe-area-inset-bottom))',
      display: 'flex',
      flexDirection: 'column',
      gap: 12,
    }}>
      {children}
    </main>
  );
}

function Erro({ texto }: { texto: string | null }) {
  if (!texto) return null;
  return (
    <div role="alert" style={{
      position: 'fixed', left: '50%', bottom: 16, transform: 'translateX(-50%)',
      background: 'var(--vidas)', color: '#fff', padding: '11px 16px',
      borderRadius: 'var(--r-md)', maxWidth: '92vw', zIndex: 9,
    }}>
      {texto}
    </div>
  );
}

function Avisos({ avisos }: { avisos: { id: string; texto: string }[] }) {
  if (avisos.length === 0) return null;
  return (
    <div role="status" className="pilha" style={{ gap: 4 }}>
      {avisos.map((a) => (
        <div key={a.id} style={{
          fontSize: 13, padding: '8px 10px', borderRadius: 'var(--r-sm)',
          background: 'rgba(255,255,255,0.05)', color: 'var(--texto-medio)',
        }}>
          {a.texto}
        </div>
      ))}
    </div>
  );
}

async function criar(apelido: string, avatar: AvatarProto, entrar: (s: sessao.Sessao) => void) {
  try { entrar(await sessao.criarSala(apelido, avatar)); }
  catch (e) { errar((e as Error).message); }
}

async function juntar(codigo: string, apelido: string, avatar: AvatarProto, entrar: (s: sessao.Sessao) => void) {
  try { entrar(await sessao.entrarNaSala(codigo, apelido, avatar)); }
  catch (e) { errar((e as Error).message); }
}

/**
 * Todo evento que muda o jogo pede o retrato novo. Simples e sempre correto —
 * o servidor é a autoridade. Os redutores por evento, que evitariam essa ida e
 * volta, ainda não existem.
 */
function receber(msg: { type: string; payload: unknown }, conexao: () => Conexao | null) {
  if (msg.type === 'room:snapshot') {
    definir({ retrato: msg.payload as Retrato, cartaSelecionada: null });
    return;
  }
  if (msg.type === 'error') {
    const p = msg.payload as { code: string; params?: { motivo?: string } };
    errar(frase(p.params?.motivo, p.code));
    return;
  }
  narrar(msg);
  if (msg.type !== 'ack') conexao()?.enviar('room:resync' as never, {});
}

/** Nada que muda a mesa pode acontecer em silêncio. */
function narrar(msg: { type: string; payload: unknown }) {
  const p = (msg.payload ?? {}) as Record<string, never>;
  const retrato = ler().retrato;
  const nome = (id: string | undefined) => retrato?.players.find((x) => x.id === id)?.nickname ?? 'alguém';

  switch (msg.type) {
    case 'move:autoPlayed': {
      const kind = p['kind'] as unknown as string;
      const valor = p['value'] as unknown;
      avisar(`${nome(p['playerId'])} ficou sem tempo: ${kind === 'BET' ? `apostou ${String(valor)}` : 'jogou sozinho'}`);
      break;
    }
    case 'trick:resolved': {
      const anulada = p['annulled'] as unknown as boolean;
      avisar(anulada
        ? `Empate em ${String(p['annulledValue'])} — ninguém leva a vaza`
        : `${nome(p['winnerId'])} levou a vaza`);
      break;
    }
    case 'match:resumed': avisar('Partida retomada'); break;
    case 'round:aborted': avisar('A rodada recomeçou sem quem saiu'); break;
    case 'round:revealed': avisar('Cartas na mesa'); break;
    case 'system:notice':
      if ((p['code'] as unknown as string) === 'PLAYER_DOOMED') {
        avisar(`${nome((p['params'] as unknown as { playerId: string }).playerId)} já era — cai nesta rodada`);
      }
      break;
    default: break;
  }
}
