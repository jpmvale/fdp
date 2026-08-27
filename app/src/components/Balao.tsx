import { useCallback, useEffect, useRef, useState } from 'react';
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
  /** Quem falou estava assistindo. Só faz sentido em `chat`. */
  assiste?: boolean;
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

/**
 * Quanto de uma mensagem cabe no balão.
 *
 * O balão tem 132 px de largura, então 280 caracteres — o teto de RNF-014 —
 * viram uma coluna de umas onze linhas saindo do assento e cobrindo metade do
 * feltro, cartas inclusive. O balão nunca foi o lugar de LER a mensagem: ele
 * diz que fulano falou e dá o começo do que ele disse. O texto inteiro está no
 * painel do chat, que é onde se lê, e é para lá que o balão manda quem se
 * interessou.
 *
 * Setenta caracteres é o que dá umas três linhas nessa largura — o bastante
 * para uma frase de mesa caber inteira, e pouco o suficiente para que nenhum
 * balão tape o jogo.
 */
export const BALAO_TEXTO_MAX = 70;

/**
 * Corta a mensagem no tamanho do balão, preferindo o fim de uma palavra.
 *
 * Cortar no meio de uma palavra é legível, mas parece defeito; recuar até o
 * último espaço parece decisão. Só recua enquanto sobrar mensagem de verdade —
 * uma palavra única de 200 caracteres (que existe, e é justamente o que alguém
 * colando um link produz) não pode virar reticências sozinhas.
 */
export function resumoDoBalao(texto: string, limite = BALAO_TEXTO_MAX): string {
  const limpo = texto.trim();
  if (limpo.length <= limite) return limpo;

  const bruto = limpo.slice(0, limite);
  const espaco = bruto.lastIndexOf(' ');
  const corte = espaco >= Math.floor(limite * 0.6) ? bruto.slice(0, espaco) : bruto;
  return `${corte.trimEnd()}…`;
}

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

  /**
   * O `aoSumir` vive numa ref, e NÃO nas dependências do efeito.
   *
   * Aqui estava um balão que às vezes não sumia. O efeito dependia de
   * `aoSumir`, que é recriado a cada render do feltro; toda vez que a
   * identidade mudava, o efeito refazia os dois temporizadores **do zero**. E
   * remover um balão é um `setState` no feltro, ou seja, um render — então
   * cada balão que sumia empurrava a contagem de todos os outros para o
   * começo. Com um balão só isso nunca aparece. Com vários ao mesmo tempo, que
   * é o que acontece quando alguém morre e a rodada debita vida de meia mesa,
   * o último da fila pode ser adiado indefinidamente.
   *
   * Guardando a função numa ref, o efeito passa a depender só da identidade do
   * balão — que é o que de fato define quando ele deve sumir.
   */
  const sumir = useRef(aoSumir);
  sumir.current = aoSumir;

  useEffect(() => {
    const espera = DURACAO[balao.tipo];
    const some = setTimeout(() => setSaindo(true), espera);
    const tira = setTimeout(() => sumir.current(balao.id), espera + (balao.tipo === 'vida' ? 140 : 260));
    return () => { clearTimeout(some); clearTimeout(tira); };
  }, [balao.id, balao.tipo]);

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
      {/* O balão de quem assiste sai do assento como qualquer outro, mas com
          a marca junto: ele vê as cartas da mesa inteira (RJ-159), e sem isto
          o conselho dele pareceria o de um jogador comum. */}
      {balao.assiste === true && (
        <span
          style={{
            display: 'block', fontSize: 8, letterSpacing: 0.4,
            color: 'var(--texto-apagado)', textTransform: 'uppercase',
            marginBottom: 1,
          }}
        >
          assiste
        </span>
      )}
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
      ...novas.map((m) => ({
        id: `chat-${m.id}`,
        playerId: m.playerId,
        // Compactado AQUI, e não na hora de desenhar: o balão carrega o que
        // vai mostrar, e o teste consegue perguntar isso sem montar a tela.
        texto: resumoDoBalao(m.text),
        tipo: 'chat' as const,
        assiste: m.spectator,
      })),
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

  // Identidade estável. O `Balao` já não depende disso para contar o tempo,
  // mas uma função recriada a cada render é o tipo de detalhe que volta a
  // morder no próximo efeito que alguém escrever.
  const descartar = useCallback(
    (id: string) => setBaloes((atuais) => atuais.filter((b) => b.id !== id)),
    [],
  );

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
