/**
 * Teto de balões por pessoa.
 *
 * O limite de comandos do servidor (RNF-010) é generoso para quem digita e
 * inútil para proteger a TELA: vinte mensagens em dez segundos cabem no
 * orçamento e não cabem no feltro. Este teto é da interface, e é por pessoa —
 * quem fala demais ocupa o mesmo espaço de quem fala pouco.
 */
import { describe, expect, it } from 'vitest';
import { comTeto, type BalaoNaMesa } from '../src/components/Balao';

const balao = (playerId: string, n: number, tipo: 'chat' | 'vida' = 'chat'): BalaoNaMesa =>
  ({ id: `${playerId}-${n}`, playerId, texto: `${n}`, tipo });

describe('CA-346: no máximo 4 balões por pessoa na mesa', () => {
  it('do quinto em diante, o mais antigo daquela pessoa sai', () => {
    const seis = [1, 2, 3, 4, 5, 6].map((n) => balao('ana', n));
    const ficaram = comTeto(seis);

    expect(ficaram).toHaveLength(4);
    // Saíram os dois mais antigos, não os mais novos: o balão que interessa é
    // o que acabou de ser dito.
    expect(ficaram.map((b) => b.texto)).toEqual(['3', '4', '5', '6']);
  });

  it('o teto é por pessoa, não da mesa', () => {
    const mesa = [
      ...[1, 2, 3, 4, 5].map((n) => balao('ana', n)),
      ...[1, 2].map((n) => balao('beto', n)),
      balao('duda', 1),
    ];
    const ficaram = comTeto(mesa);

    // Ana perde o excedente; Beto e Duda não pagam pelo que ela falou.
    expect(ficaram.filter((b) => b.playerId === 'ana')).toHaveLength(4);
    expect(ficaram.filter((b) => b.playerId === 'beto')).toHaveLength(2);
    expect(ficaram.filter((b) => b.playerId === 'duda')).toHaveLength(1);
  });

  it('vida e chat dividem o mesmo teto: o que importa é o espaço na tela', () => {
    const mistura = [
      balao('ana', 1, 'vida'),
      ...[2, 3, 4, 5].map((n) => balao('ana', n)),
    ];
    const ficaram = comTeto(mistura);

    expect(ficaram).toHaveLength(4);
    // O de vida era o mais antigo e saiu como qualquer outro. Perder um balão
    // não perde informação: a vida está no assento e no histórico.
    expect(ficaram.some((b) => b.tipo === 'vida')).toBe(false);
  });

  it('abaixo do teto, nada é descartado e a ordem é preservada', () => {
    const poucos = [balao('ana', 1), balao('beto', 1), balao('ana', 2)];
    expect(comTeto(poucos)).toEqual(poucos);
  });
});
