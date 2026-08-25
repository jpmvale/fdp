import { Avatar } from '../components/Avatar';
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
