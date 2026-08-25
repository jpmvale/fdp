import { useEffect, useRef, useState } from 'react';
import type { ChatMessage, PlayerView } from '../state/tipos';

/**
 * Balões que saem do assento de quem falou — ou de quem levou o prejuízo.
 *
 * Duas coisas diferentes que a mesa lê do mesmo jeito: alguma coisa aconteceu
 * COM AQUELA PESSOA. O chat estava no rodapé, longe de quem escreveu, e o
 * débito de vida não tinha sinal nenhum — o número simplesmente mudava, que é
 * o oposto do que `07` §2.4 pede para o momento de maior carga da partida.
 *
 * São transitórios de propósito: aparecem, dizem, somem. Nada aqui é a fonte
 * da verdade — o chat inteiro fica no painel, e as vidas ficam no assento e no
 * histórico. Se um balão se perder, não se perde informação.
 */

export interface BalaoNaMesa {
  id: string;
  playerId: string;
  texto: string;
  tipo: 'chat' | 'vida';
}

/** Quanto tempo cada tipo fica na tela. */
const DURACAO = { chat: 5_000, vida: 1_600 } as const;

/**
 * Teto de balões simultâneos POR PESSOA.
 *
 * Sem ele, quem escreve rápido empilha uma coluna de balões que sai do feltro e
 * cobre os assentos vizinhos — e o limite de comandos do servidor (RNF-010,
 * 20 por 10 s) é generoso demais para conter isso na tela. Passando de quatro,
 * o mais antigo daquela pessoa sai para o novo entrar: quem fala demais ocupa
 * o mesmo espaço de quem fala pouco.
 */
const TETO_POR_PESSOA = 4;

/** Mantém só os últimos `TETO_POR_PESSOA` balões de cada jogador. */
export function comTeto(baloes: BalaoNaMesa[]): BalaoNaMesa[] {
  const contagem = new Map<string, number>();
  const mantidos: BalaoNaMesa[] = [];
  // De trás para a frente: os últimos são os que ficam.
  for (let i = baloes.length - 1; i >= 0; i--) {
    const b = baloes[i]!;
    const quantos = contagem.get(b.playerId) ?? 0;
    if (quantos >= TETO_POR_PESSOA) continue;
    contagem.set(b.playerId, quantos + 1);
    mantidos.unshift(b);
  }
  return mantidos;
}

export function Balao({ balao, x, y, empilhado, aoSumir }: {
  balao: BalaoNaMesa;
  /** Posição do assento, em % do feltro. */
  x: number;
  y: number;
  /**
   * Quantos balões do MESMO jogador já estão na tela abaixo deste.
   *
   * Sem isto, quem escreve no chat na hora em que perde vida recebe os dois
   * balões exatamente na mesma coordenada, um por cima do outro — e nenhum dos
   * dois se lê. Aconteceu na primeira vez que testei.
   */
  empilhado: number;
  aoSumir: (id: string) => void;
}) {
  const [saindo, setSaindo] = useState(false);

  useEffect(() => {
    const some = setTimeout(() => setSaindo(true), DURACAO[balao.tipo]);
    const tira = setTimeout(() => aoSumir(balao.id), DURACAO[balao.tipo] + (balao.tipo === 'vida' ? 140 : 260));
    return () => { clearTimeout(some); clearTimeout(tira); };
  }, [balao.id, balao.tipo, aoSumir]);

  // Nos assentos de cima o balão desce; nos de baixo, sobe. Um balão fixo para
  // cima sairia do feltro em quem senta no topo.
  const paraBaixo = y < 30;
  const vida = balao.tipo === 'vida';
  // Empilha na direção em que o balão já aponta, para não voltar por cima do
  // assento nem sair do feltro.
  const desvio = empilhado * (paraBaixo ? 30 : -30);

  return (
    <div
      className={`balao${vida ? ' balao-vida' : ''}${saindo ? ' saindo' : ''}`}
      style={{
        position: 'absolute',
        left: `${x}%`,
        top: `calc(${y}% + ${(paraBaixo ? 34 : -40) + desvio}px)`,
        transform: 'translateX(-50%)',
        maxWidth: vida ? 84 : 132,
        // O de vida é menor e mais rápido: ele não traz texto para ler, traz um
        // sinal para perceber. O de chat carrega palavras e precisa de tempo.
        padding: vida ? '2px 7px' : '5px 9px',
        borderRadius: vida ? 10 : 12,
        fontSize: vida ? 11 : 12,
        lineHeight: 1.3,
        textAlign: 'center',
        wordBreak: 'break-word',
        pointerEvents: 'none',
        zIndex: 6,
        background: vida ? 'rgba(239,77,90,0.92)' : 'var(--superficie-2)',
        color: vida ? '#fff' : 'var(--texto)',
        boxShadow: vida
          ? '0 4px 14px rgba(0,0,0,0.5)'
          : '0 4px 14px rgba(0,0,0,0.5), inset 0 0 0 1px var(--linha)',
        fontWeight: vida ? 600 : 400,
      }}
    >
      {balao.texto}
      {/* O bico: é ele que faz o balão SAIR de alguém em vez de flutuar perto. */}
      <span
        aria-hidden
        style={{
          position: 'absolute',
          left: '50%',
          marginLeft: -4,
          [paraBaixo ? 'top' : 'bottom']: -4,
          width: 8, height: 8,
          background: vida ? 'rgba(239,77,90,0.92)' : 'var(--superficie-2)',
          transform: 'rotate(45deg)',
        }}
      />
    </div>
  );
}

