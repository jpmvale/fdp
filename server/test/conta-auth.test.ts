/**
 * O núcleo de autenticação: hash de senha e token de conta.
 *
 * Testa o que erra em silêncio. Senha que confere errado dá erro na cara;
 * senha que vaza informação pelo TEMPO de resposta não dá erro nenhum, e é
 * disso que CA-363 trata.
 */

import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createSigner, SESSAO_CONTA_MS } from '../src/session.js';
import {
  conferirSenha, gastarComoSeFosse, gerarHash, senhaAceitavel, SENHA_MIN, SENHA_MAX,
} from '../src/senha.js';

const SEGREDO = 'x'.repeat(48);
const AGORA = 1_700_000_000_000;

describe('senha: hash e conferência', () => {
  it('confere a senha certa e recusa a errada', async () => {
    const hash = await gerarHash('umaSenhaBoaAqui');
    expect(await conferirSenha('umaSenhaBoaAqui', hash)).toBe(true);
    expect(await conferirSenha('umaSenhaBoaAqul', hash)).toBe(false);
    expect(await conferirSenha('', hash)).toBe(false);
  });

  it('a mesma senha gera hashes diferentes — o sal é por senha', async () => {
    const a = await gerarHash('umaSenhaBoaAqui');
    const b = await gerarHash('umaSenhaBoaAqui');
    expect(a).not.toBe(b);
    // E os dois conferem: sal diferente não quebra nada.
    expect(await conferirSenha('umaSenhaBoaAqui', a)).toBe(true);
    expect(await conferirSenha('umaSenhaBoaAqui', b)).toBe(true);
  });

  it('o hash carrega os parâmetros, para o custo poder subir sem invalidar ninguém', async () => {
    const hash = await gerarHash('umaSenhaBoaAqui');
    const [algoritmo, n, r, p] = hash.split('$');
    expect(algoritmo).toBe('scrypt');
    expect(Number(n)).toBeGreaterThanOrEqual(2 ** 14);
    expect(Number(r)).toBeGreaterThan(0);
    expect(Number(p)).toBeGreaterThan(0);
  });

  it('hash malformado é recusado, nunca aceito por engano', async () => {
    for (const ruim of ['', 'x', 'scrypt$abc', 'bcrypt$1$2$3$4$5', 'scrypt$16384$8$1$$']) {
      expect(await conferirSenha('qualquer', ruim)).toBe(false);
    }
  });

  /**
   * Hash adulterado pedindo custo gigante seria negação de serviço contra o
   * próprio servidor: cada tentativa alocaria memória sem teto. Só chega aqui
   * quem já escreve no banco — mas defesa em profundidade custa uma linha.
   */
  it('recusa parâmetros absurdos em vez de tentar calcular', async () => {
    const forjado = ['scrypt', 2 ** 25, 64, 32, 'AAAA', 'AAAA'].join('$');
    expect(await conferirSenha('qualquer', forjado)).toBe(false);
  });

  it('senha mínima é comprimento, não composição', () => {
    expect(senhaAceitavel('a'.repeat(SENHA_MIN))).toBe(true);
    expect(senhaAceitavel('a'.repeat(SENHA_MIN - 1))).toBe(false);
    // `Senha@123` tem maiúscula, símbolo e número, e é pior que dez letras.
    expect(senhaAceitavel('Senha@123')).toBe(false);
    // Teto existe porque scrypt processa a entrada inteira.
    expect(senhaAceitavel('a'.repeat(SENHA_MAX + 1))).toBe(false);
  });

  /**
   * CA-363: e-mail desconhecido e senha errada gastam o mesmo tempo.
   *
   * Sem o hash de mentira, e-mail inexistente responde na hora — não há hash a
   * calcular — e o tempo vira uma consulta de "esta pessoa tem conta aqui?".
   * Com perfil público por link (D-4), é exatamente o que não pode vazar.
   *
   * A margem é folgada de propósito: medir tempo em CI é ruidoso. O que se
   * quer provar é que os dois caminhos custam a MESMA ORDEM de grandeza, e não
   * que batem no milissegundo.
   */
  it('CA-363: o caminho do e-mail desconhecido custa o mesmo do da senha errada', async () => {
    const hash = await gerarHash('umaSenhaBoaAqui');

    const medir = async (fn: () => Promise<unknown>): Promise<number> => {
      const inicio = performance.now();
      for (let i = 0; i < 3; i++) await fn();
      return performance.now() - inicio;
    };

    const comSenhaErrada = await medir(() => conferirSenha('outraSenhaAqui', hash));
    const semConta = await medir(() => gastarComoSeFosse('outraSenhaAqui'));

    const razao = Math.max(comSenhaErrada, semConta) / Math.min(comSenhaErrada, semConta);
    expect(razao).toBeLessThan(3);
    // E, principalmente, o caminho sem conta não é instantâneo.
    expect(semConta).toBeGreaterThan(1);
  });
});

