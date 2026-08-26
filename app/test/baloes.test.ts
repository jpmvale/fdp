/**
 * Teto de balões por pessoa.
 *
 * O limite de comandos do servidor (RNF-010) é generoso para quem digita e
 * inútil para proteger a TELA: vinte mensagens em dez segundos cabem no
 * orçamento e não cabem no feltro. Este teto é da interface, e é por pessoa —
 * quem fala demais ocupa o mesmo espaço de quem fala pouco.
 */
import { describe, expect, it } from 'vitest';
import { BALAO_TEXTO_MAX, comTeto, resumoDoBalao, type BalaoNaMesa } from '../src/components/Balao';

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


/**
 * Compactação do texto no balão.
 *
 * O teto de mensagem é 280 (RNF-014) e o balão tem 132 px: uma mensagem no
 * limite vira uma coluna de umas onze linhas que sai do assento e cobre as
 * cartas. O balão avisa; o painel do chat é que guarda o texto inteiro.
 */
describe('CA-385: mensagem grande é compactada no balão', () => {
  it('mensagem curta passa inteira, só aparada', () => {
    expect(resumoDoBalao('  boa jogada  ')).toBe('boa jogada');
  });

  it('no limite exato ainda não corta', () => {
    const justa = 'x'.repeat(BALAO_TEXTO_MAX);
    expect(resumoDoBalao(justa)).toBe(justa);
  });

  it('mensagem no teto de RNF-014 cabe no balão', () => {
    const enorme = 'palavra '.repeat(60).trim();
    const cortada = resumoDoBalao(enorme);

    expect(enorme.length).toBeGreaterThan(280 - 8);
    // Uma reticência a mais que o teto, e nada além disso.
    expect(cortada.length).toBeLessThanOrEqual(BALAO_TEXTO_MAX + 1);
    expect(cortada.endsWith('…')).toBe(true);
    // Corta no fim de uma palavra: o pedaço que sobra continua legível.
    expect(cortada.endsWith('palavra…')).toBe(true);
  });

  it('palavra única gigante é cortada mesmo assim', () => {
    // Um link colado não tem espaço nenhum. Recuar até o último espaço aqui
    // devolveria reticências sozinhas, que não dizem nada.
    const link = `https://exemplo.com/${'a'.repeat(200)}`;
    const cortada = resumoDoBalao(link);

    expect(cortada).toHaveLength(BALAO_TEXTO_MAX + 1);
    expect(cortada.startsWith('https://exemplo.com/')).toBe(true);
  });
});
