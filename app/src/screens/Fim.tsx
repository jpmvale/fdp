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

      <Desempenho partida={partida} retrato={retrato} eu={eu} ordem={ordem} saiu={saiu} />
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
 * Uma seção só: nota, números e posição na mesma tabela.
 *
 * Antes eram três — classificação, desempenho e "aposta contra mãos feitas" —,
 * e as três listavam as mesmas pessoas, cada uma numa ordem diferente. Quem
 * quisesse comparar dois jogadores tinha de casar três listas de cabeça.
 *
 * A ordem é a de VITÓRIA, e é a mesma da classificação: quem venceu primeiro,
 * quem abandonou por último (RJ-129). A nota vira mais uma coluna, e não um
 * ranking concorrente — ela responde "quem jogou melhor", que com frequência é
 * outra pessoa, e é justamente a comparação que dá assunto na mesa.
 */
function Desempenho({ partida, retrato, eu, ordem, saiu }: {
  partida: PlayerView;
  retrato: Retrato;
  eu: string;
  ordem: string[];
  saiu: Set<string>;
}) {
  const notas = new Map(desempenhoDaPartida(partida).map((d) => [d.playerId, d]));
  const numeros = numerosDaPartida(partida);
  if (notas.size === 0) return null;

  return (
    <div className="cartao pilha" style={{ gap: 6 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <span className="rotulo">desempenho</span>
        <span className="fraco" style={{ fontSize: 11 }}>na ordem de chegada</span>
      </div>

      {/* Cabeçalho de coluna: sem ele os números viram três inteiros soltos que
          cada um interpreta como quiser. */}
      <div style={{
        display: 'flex', gap: 6, fontSize: 10, color: 'var(--texto-apagado)',
        padding: '0 2px', letterSpacing: '.02em',
      }}>
        <span style={{ flex: 1 }} />
        {/* Uma palavra por coluna: "em cheio" quebrava em duas linhas e
            empurrava o cabeçalho inteiro para baixo em 360 px. */}
        <span style={{ width: 42, textAlign: 'right' }}>aposta</span>
        <span style={{ width: 30, textAlign: 'right' }}>fez</span>
        <span style={{ width: 44, textAlign: 'right' }}>cheios</span>
        <span style={{ width: 38, textAlign: 'right' }}>nota</span>
      </div>

      {ordem.map((id, i) => {
        const jogador = retrato.players.find((p) => p.id === id);
        const d = notas.get(id);
        const n = numeros.get(id);
        if (!jogador || !d || !n) return null;
        const { cor, rotulo } = CORES[d.faixa];

        return (
          <div key={id} className="pilha" style={{ gap: 2 }}>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13 }}>
              <span style={{
                width: 12, textAlign: 'right', color: 'var(--texto-apagado)',
                fontVariantNumeric: 'tabular-nums', fontSize: 11,
              }}>
                {i + 1}
              </span>
              <Avatar avatar={jogador.avatar} tamanho={22} />
              <span style={{
                flex: 1, minWidth: 0, whiteSpace: 'nowrap',
                overflow: 'hidden', textOverflow: 'ellipsis',
              }}>
                {jogador.nickname}{id === eu ? ' · você' : ''}
              </span>

              <span style={{ width: 42, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{n.apostou}</span>
              <span style={{ width: 30, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{n.fez}</span>
              <span style={{
                width: 44, textAlign: 'right', fontVariantNumeric: 'tabular-nums',
                color: n.acertos > 0 ? 'var(--texto)' : 'var(--texto-apagado)',
              }}>
                {n.acertos}/{n.jogadas}
              </span>
              {/* Número E cor; a palavra vem na linha de baixo. Cor nunca é o
                  único canal (RNF-031). */}
              <span style={{
                width: 38, textAlign: 'right', color: cor,
                fontWeight: 600, fontVariantNumeric: 'tabular-nums',
              }}>
                {d.nota.toFixed(1)}
              </span>
            </div>

            <div style={{
              display: 'flex', gap: 6, alignItems: 'baseline',
              fontSize: 10, color: 'var(--texto-apagado)', paddingLeft: 40,
            }}>
              <span style={{ flex: 1 }}>
                {saiu.has(id)
                  ? 'abandonou'
                  : partida.lives[id] ? `${partida.lives[id]} de vida` : 'eliminado'}
                {d.venceu && ' · venceu'}
              </span>
              <span style={{ color: cor, letterSpacing: '.06em' }}>{rotulo}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Aposta contra mão feita, na partida inteira — somado de `history`. */
function numerosDaPartida(partida: PlayerView) {
  const linhas = new Map<string, { apostou: number; fez: number; acertos: number; jogadas: number }>();
  for (const id of partida.playerOrder) {
    let apostou = 0, fez = 0, acertos = 0, jogadas = 0;
    for (const r of partida.history) {
      const aposta = r.bets[id];
      // Rodada abortada (RJ-155) é refeita e não debita ninguém: contá-la
      // puniria quem estava na mesa quando outra pessoa caiu.
      if (aposta === undefined || r.aborted) continue;
      jogadas++;
      apostou += aposta;
      const feitas = r.tricksWon[id] ?? 0;
      fez += feitas;
      if (aposta === feitas) acertos++;
    }
    if (jogadas > 0) linhas.set(id, { apostou, fez, acertos, jogadas });
  }
  return linhas;
}
