import { Avatar } from '../components/Avatar';
import { CORES } from '../desempenho';
import { desempenhoDaPartida, numerosDaPartida, ranking } from '@fdp/rules';
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

export function Fim({ retrato, eu, partida, aoRevanche, aoSair, aoVoltarAoLobby }: {
  retrato: Retrato;
  eu: string;
  partida: PlayerView;
  aoRevanche: () => void;
  aoSair: () => void;
  aoVoltarAoLobby: () => void;
}) {
  const vencedores = partida.winnerIds ?? [];
  const souHost = retrato.hostId === eu;
  const saiu = new Set(partida.withdrawn.map((w) => w.playerId));

  // A classificação vem do MOTOR (RJ-012, RJ-129) — vencedor, depois quem caiu
  // por último, até o primeiro a sair. A tela ordenava por vidas restantes, e
  // como todo eliminado termina em zero, a ordem entre eles era a de
  // `playerOrder`: o primeiro a cair podia aparecer em segundo. O motor
  // desempata por rodada e, dentro dela, pela vaza da morte (RJ-010).
  const ordem = ranking(partida);

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

      {/* A revanche recomeça na hora, com a mesma mesa. Isto volta para a sala
          de espera, onde dá para trocar os bots, a dificuldade e as opções
          antes de jogar de novo — não havia caminho para isso: do fim só se
          saía jogando outra igual ou fechando a aba. */}
      {souHost && (
        <button className="fantasma" onClick={aoVoltarAoLobby}>
          Voltar ao lobby e arrumar a mesa
        </button>
      )}

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
        <span className="fraco" style={{ fontSize: 11 }}>da vitória à primeira queda</span>
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
        <span style={{ width: 44, textAlign: 'right' }}>cheios</span>
        <span style={{ width: 46, textAlign: 'right' }}>erro/rod</span>
        <span style={{ width: 30, textAlign: 'right' }}>pior</span>
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
              <Posicao lugar={i + 1} />
              <Avatar avatar={jogador.avatar} tamanho={22} />
              <span style={{
                flex: 1, minWidth: 0, whiteSpace: 'nowrap',
                overflow: 'hidden', textOverflow: 'ellipsis',
              }}>
                {jogador.nickname}{id === eu ? ' · você' : ''}
              </span>

              <span style={{
                width: 44, textAlign: 'right', fontVariantNumeric: 'tabular-nums',
                color: n.acertos > 0 ? 'var(--texto)' : 'var(--texto-apagado)',
              }}>
                {n.acertos}/{n.jogadas}
              </span>
              {/* Quanto a aposta ficou longe, em média, por rodada. Zero é
                  pontaria perfeita; 1,0 é errar por uma mão toda rodada. */}
              <span style={{
                width: 46, textAlign: 'right', fontVariantNumeric: 'tabular-nums',
                color: n.erroMedio === 0 ? 'var(--texto)' : 'var(--texto-medio)',
              }}>
                {n.erroMedio.toFixed(1)}
              </span>
              {/* O tombo isolado que uma média esconde: errar por 4 numa rodada
                  e acertar o resto dá média baixa e custou 4 vidas. */}
              <span style={{
                width: 30, textAlign: 'right', fontVariantNumeric: 'tabular-nums',
                color: n.pior >= 3 ? 'var(--vidas)' : 'var(--texto-apagado)',
              }}>
                {n.pior === 0 ? '—' : `−${n.pior}`}
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
              fontSize: 10, color: 'var(--texto-apagado)', paddingLeft: 46,
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

/**
 * O lugar na classificação. Pódio ganha medalha desenhada; o resto, o número.
 *
 * A medalha é SVG e não emoji: 🥇 muda de desenho a cada plataforma e some em
 * fonte que não tem o glifo. E ela nunca substitui o número — o algarismo fica
 * DENTRO da medalha, então quem não distingue ouro de bronze lê a posição do
 * mesmo jeito (RNF-031: cor nunca é o único canal).
 */
function Posicao({ lugar }: { lugar: number }) {
  if (lugar > 3) {
    return (
      <span style={{
        width: 18, textAlign: 'center', color: 'var(--texto-apagado)',
        fontVariantNumeric: 'tabular-nums', fontSize: 11,
      }}>
        {lugar}
      </span>
    );
  }

  // Ouro, prata, bronze. Cores cruas mesmo: são metais, não papéis do tema, e
  // não mudam com ele.
  const { aro, corpo, tinta } = [
    { aro: '#f0c75e', corpo: '#c8952b', tinta: '#3a2708' },
    { aro: '#dfe3e8', corpo: '#a8adb6', tinta: '#2b2f36' },
    { aro: '#dc9a63', corpo: '#a4663a', tinta: '#33200f' },
  ][lugar - 1]!;

  return (
    <svg
      width="18" height="18" viewBox="0 0 18 18"
      style={{ flexShrink: 0, display: 'block' }}
      role="img"
      aria-label={`${lugar}º lugar`}
    >
      <circle cx="9" cy="9" r="8" fill={corpo} stroke={aro} strokeWidth="1.5" />
      <text
        x="9" y="9" fill={tinta} fontSize="9" fontWeight="700"
        textAnchor="middle" dominantBaseline="central"
      >
        {lugar}
      </text>
    </svg>
  );
}
