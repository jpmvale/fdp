/**
 * Contrato de `Dados` — uma suíte, todas as implementações (`11` §4).
 *
 * O que a versão em memória passa, a de Postgres precisa passar. Suíte
 * parametrizada, e não dois arquivos parecidos, pelo mesmo motivo do
 * `RoomStore`: diferença de comportamento vira teste vermelho, não um defeito
 * que só aparece em produção.
 *
 * Cita CA-363 a CA-373 do plano 01 §11 onde couber; o resto é contrato de
 * repositório, que não precisa de critério de aceite próprio para existir.
 */

import { describe, expect, it } from 'vitest';
import type { Avatar } from '@fdp/protocol';
import type { Dados, JogadorDaPartida, Partida } from '../src/index.js';

export interface DadosHarness {
  nome: string;
  criar(): Promise<Dados>;
}

const AVATAR: Avatar = { emoji: '🦊', color: 'amber' };

const jogador = (over: Partial<JogadorDaPartida> = {}): JogadorDaPartida => ({
  posicao: 0, contaId: null, apelido: 'Convidado', avatar: AVATAR, bot: false,
  dificuldade: null, colocacao: 1, vidasFinais: 3, eliminadoRodada: null,
  mortoEmVaza: null, acertos: 4, jogadas: 6, erroMedio: 0.5, piorErro: 2, nota: 7.5,
  ...over,
});

const partida = (jogadores: JogadorDaPartida[], over: Partial<Partida> = {}): Omit<Partida, 'id'> => ({
  salaCodigo: 'AB12C',
  comecouEm: 1_700_000_000_000,
  terminouEm: 1_700_000_600_000,
  motivoFim: 'VITORIA',
  rodadas: 7,
  opcoes: { vidasIniciais: 5, maxCartasPorRodada: 7, regraEmpate: 'EMPATE_ANULA_VAZA' } as Partida['opcoes'],
  jogadores,
  ...over,
});

