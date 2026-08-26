import { describe, expect, it } from 'vitest';
import { deveAvisarVez, fracaoDaBarra, intervaloDoTique, urgenciaDoTique, verPrazo } from '../src/avisos';
import { GESTOS, despertarSomNoPrimeiroGesto } from '../src/som';

describe('CA-351: o aviso de vez toca na transição, não enquanto dura', () => {
  it('toca quando a vez passa a ser minha', () => {
    expect(deveAvisarVez('beto', 'ana', 'ana', false)).toBe(true);
    expect(deveAvisarVez(null, 'ana', 'ana', false)).toBe(true);
  });

  it('não repete enquanto a vez continua minha', () => {
    // A tela renderiza muitas vezes por segundo; um aviso por render seria um
    // alarme em vez de um aviso.
    expect(deveAvisarVez('ana', 'ana', 'ana', false)).toBe(false);
  });

  it('não toca para a vez dos outros', () => {
    expect(deveAvisarVez('ana', 'beto', 'ana', false)).toBe(false);
    expect(deveAvisarVez(null, 'beto', 'ana', false)).toBe(false);
  });

  it('não toca com a mesa pausada: ali ninguém joga', () => {
    expect(deveAvisarVez('beto', 'ana', 'ana', true)).toBe(false);
  });
});

describe('CA-352: o tique acelera conforme o tempo aperta', () => {
  it('silêncio enquanto sobra mais de um quarto do tempo', () => {
    expect(intervaloDoTique(1)).toBeNull();
    expect(intervaloDoTique(0.5)).toBeNull();
    expect(intervaloDoTique(0.26)).toBeNull();
  });

  it('do começo do aperto ao fim, o intervalo só encurta', () => {
    const inicio = intervaloDoTique(0.25)!;
    const meio = intervaloDoTique(0.12)!;
    const fim = intervaloDoTique(0)!;

    expect(inicio).toBeGreaterThan(meio);
    expect(meio).toBeGreaterThan(fim);
    expect(fim).toBe(180);
  });

  it('a urgência sobe junto, para o tique ficar mais agudo', () => {
    expect(urgenciaDoTique(0.25)).toBeCloseTo(0, 5);
    expect(urgenciaDoTique(0)).toBeCloseTo(1, 5);
    expect(urgenciaDoTique(0.125)).toBeCloseTo(0.5, 5);
  });

  it('valores fora da faixa não quebram a conta', () => {
    expect(urgenciaDoTique(-1)).toBe(1);
    expect(intervaloDoTique(-1)).toBe(180);
  });
});


// --- CA-356: a barra do turno nasce cheia ----------------------------------

describe('CA-356: a barra do turno começa cheia, qualquer que seja o prazo', () => {
  const AGORA = 1_700_000_000_000;
  const vazio = { prazo: 0, total: 1 };

  it('a aposta (45 s) nasce cheia', () => {
    const visto = verPrazo(vazio, AGORA + 45_000, AGORA);
    expect(fracaoDaBarra(visto, AGORA + 45_000, AGORA)).toBe(1);
  });

  it('a jogada (30 s) também nasce cheia — era ela que nascia em 67%', () => {
    const visto = verPrazo(vazio, AGORA + 30_000, AGORA);
    expect(fracaoDaBarra(visto, AGORA + 30_000, AGORA)).toBe(1);
  });

  it('a vez de um bot (900 ms) também — era ela que nascia em 2%', () => {
    const visto = verPrazo(vazio, AGORA + 900, AGORA);
    expect(fracaoDaBarra(visto, AGORA + 900, AGORA)).toBe(1);
  });

  it('e esvazia proporcionalmente ao prazo que é, não a um prazo fixo', () => {
    const prazo = AGORA + 30_000;
    const visto = verPrazo(vazio, prazo, AGORA);
    expect(fracaoDaBarra(visto, prazo, AGORA + 15_000)).toBeCloseTo(0.5, 5);
    expect(fracaoDaBarra(visto, prazo, AGORA + 30_000)).toBe(0);
    // Passou do prazo, a barra fica vazia — nunca negativa.
    expect(fracaoDaBarra(visto, prazo, AGORA + 40_000)).toBe(0);
  });

  it('prazo novo reinicia a duração; prazo repetido a mantém', () => {
    const primeiro = verPrazo(vazio, AGORA + 45_000, AGORA);
    const meio = verPrazo(primeiro, AGORA + 45_000, AGORA + 20_000);
    expect(meio.total).toBe(primeiro.total);

    const segundo = verPrazo(meio, AGORA + 30_000, AGORA);
    expect(segundo.total).toBe(30_000);
  });

  it('prazo visto já correndo: a barra parte de cheia e só desce', () => {
    // Depois de um resync a primeira amostra pega o prazo pela metade. A barra
    // mostra o tempo que RESTA, então nascer cheia ali é o certo.
    const prazo = AGORA + 12_000;
    const visto = verPrazo(vazio, prazo, AGORA);
    expect(fracaoDaBarra(visto, prazo, AGORA)).toBe(1);
    expect(fracaoDaBarra(visto, prazo, AGORA + 6_000)).toBeCloseTo(0.5, 5);
  });
});

