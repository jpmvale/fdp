import { Avatar } from '../components/Avatar';
import { CORES, desempenhoDaPartida } from '../desempenho';
import { Vidas } from '../components/Vidas';
import type { EndReason } from '@fdp/rules';
import type { Retrato, PlayerView } from '../state/tipos';

/**
 * `EndReason` de `02`, em português de gente. Eu tinha escrito esta tabela de
 * cabeça, com nomes em inglês que NÃO existem no motor — o resultado é que a
 * tela de fim mostrava a constante crua (`VITORIA`) em vez da frase. Só
 * apareceu jogando até o fim.
 */
const MOTIVOS: Record<EndReason, string> = {
  VITORIA: 'Último de pé.',
  VITORIA_POR_ABANDONO: 'Os outros abandonaram a mesa.',
  JOGADORES_INSUFICIENTES: 'Ficou gente de menos para continuar.',
  ENCERRADA_PELO_HOST: 'O host encerrou a partida.',
  ENCERRADA_POR_AUSENCIA: 'A pausa passou do limite esperando quem caiu.',
};

export function Fim({ retrato, eu, partida, aoRevanche, aoSair }: {
  retrato: Retrato;
  eu: string;
  partida: PlayerView;
  aoRevanche: () => void;
  aoSair: () => void;
}) {
  const vencedores = partida.winnerIds ?? [];
  const souHost = retrato.hostId === eu;
  const saiu = new Set(partida.withdrawn.map((w) => w.playerId));

  // Quem abandonou fica ABAIXO de todos (RJ-129), independente das vidas com
  // que saiu: sair não pode ser um jeito de terminar melhor.
  const ordem = [...partida.playerOrder].sort((a, b) => {
    if (saiu.has(a) !== saiu.has(b)) return saiu.has(a) ? 1 : -1;
    return (partida.lives[b] ?? 0) - (partida.lives[a] ?? 0);
  });

  return (
    <div className="pilha">
      <div className="cartao pilha" style={{ gap: 8, textAlign: 'center', padding: 20 }}>
        <span className="rotulo">fim de partida</span>
        <div style={{ fontSize: 28, fontWeight: 500 }}>
          {vencedores.length === 0
            ? 'Sem vencedor'
            : vencedores.map((id) => retrato.players.find((p) => p.id === id)?.nickname ?? '?').join(' e ')}
        </div>
        <p className="fraco">{partida.endReason ? MOTIVOS[partida.endReason] : ''}</p>
      </div>

      <div className="cartao pilha" style={{ gap: 4 }}>
        <span className="rotulo">classificação</span>
        {ordem.map((id, i) => {
          const jogador = retrato.players.find((p) => p.id === id);
          if (!jogador) return null;
          return (
            <div key={id} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '8px 4px' }}>
              <span style={{
                width: 20, textAlign: 'right', color: 'var(--texto-apagado)',
                fontVariantNumeric: 'tabular-nums',
              }}>
                {i + 1}
              </span>
              <Avatar avatar={jogador.avatar} tamanho={28} />
              <span style={{ flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {jogador.nickname}{id === eu ? ' · você' : ''}
              </span>
              {saiu.has(id)
                ? <span className="fraco">abandonou</span>
                : <Vidas quantas={partida.lives[id] ?? 0} />}
            </div>
          );
        })}
      </div>

      <Notas partida={partida} retrato={retrato} eu={eu} />
      <Numeros partida={partida} retrato={retrato} eu={eu} />
      <Queda partida={partida} retrato={retrato} />

      {/* Toda tela precisa de uma ação de saída explícita (RF-025). Aqui
          faltava: quem não era host não tinha botão nenhum, e o host só tinha
          revanche — quem quisesse parar de jogar ficava preso na tela de fim,
          sem nada para fazer além de fechar a aba. */}
      {souHost && <button onClick={aoRevanche}>Revanche com o mesmo grupo</button>}

      <button className="fantasma" onClick={aoSair}>Sair da mesa</button>

      {!souHost && (
        <p className="fraco" style={{ textAlign: 'center' }}>
          Se ficar, o host ainda pode pedir revanche com o mesmo grupo.
        </p>
      )}
    </div>
  );
}

/**
 * Aposta contra mão feita, na partida inteira.
 *
 * É a pergunta que a mesa faz no fim — "você errou mais do que eu?" — e ela não
 * estava em lugar nenhum: a tela mostrava só as vidas que sobraram, que é o
 * resultado, não a história. Sai de `history`, somando rodada a rodada, e não
 * de um contador acumulado: rodada abortada (RJ-155) não debita vida de
 * ninguém, e um contador próprio erraria exatamente aí.
 */
