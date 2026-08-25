import { useEffect, useState } from 'react';
import { LIMITS } from '@fdp/protocol';
import { trickStanding, type Card, type TieRule } from '@fdp/rules';
import { Carta } from './Carta';
import type { PublicPlayer } from '../state/tipos';

/**
 * A vaza no meio da mesa (`07` §2.4).
 *
 * As cartas ficavam dentro do assento de quem jogou. Era legível, e estava
 * errado por dois motivos: `07` §2.4 pede as cartas no centro, e — o que
 * importa mais — uma vaza é uma DISPUTA. Espalhada pelos assentos ela vira
 * oito informações separadas, e a pergunta do jogo ("quem está levando?")
 * exige comparar oito cantos da tela.
 *
 * O medo que tinha afastado o centro era real: com 8 jogadores, cartas grandes
 * ancoradas a cada avatar cobrem nomes e placar. A saída não é desistir do
 * centro, é o centro não competir com o texto que estava lá — durante as vazas
 * o contador da mesa sobe para o cabeçalho, e as cartas ficam pequenas, em
 * grade, com o avatar de quem jogou colado nelas.
 */

export interface JogadaNaMesa {
  playerId: string;
  card: Card;
}

export function Vaza({ jogadas, jogadores, regraEmpate, recolhendo, posicaoDe, eu }: {
  jogadas: readonly JogadaNaMesa[];
  jogadores: PublicPlayer[];
  regraEmpate: TieRule;
  /** Fase de recolher: as cartas viajam até o vencedor. */
  recolhendo: boolean;
  /** Onde fica o assento de alguém, em % do feltro — o destino da viagem. */
  posicaoDe: (playerId: string) => { x: number; y: number };
  eu: string;
}) {
  const semMovimento = usaMovimentoReduzido();
  if (jogadas.length === 0) return null;

  // A MESMA escada de empate do motor (`02` §3.6.1), importada e não reescrita.
  const parcial = trickStanding(jogadas, regraEmpate);
  const destino = parcial.winnerId ? posicaoDe(parcial.winnerId) : { x: 50, y: 50 };
  // Mesa cheia = carta menor. Medi a versão sem isto com 8 jogadores e duas
  // cartas invadiam os assentos laterais — o defeito exato que tinha afastado
  // o centro da primeira vez. A conta é a mesma de `ASSENTO`: sobra
  // `67% − 104px` entre os dois assentos das laterais, ~137 px em 360.
  const tamanho = jogadas.length > 4 ? 'mini' as const : 'pequena' as const;

  return (
    <div
      style={{
        position: 'absolute', top: 112,
        // Confinada à faixa entre os assentos laterais, não à largura do
        // feltro: é isso que impede a carta de cobrir nome e vidas de alguém.
        left: 'calc(16.5% + 52px)', right: 'calc(16.5% + 52px)',
        display: 'flex', flexWrap: 'wrap', justifyContent: 'center',
        gap: 4,
        pointerEvents: 'none',
      }}
    >
      {jogadas.map(({ playerId, card }) => {
        const jogador = jogadores.find((p) => p.id === playerId);
        const ganhando = parcial.winnerId === playerId;
        const anulada = parcial.annulledIds.includes(playerId);

        // Cada carta viaja da posição dela até o assento do vencedor. O delta é
        // em % do feltro convertido para px pelo tamanho aproximado do palco —
        // não precisa ser exato: o que se lê é a direção, não a distância.
        const viagem = recolhendo && !semMovimento
          ? `translate(${(destino.x - 50) * 3.1}px, ${(destino.y - 50) * 3.4}px) scale(0.55)`
          : undefined;

        return (
          <div
            key={playerId}
            style={{
              position: 'relative',
              transform: viagem,
              opacity: recolhendo ? (semMovimento ? 0 : 0.15) : 1,
              transition: semMovimento
                ? `opacity 100ms linear`
                : `transform ${LIMITS.trickCollectMs}ms ease-in, opacity ${LIMITS.trickCollectMs}ms ease-in`,
            }}
          >
            <div style={{
              borderRadius: 9,
              // Anel E rótulo: o destaque não pode depender só de cor (RNF-031).
              boxShadow: ganhando ? '0 0 0 2px #3fb98a, 0 4px 14px rgba(0,0,0,0.5)' : undefined,
              opacity: anulada ? 0.45 : 1,
            }}>
              <Carta
                carta={card}
                tamanho={tamanho}
                rotulo={rotuloDaCarta(card, jogador, playerId === eu, ganhando, anulada)}
              />
            </div>

            {/* O avatar colado na carta é o "ancorada junto a quem jogou" de
                `07` §2.4 que sobrou depois de o centro ficar apertado. */}
            <span
              aria-hidden
              style={{
                position: 'absolute', left: -4, bottom: -4,
                width: 14, height: 14, borderRadius: '50%',
                background: `var(--avatar-${jogador?.avatar.color ?? 'teal'})`,
                display: 'grid', placeItems: 'center', fontSize: 8,
                boxShadow: '0 0 0 2px var(--feltro-escuro)',
              }}
            >
              {jogador?.avatar.emoji}
            </span>

            {ganhando && (
              <span
                aria-hidden
                style={{
                  position: 'absolute', right: -2, top: -7,
                  fontSize: 8, letterSpacing: '.04em', fontWeight: 600,
                  color: '#0b1f33', background: '#3fb98a',
                  borderRadius: 4, padding: '1px 3px',
                }}
              >
                {recolhendo ? 'LEVOU' : 'GANHA'}
              </span>
            )}
            {anulada && (
              <span aria-hidden style={{
                position: 'absolute', right: -2, top: -7,
                fontSize: 8, fontWeight: 600, color: 'var(--texto)',
                background: 'var(--superficie-2)', borderRadius: 4, padding: '1px 3px',
              }}>
                ANULADA
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

function rotuloDaCarta(
  card: Card,
  jogador: PublicPlayer | undefined,
  souEu: boolean,
  ganhando: boolean,
  anulada: boolean,
): string {
  const quem = souEu ? 'você' : jogador?.nickname ?? 'alguém';
  const estado = ganhando ? ', ganhando a mão' : anulada ? ', anulada por empate' : '';
  return `${quem} jogou ${card.rank}${estado}`;
}

/**
 * Quando a vaza fechada começa a viajar até o vencedor.
 *
 * Ancorado no **prazo do servidor**, não num cronômetro próprio. A primeira
 * versão contava `trickPauseMs − trickCollectMs` a partir do momento em que o
 * cliente via a fase mudar, e isso quebra por um motivo que só aparece jogando:
 * o cliente não sabe quando a fase começou de verdade. Ele vê o evento depois
 * da latência, o relógio da sala tem granularidade de 250 ms, e um resync no
 * meio recomeça a conta. Nos casos ruins a viagem começava depois de a vaza
 * seguinte já ter aberto — ou seja, nunca aparecia.
 *
 * `phaseDeadline` é o instante EXATO em que o servidor vai recolher. Contando
 * de trás para frente a partir dele, a viagem termina exatamente quando as
 * cartas somem, e o pior caso é ela ficar curta em vez de não acontecer.
 */
export function useRecolhimento(recolhendo: boolean, prazo: number | null): boolean {
  const [viajando, setViajando] = useState(false);

  useEffect(() => {
    const espera = esperaAteViajar(recolhendo, prazo, Date.now());
    if (espera === null) {
      setViajando(false);
      return;
    }
    if (espera === 0) {
      setViajando(true);
      return;
    }
    const t = setTimeout(() => setViajando(true), espera);
    return () => clearTimeout(t);
  }, [recolhendo, prazo]);

  return viajando;
}

/** RNF-034: sob `prefers-reduced-motion` nada desliza. */
function usaMovimentoReduzido(): boolean {
  const [reduzido, setReduzido] = useState(
    () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches,
  );
  useEffect(() => {
    if (typeof matchMedia !== 'function') return;
    const mq = matchMedia('(prefers-reduced-motion: reduce)');
    const ouvir = () => setReduzido(mq.matches);
    mq.addEventListener('change', ouvir);
    return () => mq.removeEventListener('change', ouvir);
  }, []);
  return reduzido;
}

/**
 * Quanto falta para as cartas começarem a viajar.
 *
 * `null` = não é hora de viajar nada. `0` = já passou da hora, vai agora.
 *
 * Separado do hook porque é a única parte com aritmética, e a única que dá
 * para provar sem navegador. O erro que isto trava é o que eu cometi na
 * primeira versão: contar a partir de quando o cliente vê a fase, em vez de
 * contar de trás para frente a partir do prazo do servidor.
 */
export function esperaAteViajar(
  recolhendo: boolean,
  prazo: number | null,
  agora: number,
): number | null {
  if (!recolhendo || prazo === null) return null;
  return Math.max(0, prazo - agora - LIMITS.trickCollectMs);
}