// --- CA-361: o áudio acorda no primeiro gesto ------------------------------

/**
 * Este teste existe porque o defeito não dá erro nenhum.
 *
 * O `AudioContext` criado fora de um gesto do usuário nasce `suspended` e fica
 * assim para sempre: todos os avisos saem MUDOS a sessão inteira, e o console
 * fica limpo. Era exatamente o que acontecia — `prepararSom` só era chamado de
 * dentro de um efeito do React, que não é gesto. Nada aqui prova que sai som
 * pelo alto-falante; prova que o gancho existe, dispara e se solta.
 */
describe('CA-361: o áudio acorda no primeiro gesto do jogador', () => {
  function alvoFalso() {
    const ouvintes = new Map<string, Set<() => void>>();
    return {
      ouvintes,
      addEventListener(tipo: string, o: () => void) {
        if (!ouvintes.has(tipo)) ouvintes.set(tipo, new Set());
        ouvintes.get(tipo)!.add(o);
      },
      removeEventListener(tipo: string, o: () => void) {
        ouvintes.get(tipo)?.delete(o);
      },
      disparar(tipo: string) {
        for (const o of [...(ouvintes.get(tipo) ?? [])]) o();
      },
      total() {
        let n = 0;
        for (const s of ouvintes.values()) n += s.size;
        return n;
      },
    };
  }

  it('escuta toque E teclado — só um dos dois deixaria alguém de fora', () => {
    const alvo = alvoFalso();
    despertarSomNoPrimeiroGesto(alvo);
    expect([...alvo.ouvintes.keys()].sort()).toEqual([...GESTOS].sort());
    expect(alvo.total()).toBe(GESTOS.length);
  });

  it('o primeiro gesto solta TODOS os ouvintes, não só o que disparou', () => {
    const alvo = alvoFalso();
    despertarSomNoPrimeiroGesto(alvo);
    alvo.disparar('pointerdown');
    // Se o `keydown` ficasse de pé, o jogo repetiria este trabalho a cada
    // tecla da partida inteira.
    expect(alvo.total()).toBe(0);
  });

  it('o mesmo vale começando pelo teclado', () => {
    const alvo = alvoFalso();
    despertarSomNoPrimeiroGesto(alvo);
    alvo.disparar('keydown');
    expect(alvo.total()).toBe(0);
  });

  it('desmontar sem nenhum gesto também solta tudo', () => {
    const alvo = alvoFalso();
    const soltar = despertarSomNoPrimeiroGesto(alvo);
    soltar();
    expect(alvo.total()).toBe(0);
  });

  it('gestos depois do primeiro não fazem nada — e não quebram', () => {
    const alvo = alvoFalso();
    despertarSomNoPrimeiroGesto(alvo);
    alvo.disparar('pointerdown');
    expect(() => alvo.disparar('pointerdown')).not.toThrow();
    expect(alvo.total()).toBe(0);
  });
});
