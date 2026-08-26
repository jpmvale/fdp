/**
 * O quadro que o cliente põe no fio.
 *
 * Este teste existe por causa de um bug que derrubou o jogo inteiro em
 * produção sem parecer um bug. O cliente escrevia `v: 1` à mão desde o dia em
 * que nasceu; quando o protocolo virou 2, o servidor passou a recusar TODO
 * comando com `PROTOCOL_VERSION`. A sala continuava sendo criada — ela vem por
 * HTTP —, a tela continuava desenhando, e o único sinal era um "Não deu certo"
 * vermelho. Sentar bot, começar partida, apostar, jogar carta e falar no chat
 * pararam juntos, e o teste que teria pego isso não existia.
 *
 * A regra que ele guarda é uma só: a versão no quadro é a MESMA constante que
 * o servidor valida. Nenhum número escrito à mão aqui.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PROTOCOL_VERSION } from '@fdp/protocol';
import { conectar } from '../src/net/socket';

/** WebSocket de mentira: guarda o que foi enviado e nada mais. */
class SocketFalso {
  static OPEN = 1;
  static ultimo: SocketFalso | null = null;

  readyState = 1;
  enviados: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: ((e: { code: number }) => void) | null = null;

  constructor(public url: string) {
    SocketFalso.ultimo = this;
  }
  send(dados: string): void { this.enviados.push(dados); }
  close(): void { this.readyState = 3; }
}

const comSocketFalso = () => {
  vi.stubGlobal('WebSocket', SocketFalso as unknown as typeof WebSocket);
  vi.stubGlobal('crypto', { randomUUID: () => 'id-fixo' });
};

afterEach(() => { vi.unstubAllGlobals(); SocketFalso.ultimo = null; });

describe('CA-387: o cliente fala a versão de protocolo que o servidor valida', () => {
  it('todo comando sai com v = PROTOCOL_VERSION', () => {
    comSocketFalso();
    const c = conectar('ws://exemplo/ws', 'token-abc', {
      aoReceber: () => {}, aoMudarEstado: () => {},
    });

    c.enviar('host:addBot', { difficulty: 'MEDIO' });
    c.enviar('chat:send', { text: 'oi' });

    const quadros = SocketFalso.ultimo!.enviados.map((q) => JSON.parse(q) as { v: number });
    expect(quadros).toHaveLength(2);
    for (const q of quadros) expect(q.v).toBe(PROTOCOL_VERSION);
  });

  it('o token vai na query, e não no corpo de um quadro', () => {
    // A outra metade do contrato de abertura: o servidor autentica pela URL, e
    // um quadro de `auth` nunca existiu.
    comSocketFalso();
    conectar('ws://exemplo/ws', 'tok en/+=', { aoReceber: () => {}, aoMudarEstado: () => {} });

    expect(SocketFalso.ultimo!.url).toBe(`ws://exemplo/ws?token=${encodeURIComponent('tok en/+=')}`);
    expect(SocketFalso.ultimo!.enviados).toEqual([]);
  });
});
