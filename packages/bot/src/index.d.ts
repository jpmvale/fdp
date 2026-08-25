/**
 * Bots (RF-018).
 *
 * Este pacote **decide**, e só. Não conhece sala, rede nem relógio: recebe a
 * mesma `PlayerView` que um humano receberia — a projeção já filtrada, sem
 * estado oculto — e devolve uma jogada. É a mesma disciplina de
 * `packages/rules`: puro, determinístico dado o `Rng`, testável sem servidor.
 *
 * A consequência que importa: **um bot não pode trapacear**. Ele não tem como
 * ver a mão dos outros porque a informação não chega até aqui. Na rodada de
 * testa ele também não vê a própria carta — pelo mesmo motivo que você não vê.
 */
import type { Card, CardId, PlayerView, Rng } from '@fdp/rules';
/**
 * As quatro dificuldades previstas. `DIFICIL` e `REALISTA` ainda não têm
 * implementação própria e caem no comportamento de `MEDIO` — declaradas desde
 * já porque o valor viaja no protocolo e no estado persistido: acrescentar
 * depois obrigaria a migrar sala salva.
 */
export declare const DIFICULDADES: readonly ["FACIL", "MEDIO", "DIFICIL", "REALISTA"];
export type Dificuldade = (typeof DIFICULDADES)[number];
/** As que hoje têm comportamento próprio. */
export declare const DIFICULDADES_PRONTAS: readonly Dificuldade[];
export declare const ROTULOS: Record<Dificuldade, string>;
export declare function decidirAposta(visao: PlayerView, dificuldade: Dificuldade, rng: Rng): number;
export declare function decidirCarta(visao: PlayerView, dificuldade: Dificuldade, rng: Rng): CardId;
export type { Card };