function Numeros({ partida, retrato, eu }: {
  partida: PlayerView; retrato: Retrato; eu: string;
}) {
  if (partida.history.length === 0) return null;

  const linhas = partida.playerOrder.map((id) => {
    let apostou = 0;
    let fez = 0;
    let acertos = 0;
    let jogadas = 0;
    for (const r of partida.history) {
      const aposta = r.bets[id];
      if (aposta === undefined) continue;
      jogadas++;
      apostou += aposta;
      const feitas = r.tricksWon[id] ?? 0;
      fez += feitas;
      if (aposta === feitas) acertos++;
    }
    return { id, apostou, fez, acertos, jogadas };
  }).filter((l) => l.jogadas > 0);

  return (
    <div className="cartao pilha" style={{ gap: 6 }}>
      <span className="rotulo">aposta contra mãos feitas</span>
      <div style={{ display: 'flex', gap: 8, fontSize: 10, color: 'var(--texto-apagado)', padding: '0 2px' }}>
        <span style={{ flex: 1 }} />
        <span style={{ width: 58, textAlign: 'right' }}>apostou</span>
        <span style={{ width: 42, textAlign: 'right' }}>fez</span>
        <span style={{ width: 54, textAlign: 'right' }}>acertou</span>
      </div>
      {linhas.map(({ id, apostou, fez, acertos, jogadas }) => {
        const jogador = retrato.players.find((p) => p.id === id);
        return (
          <div key={id} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 }}>
            <span style={{ flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {jogador?.nickname ?? '?'}{id === eu ? ' · você' : ''}
            </span>
            <span style={{ width: 58, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{apostou}</span>
            <span style={{ width: 42, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fez}</span>
            <span style={{
              width: 54, textAlign: 'right', fontVariantNumeric: 'tabular-nums',
              color: acertos > 0 ? 'var(--texto)' : 'var(--texto-apagado)',
            }}>
              {acertos} de {jogadas}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Quem caiu, rodada a rodada.
 *
 * A classificação diz a ordem; isto diz a HISTÓRIA, que é do que a mesa
 * lembra. Retirada por ausência entra junto, marcada como o que é — RJ-129 a
 * separa da eliminação, e misturar as duas na mesma frase apagaria a diferença.
 */
function Queda({ partida, retrato }: { partida: PlayerView; retrato: Retrato }) {
  const nome = (id: string) => retrato.players.find((p) => p.id === id)?.nickname ?? '?';

  const saidasPorRodada = new Map<number, { id: string; abandonou: boolean }[]>();
  for (const r of partida.history) {
    for (const id of r.eliminatedThisRound) {
      const lista = saidasPorRodada.get(r.roundNumber) ?? [];
      lista.push({ id, abandonou: false });
      saidasPorRodada.set(r.roundNumber, lista);
    }
  }
  for (const w of partida.withdrawn) {
    const lista = saidasPorRodada.get(w.roundNumber) ?? [];
    lista.push({ id: w.playerId, abandonou: true });
    saidasPorRodada.set(w.roundNumber, lista);
  }

  if (saidasPorRodada.size === 0) return null;

  const rodadas = [...saidasPorRodada.keys()].sort((a, b) => a - b);

  return (
    <div className="cartao pilha" style={{ gap: 6 }}>
      <span className="rotulo">quem saiu, e quando</span>
      {rodadas.map((numero) => (
        <div key={numero} style={{ display: 'flex', gap: 8, alignItems: 'baseline', fontSize: 13 }}>
          <span style={{ color: 'var(--texto-apagado)', minWidth: 62 }}>rodada {numero}</span>
          <span style={{ flex: 1 }}>
            {saidasPorRodada.get(numero)!.map((s, i) => (
              <span key={s.id}>
                {i > 0 && ', '}
                <b>{nome(s.id)}</b>
                {s.abandonou ? ' (abandonou)' : ''}
              </span>
            ))}
          </span>
        </div>
      ))}
    </div>
  );
}

/**
 * A nota de desempenho, ordenada pela nota e não pela classificação.
 *
 * É de propósito que as duas listas discordem: a classificação diz quem
 * venceu, esta diz quem jogou melhor. Quando a mesma pessoa lidera as duas,
 * não há o que discutir; quando não, é exatamente aí que a mesa tem assunto.
 */
function Notas({ partida, retrato, eu }: {
  partida: PlayerView; retrato: Retrato; eu: string;
}) {
  const notas = desempenhoDaPartida(partida).filter((d) => d.rodadasJogadas > 0);
  if (notas.length === 0) return null;

  return (
    <div className="cartao pilha" style={{ gap: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <span className="rotulo">desempenho</span>
        <span className="fraco">pontaria, acertos e quanto durou</span>
      </div>

      {notas.map((d) => {
        const jogador = retrato.players.find((p) => p.id === d.playerId);
        const { cor, rotulo } = CORES[d.faixa];
        return (
          <div key={d.playerId} style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <Avatar avatar={jogador?.avatar ?? { emoji: '🦊', color: 'amber' }} tamanho={26} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontSize: 14 }}>
                {jogador?.nickname ?? '?'}{d.playerId === eu ? ' · você' : ''}
                {d.venceu && <span aria-hidden style={{ color: 'var(--texto-apagado)' }}> · venceu</span>}
              </div>
              <div className="fraco" style={{ fontSize: 11 }}>
                {d.acertos} de {d.rodadasJogadas} {d.rodadasJogadas === 1 ? 'rodada' : 'rodadas'} em cheio
                {d.abandonou && ' · abandonou'}
              </div>
            </div>

            {/* Número, palavra E cor: a cor é o terceiro canal, nunca o único
                (RNF-031). Quem não distingue a cor lê "excelente" do lado. */}
            <div style={{ textAlign: 'right' }}>
              <div style={{
                color: cor, fontSize: 22, fontWeight: 600, lineHeight: 1,
                fontVariantNumeric: 'tabular-nums',
              }}>
                {d.nota.toFixed(1)}
              </div>
              <div style={{ color: cor, fontSize: 10, letterSpacing: '.06em' }}>{rotulo}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
