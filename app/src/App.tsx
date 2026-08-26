import { useEffect, useRef, useState } from 'react';
import { LIMITS, PROTOCOL_VERSION, type Avatar as AvatarProto } from '@fdp/protocol';
import { conectar, type Conexao } from './net/socket';
import { createReconciler } from './net/reconcile';
import { reduzir } from './state/redutores';
import * as sessao from './net/sessao';
import { frase } from './net/mensagens';
import { jogadaAutomatica } from './jogada';
import { carregarPreferenciaDeSom, despertarSomNoPrimeiroGesto } from './som';
import { useEstado, definir, ler, avisar, errar } from './state/loja';
import type { Retrato } from './state/tipos';
import type { Reconciler } from './net/reconcile';
import { BloqueioConexao, FaixaConexao, bloqueia } from './components/Conexao';
import { Home } from './screens/Home';
import { Perfil } from './screens/Perfil';
import { Folha } from './components/Folha';
import { Menu } from './screens/Menu';
import { Regras } from './screens/Regras';
import { Lobby } from './screens/Lobby';
import { Mesa, Resolucao } from './screens/Mesa';
import { Pausa } from './screens/Pausa';
import { Fim } from './screens/Fim';

export function App() {
  const estado = useEstado();
  const conexao = useRef<Conexao | null>(null);
  /**
   * Já pedimos para sair. Entre o comando e o socket fechar existe uma janela
   * de milissegundos em que o servidor ainda responde — e responde que este
   * jogador não está mais na sala, o que é verdade e vira um erro vermelho na
   * cara de quem acabou de decidir ir embora. Depois do pedido, nada mais do
   * servidor precisa de reação.
   */
  const saindo = useRef(false);
  /**
   * `05` §3: decide, para cada quadro, entre aplicar, descartar e pedir o
   * estado inteiro. Estava escrito e testado desde o começo, e até agora não
   * era usado — o cliente pedia o retrato a cada evento, o que é sempre
   * correto e nunca aproveitava a versão que vem no quadro.
   */
  const reconciliador = useRef(createReconciler());
  const [regrasAbertas, setRegrasAbertas] = useState(false);
  // O que o Perfil vai fazer ao confirmar: criar sala, entrar numa, ou só
  // salvar (quando já se está na mesa).
  const [intencao, setIntencao] = useState<{ tipo: 'CRIAR' } | { tipo: 'ENTRAR'; codigo: string } | null>(null);
  const [perfilAberto, setPerfilAberto] = useState(false);

  const entrar = (s: sessao.Sessao) => {
    saindo.current = false;
    sessao.guardar(s.roomCode, s.sessionToken);
    sessao.lembrarSala(s.roomCode);
    definir({ tela: 'sala', eu: s.playerId, codigo: s.roomCode });
    conexao.current?.fechar();
    // Socket novo: o estado local não vale mais nada até o próximo snapshot.
    reconciliador.current.reset();
    conexao.current = conectar(s.wsUrl, s.sessionToken, {
      aoReceber: (msg) => {
        if (!saindo.current) receber(msg, reconciliador.current, () => conexao.current);
      },
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

  // Versão do PROTOCOLO, não do build: um deploy comum atravessa a partida sem
  // incomodar ninguém (CA-046), e só uma incompatibilidade de verdade obriga a
  // recarregar. Conferido na entrada e a cada volta de foco — que é quando a
  // pessoa larga o celular no meio da partida e volta depois do deploy.
  useEffect(() => {
    const conferir = async () => {
      try {
        const r = await fetch('/api/health');
        const d = (await r.json()) as { protocolVersion?: number };
        if (typeof d.protocolVersion === 'number' && d.protocolVersion !== PROTOCOL_VERSION) {
          definir({ conexao: 'DESATUALIZADO' });
        }
      } catch {
        // Sem rede a checagem não diz nada; quem cuida disso é a reconexão.
      }
    };
    void conferir();
    const aoVoltar = () => { if (document.visibilityState === 'visible') void conferir(); };
    document.addEventListener('visibilitychange', aoVoltar);
    return () => document.removeEventListener('visibilitychange', aoVoltar);
  }, []);

  /**
   * A carta engatilhada sai sozinha quando a vez chega.
   *
   * Roda no cliente, e não no servidor, de propósito: é uma comodidade de
   * quem está jogando, não uma regra. Se a aba fechar, se a rede cair, se a
   * pessoa mudar de ideia — não há nada engatilhado do outro lado, e o que
   * acontece é o mesmo de sempre: o prazo corre e o auto-play resolve.
   *
   * A decisão em si mora em `jogadaAutomatica`, fora daqui e testável; o que
   * sobra neste efeito é o envio e o relógio.
   */
  /**
   * O áudio da mesa, ligado uma vez por sessão.
   *
   * Faltavam as duas pontas: a preferência salva nunca era lida de volta — quem
   * desligava o som ouvia tudo de novo ao recarregar —, e o contexto de áudio
   * nascia dentro de um efeito, que não é gesto do usuário. O navegador cria
   * esse contexto **suspenso** e não reclama: os avisos saíam mudos a sessão
   * inteira, sem nada no console para denunciar.
   */
  useEffect(() => {
    carregarPreferenciaDeSom();
    return despertarSomNoPrimeiroGesto();
  }, []);

  useEffect(() => {
    const p = estado.retrato?.match;
    if (!p) return;

    const decisao = jogadaAutomatica(
      p,
      estado.eu,
      estado.retrato?.status === 'PAUSADA',
      estado.cartaPreJogada,
    );

    if (decisao.acao === 'nada') return;
    if (decisao.acao === 'esquecer') { definir({ cartaPreJogada: null }); return; }

    const mandar = () => {
      definir({ cartaPreJogada: null, cartaSelecionada: null });
      enviar('move:playCard', {
        matchId: p.matchId,
        roundNumber: p.roundNumber,
        trickNumber: p.trickNumber,
        cardId: decisao.cardId,
      });
    };

    if (decisao.atrasoMs === 0) { mandar(); return; }
    const t = setTimeout(mandar, decisao.atrasoMs);
    return () => clearTimeout(t);
  }, [estado.retrato, estado.cartaPreJogada, estado.eu]);

  const voltarAoInicio = () => {
    if (estado.codigo) sessao.esquecer(estado.codigo);
    localStorage.removeItem('fdp.ultima');
    conexao.current?.fechar();
    definir({ tela: 'home', retrato: null, codigo: null, eu: null, conexao: 'CONECTADO' });
  };

  // "Jogar aqui": reabre o socket desta aba, que assume a sessão de volta.
  const jogarAqui = () => {
    const codigo = estado.codigo;
    if (!codigo) return voltarAoInicio();
    const token = sessao.guardado(codigo);
    if (!token) return voltarAoInicio();
    void sessao.retomarSessao(codigo, token).then(entrar).catch(voltarAoInicio);
  };

  const bloqueioAtual = (
    <BloqueioConexao
      estado={estado.conexao}
      codigo={estado.codigo}
      aoJogarAqui={jogarAqui}
      aoVoltar={voltarAoInicio}
    />
  );

  const enviar = (tipo: string, payload?: unknown) =>
    conexao.current?.enviar(tipo as never, payload);

  /**
   * Sair da mesa DE PROPÓSITO, que não é a mesma coisa que cair.
   *
   * Fechar o socket e ir embora faria o servidor tratar como queda: os outros
   * veriam "fulano caiu", a mesa esperaria por alguém que não vai voltar e, no
   * meio de uma partida, pausaria. O comando diz que a saída foi decidida, e a
   * sala trata como saída.
   *
   * O `setTimeout` existe porque fechar o socket no mesmo tique descartaria o
   * quadro recém-enfileirado: a mensagem sairia pela metade, ou não sairia.
   */
  const sairDaMesa = () => {
    saindo.current = true;
    enviar('player:leave');
    setTimeout(voltarAoInicio, 150);
  };

  const foraDaSala = estado.tela === 'home' || estado.tela === 'perfil';

  if (foraDaSala || !estado.retrato) {
    return (
      <Casca>
        <FaixaConexao estado={foraDaSala && !bloqueia(estado.conexao) ? 'CONECTADO' : estado.conexao} />

        {estado.tela === 'home' && (
          <Home
            codigoInicial={new URLSearchParams(location.search).get('sala') ?? ''}
            aoAbrirRegras={() => setRegrasAbertas(true)}
            aoCriar={() => { setIntencao({ tipo: 'CRIAR' }); definir({ tela: 'perfil' }); }}
            aoEntrar={(codigo) => { setIntencao({ tipo: 'ENTRAR', codigo }); definir({ tela: 'perfil' }); }}
          />
        )}

        {estado.tela === 'perfil' && (
          <Perfil
            aoVoltar={() => definir({ tela: 'home' })}
            aoConfirmar={(apelido, avatar) => {
              if (intencao?.tipo === 'ENTRAR') juntar(intencao.codigo, apelido, avatar, entrar);
              else criar(apelido, avatar, entrar);
            }}
          />
        )}

        {estado.tela === 'sala' && !estado.retrato && <p className="fraco">Entrando na sala…</p>}

        <Erro texto={estado.erro} />
        {bloqueioAtual}
        {/* Fora da sala não há mesa para voltar nem partida para abandonar:
            só as regras. O ☰ completo pressupõe as duas coisas. */}
        {regrasAbertas && (estado.retrato ? (
          <Menu
            retrato={estado.retrato}
            partida={estado.retrato.match}
            eu={estado.eu ?? ''}
            aoFechar={() => setRegrasAbertas(false)}
            aoSair={sairDaMesa}
            aoEncerrar={() => { enviar('host:endMatch'); setRegrasAbertas(false); }}
          />
        ) : (
          <Folha
            rotulo="Como se joga"
            aoFechar={() => setRegrasAbertas(false)}
            cabecalho={<b style={{ fontSize: 15 }}>Como se joga</b>}
          >
            <Regras />
            <button onClick={() => setRegrasAbertas(false)}>Voltar</button>
          </Folha>
        ))}
      </Casca>
    );
  }

  const retrato = estado.retrato;
  const eu = estado.eu!;
  const souEu = retrato.players.find((p) => p.id === eu);
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

      {/* Perfil sobre a sala, como as regras: quem troca de cara no lobby
          quer voltar para o lobby, não recomeçar de algum lugar. */}
      {perfilAberto && (
        <Sobreposicao>
          <Perfil
            inicial={souEu}
            jaNaMesa={retrato.players}
            eu={eu}
            aoVoltar={() => setPerfilAberto(false)}
            aoConfirmar={(nickname, avatar) => {
              enviar('player:setProfile', { nickname, avatar });
              setPerfilAberto(false);
            }}
          />
        </Sobreposicao>
      )}

      {acabou && partida ? (
        <Fim
          retrato={retrato}
          eu={eu}
          partida={partida}
          aoRevanche={() => enviar('host:rematch')}
          aoSair={sairDaMesa}
          aoVoltarAoLobby={() => enviar('host:toLobby')}
        />
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
            aoAbrirRegras={() => setRegrasAbertas(true)}
            aoEnviarChat={(text) => enviar('chat:send', { text })}
            preJogada={estado.cartaPreJogada?.cardId ?? null}
            aoPreJogar={(cardId) => definir({
              // `null` é o toque que desarma. Armada, a carta anota a mão em
              // que foi armada — é o que impede um gatilho esquecido de
              // disparar numa rodada seguinte.
              cartaPreJogada: cardId === null ? null : {
                cardId,
                roundNumber: partida.roundNumber,
                trickNumber: partida.trickNumber,
              },
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
          aoAbrirPerfil={() => setPerfilAberto(true)}
          aoAbrirRegras={() => setRegrasAbertas(true)}
          aoSair={sairDaMesa}
          aoEnviarChat={(text) => enviar('chat:send', { text })}
        />
      )}

      <Avisos avisos={estado.avisos} />
      <Erro texto={estado.erro} />
      {bloqueioAtual}
      {regrasAbertas && (
        <Menu
          retrato={retrato}
          partida={partida}
          eu={eu}
          aoFechar={() => setRegrasAbertas(false)}
          aoSair={sairDaMesa}
          aoEncerrar={() => { enviar('host:endMatch'); setRegrasAbertas(false); }}
        />
      )}
    </Casca>
  );
}

/** Uma tela inteira por cima da atual, com o mesmo respiro da casca. */
function Sobreposicao({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 15,
      background: 'var(--fundo)', overflowY: 'auto',
      padding: '12px 12px calc(24px + env(safe-area-inset-bottom))',
    }}>
      <div style={{ maxWidth: 460, margin: '0 auto' }}>{children}</div>
    </div>
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
 * O caminho de um quadro do servidor.
 *
 * Duas decisões em sequência, e elas são diferentes: o **reconciliador** olha a
 * versão e diz se este quadro pode ser aplicado; o **redutor** olha o conteúdo
 * e diz se sabe aplicá-lo. Qualquer um dos dois em dúvida termina no mesmo
 * lugar — pedir o retrato ao servidor, que é a autoridade.
 */
function receber(
  msg: { type: string; payload: unknown; stateVersion?: number },
  reconciliador: Reconciler,
  conexao: () => Conexao | null,
): void {
  if (msg.type === 'error') {
    const p = msg.payload as { code: string; params?: { motivo?: string } };
    errar(frase(p.params?.motivo, p.code));
    return;
  }

  const decisao = reconciliador.receive({ type: msg.type, stateVersion: msg.stateVersion ?? 0 });

  if (decisao.action === 'RESYNC') {
    conexao()?.enviar('room:resync' as never, {});
    return;
  }
  if (decisao.action === 'DISCARD') return;

  if (msg.type === 'room:snapshot') {
    definir({ retrato: msg.payload as Retrato, cartaSelecionada: null });
    return;
  }

  narrar(msg);

  const atual = ler().retrato;
  const reduzido = atual ? reduzir(atual, msg) : null;

  if (reduzido) {
    definir({ retrato: reduzido });
    return;
  }

  // O redutor não soube: o retrato inteiro resolve, como sempre resolveu.
  conexao()?.enviar('room:resync' as never, {});
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
    // `trick:resolved` NÃO vira aviso genérico: quem anuncia a vaza é a faixa
    // do topo da Mesa, que aparece junto das cartas ainda na mesa e some
    // sozinha. Os dois juntos diziam a mesma coisa em dois lugares, e o de
    // baixo ficava depois do chat, longe do que estava sendo explicado.
    case 'match:resumed': avisar('Partida retomada'); break;
    case 'round:aborted': avisar('A rodada recomeçou sem quem saiu'); break;
    case 'round:revealed': avisar('Cartas na mesa'); break;
    case 'system:notice':
      if ((p['code'] as unknown as string) === 'PLAYER_DOOMED') {
        avisar(`${nome((p['params'] as unknown as { playerId: string }).playerId)} já era — cai nesta rodada`);
      }
      if ((p['code'] as unknown as string) === 'MATCH_DECIDED_EARLY') {
        const puladas = (p['params'] as unknown as { skippedTricks: number }).skippedTricks;
        avisar(`Já está decidido — ${puladas === 1 ? 'a última mão não muda' : `as ${puladas} mãos que faltam não mudam`} nada`);
      }
      break;
    default: break;
  }
}