describe('token de conta', () => {
  const signer = createSigner(SEGREDO);

  it('assina e verifica, carregando conta e época', () => {
    const token = signer.signConta('conta-1', 3, AGORA);
    const r = signer.verifyConta(token, AGORA);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.claims.conta).toBe('conta-1');
      expect(r.claims.epoca).toBe(3);
    }
  });

  it('expira, e a validade é a de D-7', () => {
    const token = signer.signConta('conta-1', 1, AGORA);
    expect(signer.verifyConta(token, AGORA + SESSAO_CONTA_MS - 2000).ok).toBe(true);
    expect(signer.verifyConta(token, AGORA + SESSAO_CONTA_MS + 2000))
      .toEqual({ ok: false, reason: 'EXPIRED' });
  });

  it('assinatura de outro segredo não passa', () => {
    const outro = createSigner('y'.repeat(48));
    const token = outro.signConta('conta-1', 1, AGORA);
    expect(signer.verifyConta(token, AGORA)).toEqual({ ok: false, reason: 'BAD_SIGNATURE' });
  });

  /**
   * A armadilha que o campo `tipo` existe para fechar.
   *
   * Os dois tokens são HS256 com o MESMO segredo, então a assinatura de um
   * confere no outro — só as claims diferem. E o token de sala viaja na query
   * string do WebSocket, onde proxy registra. Sem esta separação, um token
   * capturado de um log viraria sessão de conta permanente.
   */
  it('token de SALA não é aceito como token de conta', () => {
    const daSala = signer.sign('jogador-1', 'AB12C', AGORA);
    expect(signer.verifyConta(daSala, AGORA)).toEqual({ ok: false, reason: 'MALFORMED' });
  });

  it('token de CONTA não é aceito como token de sala', () => {
    const daConta = signer.signConta('conta-1', 1, AGORA);
    expect(signer.verify(daConta, AGORA).ok).toBe(false);
    expect(signer.verify(daConta, AGORA, 'AB12C').ok).toBe(false);
  });

  /**
   * Compatibilidade: token de sala emitido antes de o campo `tipo` existir não
   * pode virar abóbora no deploy. Quem estava no meio de uma partida continua.
   */
  it('token de sala sem `tipo` continua valendo — deploy não expulsa ninguém', () => {
    const emitido = signer.sign('jogador-1', 'AB12C', AGORA);
    const [cabecalho, corpo] = emitido.split('.');
    const claims = JSON.parse(Buffer.from(corpo!, 'base64url').toString('utf8'));
    delete claims.tipo;

    // Reassina com o mesmo segredo, como se tivesse sido emitido antes.
    const novoCorpo = Buffer.from(JSON.stringify(claims)).toString('base64url');
    const mac = createHmac('sha256', SEGREDO)
      .update(`${cabecalho}.${novoCorpo}`).digest().toString('base64url');
    const velho = `${cabecalho}.${novoCorpo}.${mac}`;

    expect(signer.verify(velho, AGORA, 'AB12C').ok).toBe(true);
    // Mas ele continua não servindo como token de conta.
    expect(signer.verifyConta(velho, AGORA).ok).toBe(false);
  });
});