/**
 * Junta os balões que a mesa deve mostrar agora.
 *
 * Chat entra por mensagem nova; vida, por rodada fechada. A referência inicial
 * é o estado no momento em que a tela monta — quem recarrega a página no meio
 * da partida não deve levar na cara os balões de tudo que já passou.
 */
export function useBaloes(chat: ChatMessage[], partida: PlayerView | null): {
  baloes: BalaoNaMesa[];
  descartar: (id: string) => void;
  /** Quantas vidas cada um acabou de perder — para o coração cair no assento. */
  perdasRecentes: Record<string, number>;
} {
  const [baloes, setBaloes] = useState<BalaoNaMesa[]>([]);
  const chatVisto = useRef(chat.length);
  const rodadasVistas = useRef(partida?.history.length ?? 0);

  useEffect(() => {
    if (chat.length <= chatVisto.current) {
      // Sala nova, ou histórico encolheu: reancora sem disparar nada.
      chatVisto.current = chat.length;
      return;
    }
    const novas = chat.slice(chatVisto.current);
    chatVisto.current = chat.length;
    setBaloes((atuais) => comTeto([
      ...atuais,
      ...novas.map((m) => ({ id: `chat-${m.id}`, playerId: m.playerId, texto: m.text, tipo: 'chat' as const })),
    ]));
  }, [chat]);

  useEffect(() => {
    const total = partida?.history.length ?? 0;
    if (!partida || total <= rodadasVistas.current) {
      rodadasVistas.current = total;
      return;
    }
    rodadasVistas.current = total;

    const rodada = partida.history[total - 1];
    if (!rodada || rodada.aborted) return; // RJ-155: abortada não debita ninguém

    const perdas = partida.playerOrder
      .map((id) => ({ id, perdeu: rodada.livesLost[id] ?? 0 }))
      .filter((p) => p.perdeu > 0)
      .map(({ id, perdeu }) => ({
        id: `vida-${rodada.roundNumber}-${id}`,
        playerId: id,
        texto: `−${perdeu} ♥`,
        tipo: 'vida' as const,
      }));

    if (perdas.length > 0) setBaloes((atuais) => comTeto([...atuais, ...perdas]));
  }, [partida]);

  const descartar = (id: string) =>
    setBaloes((atuais) => atuais.filter((b) => b.id !== id));

  // Derivado dos balões em vez de guardado à parte: os dois some juntos, e não
  // há como um coração ficar caindo depois de o balão ter ido embora.
  const perdasRecentes: Record<string, number> = {};
  for (const b of baloes) {
    if (b.tipo !== 'vida') continue;
    const quantas = Number(b.texto.replace(/[^0-9]/g, ''));
    if (Number.isFinite(quantas)) perdasRecentes[b.playerId] = quantas;
  }

  return { baloes, descartar, perdasRecentes };
}