export function descreverContratoDeDados(harness: DadosHarness): void {
  describe(`Dados (${harness.nome})`, () => {
    async function comDados<T>(fn: (d: Dados) => Promise<T>): Promise<T> {
      const dados = await harness.criar();
      try {
        return await fn(dados);
      } finally {
        await dados.fechar();
      }
    }

    // --- contas por senha ---------------------------------------------------

    it('cria conta com senha e a encontra por id, slug e e-mail', () =>
      comDados(async (d) => {
        const r = await d.contas.criarComSenha({
          apelido: 'João', avatar: AVATAR, email: 'joao@exemplo.com', hash: 'h1',
        });
        expect(r.ok).toBe(true);
        if (!r.ok) return;

        expect(r.conta.slug).toBe('joao');
        expect(r.conta.epocaSessao).toBe(1);
        expect(await d.contas.porId(r.conta.id)).toMatchObject({ apelido: 'João' });
        expect(await d.contas.porSlug('joao')).toMatchObject({ id: r.conta.id });

        const cred = await d.contas.credencialPorEmail('joao@exemplo.com');
        expect(cred).toMatchObject({ contaId: r.conta.id, hash: 'h1' });
        // D-5: nasce sempre falso, e a coluna existe para não precisar migrar
        // quando a confirmação de e-mail entrar.
        expect(cred?.emailVerificado).toBe(false);
      }));

    it('e-mail em uso é recusado, e a caixa não abre brecha', () =>
      comDados(async (d) => {
        await d.contas.criarComSenha({
          apelido: 'João', avatar: AVATAR, email: 'joao@exemplo.com', hash: 'h1',
        });
        // "Joao@Exemplo.com" é a MESMA conta. Sem isto, dois cadastros do mesmo
        // e-mail convivem e o login vira sorteio.
        const r = await d.contas.criarComSenha({
          apelido: 'Outro', avatar: AVATAR, email: '  Joao@Exemplo.COM ', hash: 'h2',
        });
        expect(r).toEqual({ ok: false, motivo: 'EMAIL_EM_USO' });
      }));

    it('e-mail desconhecido não devolve credencial', () =>
      comDados(async (d) => {
        expect(await d.contas.credencialPorEmail('ninguem@exemplo.com')).toBeNull();
      }));

    it('apelidos iguais geram slugs diferentes — o slug é um endereço', () =>
      comDados(async (d) => {
        const slugs: string[] = [];
        for (let i = 0; i < 3; i++) {
          const r = await d.contas.criarComSenha({
            apelido: 'João', avatar: AVATAR, email: `joao${i}@exemplo.com`, hash: 'h',
          });
          if (r.ok) slugs.push(r.conta.slug);
        }
        expect(slugs).toEqual(['joao', 'joao-2', 'joao-3']);
      }));

    it('apelido sem nada aproveitável ainda gera slug — ninguém é recusado pelo próprio nome', () =>
      comDados(async (d) => {
        const r = await d.contas.criarComSenha({
          apelido: '🦊', avatar: AVATAR, email: 'raposa@exemplo.com', hash: 'h',
        });
        expect(r.ok).toBe(true);
        if (r.ok) expect(r.conta.slug).toBe('jogador');
      }));

    it('trocar de apelido NÃO troca o slug: link de perfil não pode quebrar', () =>
      comDados(async (d) => {
        const r = await d.contas.criarComSenha({
          apelido: 'João', avatar: AVATAR, email: 'j@exemplo.com', hash: 'h',
        });
        if (!r.ok) throw new Error('cadastro falhou');

        const novo = await d.contas.atualizarPerfil(r.conta.id, {
          apelido: 'Joana', avatar: { emoji: '🐙', color: 'teal' },
        });
        expect(novo).toMatchObject({ apelido: 'Joana', slug: 'joao' });
        expect(novo?.avatar).toEqual({ emoji: '🐙', color: 'teal' });
        expect(await d.contas.porSlug('joao')).toMatchObject({ apelido: 'Joana' });
      }));

    // --- SSO ----------------------------------------------------------------

    it('cria conta por SSO e a encontra pela identidade', () =>
      comDados(async (d) => {
        const conta = await d.contas.criarComSso({
          apelido: 'Ana', avatar: AVATAR, provedor: 'google',
          subject: 'sub-1', email: 'ana@exemplo.com',
        });
        expect(await d.contas.porIdentidade('google', 'sub-1'))
          .toMatchObject({ id: conta.id });
        // Mesmo subject noutro provedor é outra pessoa.
        expect(await d.contas.porIdentidade('github', 'sub-1')).toBeNull();
      }));

    it('conta criada por SSO não tem senha', () =>
      comDados(async (d) => {
        await d.contas.criarComSso({
          apelido: 'Ana', avatar: AVATAR, provedor: 'google',
          subject: 'sub-1', email: 'ana@exemplo.com',
        });
        expect(await d.contas.credencialPorEmail('ana@exemplo.com')).toBeNull();
      }));

    /** CA-366: a tomada de conta de D-3, e ela é tudo ou nada. */
    it('CA-366: SSO assume a conta, apaga a senha e derruba as sessões', () =>
      comDados(async (d) => {
        const r = await d.contas.criarComSenha({
          apelido: 'João', avatar: AVATAR, email: 'joao@exemplo.com', hash: 'h1',
        });
        if (!r.ok) throw new Error('cadastro falhou');
        const epocaAntes = r.conta.epocaSessao;

        const depois = await d.contas.assumirPorSso({
          contaId: r.conta.id, provedor: 'google',
          subject: 'sub-google', email: 'joao@exemplo.com',
        });

        expect(depois).not.toBeNull();
        // A senha some — apagada, não desativada. Se ficasse, duas pessoas
        // teriam acesso à mesma conta, que é o que a regra existe para impedir.
        expect(await d.contas.credencialPorEmail('joao@exemplo.com')).toBeNull();
        // E a época sobe, derrubando o que já estava aberto (D-8).
        expect(depois!.epocaSessao).toBe(epocaAntes + 1);
        expect(await d.contas.porIdentidade('google', 'sub-google'))
          .toMatchObject({ id: r.conta.id });
        // A conta continua a mesma: o slug e o histórico não se perdem.
        expect(depois!.id).toBe(r.conta.id);
        expect(depois!.slug).toBe(r.conta.slug);
      }));

    it('assumir conta que não existe não cria nada', () =>
      comDados(async (d) => {
        const r = await d.contas.assumirPorSso({
          contaId: '00000000-0000-4000-8000-000000000000',
          provedor: 'google', subject: 'x', email: null,
        });
        expect(r).toBeNull();
        expect(await d.contas.porIdentidade('google', 'x')).toBeNull();
      }));

    it('nova época sobe de um em um e não mexe no resto', () =>
      comDados(async (d) => {
        const r = await d.contas.criarComSenha({
          apelido: 'João', avatar: AVATAR, email: 'j@exemplo.com', hash: 'h',
        });
        if (!r.ok) throw new Error('cadastro falhou');
        expect(await d.contas.novaEpoca(r.conta.id)).toBe(2);
        expect(await d.contas.novaEpoca(r.conta.id)).toBe(3);
        expect(await d.contas.porId(r.conta.id)).toMatchObject({ apelido: 'João' });
      }));

    it('conta inexistente devolve null em toda leitura', () =>
      comDados(async (d) => {
        const fantasma = '00000000-0000-4000-8000-000000000001';
        expect(await d.contas.porId(fantasma)).toBeNull();
        expect(await d.contas.porSlug('ninguem')).toBeNull();
        expect(await d.contas.novaEpoca(fantasma)).toBeNull();
        expect(await d.contas.atualizarPerfil(fantasma, {
          apelido: 'X', avatar: AVATAR,
        })).toBeNull();
      }));

    // --- histórico ----------------------------------------------------------

    /** CA-367 — a regra de RF-068, e ela mora aqui de propósito. */
    it('CA-367: partida sem nenhum jogador com conta não grava nada', () =>
      comDados(async (d) => {
        const gravada = await d.partidas.gravar(partida([
          jogador({ posicao: 0, apelido: 'Convidado' }),
          jogador({ posicao: 1, apelido: 'Bot Ada', bot: true, dificuldade: 'MEDIO', colocacao: 2 }),
        ]));
        expect(gravada).toBeNull();
      }));

    it('CA-367: bot com conta não existe — bot nunca conta', () =>
      comDados(async (d) => {
        const r = await d.contas.criarComSenha({
          apelido: 'Ana', avatar: AVATAR, email: 'a@exemplo.com', hash: 'h',
        });
        if (!r.ok) throw new Error('cadastro falhou');
        // Um bot com `contaId` é estado impossível, mas se chegar aqui não pode
        // ser o que faz a partida existir.
        const gravada = await d.partidas.gravar(partida([
          jogador({ posicao: 0, apelido: 'Convidado' }),
          jogador({ posicao: 1, apelido: 'Bot', bot: true, contaId: r.conta.id, colocacao: 2 }),
        ]));
        expect(gravada).toBeNull();
      }));

    it('grava a partida quando ao menos um sentado tem conta, com todos os jogadores', () =>
      comDados(async (d) => {
        const r = await d.contas.criarComSenha({
          apelido: 'Ana', avatar: AVATAR, email: 'a@exemplo.com', hash: 'h',
        });
        if (!r.ok) throw new Error('cadastro falhou');

        const gravada = await d.partidas.gravar(partida([
          jogador({ posicao: 0, contaId: r.conta.id, apelido: 'Ana', colocacao: 1 }),
          jogador({ posicao: 1, apelido: 'Convidado', colocacao: 2, vidasFinais: 0,
                    eliminadoRodada: 5, mortoEmVaza: 3, nota: 4.2 }),
          jogador({ posicao: 2, apelido: 'Bot Elis', bot: true, dificuldade: 'DIFICIL',
                    colocacao: 3, vidasFinais: 0, eliminadoRodada: 2 }),
        ]));

        expect(gravada).not.toBeNull();
        const lida = await d.partidas.porId(gravada!.id);
        expect(lida).not.toBeNull();
        expect(lida!.jogadores).toHaveLength(3);
        expect(lida!.salaCodigo).toBe('AB12C');
        expect(lida!.motivoFim).toBe('VITORIA');
        expect(lida!.rodadas).toBe(7);
        // O convidado é gravado por SNAPSHOT: sem conta, e com o nome que
        // apareceu na mesa.
        const convidado = lida!.jogadores[1]!;
        expect(convidado.contaId).toBeNull();
        expect(convidado.apelido).toBe('Convidado');
        expect(convidado.eliminadoRodada).toBe(5);
        expect(convidado.mortoEmVaza).toBe(3);
        expect(convidado.nota).toBeCloseTo(4.2, 5);
        // Bot é bot, com a dificuldade registrada.
        expect(lida!.jogadores[2]).toMatchObject({ bot: true, dificuldade: 'DIFICIL' });
      }));

    it('o snapshot não segue a conta: trocar de apelido não reescreve a partida', () =>
      comDados(async (d) => {
        const r = await d.contas.criarComSenha({
          apelido: 'Ana', avatar: AVATAR, email: 'a@exemplo.com', hash: 'h',
        });
        if (!r.ok) throw new Error('cadastro falhou');

        const gravada = await d.partidas.gravar(partida([
          jogador({ posicao: 0, contaId: r.conta.id, apelido: 'Ana' }),
        ]));
        await d.contas.atualizarPerfil(r.conta.id, {
          apelido: 'Anastácia', avatar: { emoji: '🐝', color: 'lime' },
        });

        const lida = await d.partidas.porId(gravada!.id);
        // Ainda "Ana": o histórico é registro do que aconteceu, e partida de
        // seis meses atrás não muda de elenco sozinha.
        expect(lida!.jogadores[0]!.apelido).toBe('Ana');
        expect(lida!.jogadores[0]!.avatar).toEqual(AVATAR);
      }));

    it('partidas de uma conta vêm da mais nova para a mais velha, e só as dela', () =>
      comDados(async (d) => {
        const a = await d.contas.criarComSenha({
          apelido: 'Ana', avatar: AVATAR, email: 'a@exemplo.com', hash: 'h' });
        const b = await d.contas.criarComSenha({
          apelido: 'Beto', avatar: AVATAR, email: 'b@exemplo.com', hash: 'h' });
        if (!a.ok || !b.ok) throw new Error('cadastro falhou');

        await d.partidas.gravar(partida(
          [jogador({ contaId: a.conta.id })], { terminouEm: 1_000 }));
        await d.partidas.gravar(partida(
          [jogador({ contaId: a.conta.id })], { terminouEm: 3_000 }));
        await d.partidas.gravar(partida(
          [jogador({ contaId: b.conta.id })], { terminouEm: 2_000 }));

        const minhas = await d.partidas.porConta(a.conta.id);
        expect(minhas.map((p) => p.terminouEm)).toEqual([3_000, 1_000]);
        expect(minhas[0]!.jogadores).toHaveLength(1);
      }));

    it('o limite corta pelas mais recentes', () =>
      comDados(async (d) => {
        const a = await d.contas.criarComSenha({
          apelido: 'Ana', avatar: AVATAR, email: 'a@exemplo.com', hash: 'h' });
        if (!a.ok) throw new Error('cadastro falhou');

        for (const t of [1_000, 2_000, 3_000]) {
          await d.partidas.gravar(partida([jogador({ contaId: a.conta.id })], { terminouEm: t }));
        }
        const duas = await d.partidas.porConta(a.conta.id, { limite: 2 });
        expect(duas.map((p) => p.terminouEm)).toEqual([3_000, 2_000]);
      }));

    it('resumo conta partidas, vitórias e a nota média', () =>
      comDados(async (d) => {
        const a = await d.contas.criarComSenha({
          apelido: 'Ana', avatar: AVATAR, email: 'a@exemplo.com', hash: 'h' });
        if (!a.ok) throw new Error('cadastro falhou');

        await d.partidas.gravar(partida([jogador({ contaId: a.conta.id, colocacao: 1, nota: 8 })]));
        await d.partidas.gravar(partida([jogador({ contaId: a.conta.id, colocacao: 3, nota: 6 })]));

        expect(await d.partidas.resumoDaConta(a.conta.id))
          .toEqual({ partidas: 2, vitorias: 1, notaMedia: 7 });
      }));

    it('conta sem partida tem nota média nula, não zero', () =>
      comDados(async (d) => {
        const a = await d.contas.criarComSenha({
          apelido: 'Ana', avatar: AVATAR, email: 'a@exemplo.com', hash: 'h' });
        if (!a.ok) throw new Error('cadastro falhou');
        // Média de nada não é zero. Zero é uma nota ruim; ausência não é nota.
        expect(await d.partidas.resumoDaConta(a.conta.id))
          .toEqual({ partidas: 0, vitorias: 0, notaMedia: null });
      }));

    it('partida em que a pessoa não jogou rodada nenhuma não puxa a média', () =>
      comDados(async (d) => {
        const a = await d.contas.criarComSenha({
          apelido: 'Ana', avatar: AVATAR, email: 'a@exemplo.com', hash: 'h' });
        if (!a.ok) throw new Error('cadastro falhou');

        await d.partidas.gravar(partida([jogador({ contaId: a.conta.id, nota: 8, jogadas: 4 })]));
        await d.partidas.gravar(partida([jogador({ contaId: a.conta.id, nota: 0, jogadas: 0 })]));

        const resumo = await d.partidas.resumoDaConta(a.conta.id);
        expect(resumo.partidas).toBe(2);
        expect(resumo.notaMedia).toBe(8);
      }));

    it('partida inexistente devolve null', () =>
      comDados(async (d) => {
        expect(await d.partidas.porId('00000000-0000-4000-8000-000000000002')).toBeNull();
      }));
  });
}
