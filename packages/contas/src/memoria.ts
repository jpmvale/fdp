/**
 * Implementação em memória — a referência do contrato (`11` §4).
 *
 * Não é maquete de teste. É a definição executável do comportamento: o que ela
 * faz, o Postgres precisa fazer igual, e a mesma suíte cobra os dois. Quando as
 * duas discordam, é aqui que se lê qual era a intenção.
 *
 * Tudo é clonado na saída. Devolver a referência interna deixaria quem chamou
 * editar o banco por acidente — e em memória isso "funciona", o que é pior: o
 * defeito só apareceria ao trocar para o Postgres.
 */

import { randomUUID } from 'node:crypto';
import type {
  Conta, ContaId, Contas, Credencial, Dados, IdentidadeSso,
  Partida, PartidaId, Partidas, Provedor,
} from './tipos.js';
import { emailNormalizado, slugDe, slugLivre, vaiPersistir } from './regras.js';

const clonar = <T>(v: T): T => structuredClone(v);

export interface OpcoesMemoria {
  /** Relógio injetável: teste que depende de `Date.now` é teste instável. */
  agora?: () => number;
}

export function criarDadosEmMemoria(opcoes: OpcoesMemoria = {}): Dados {
  const agora = opcoes.agora ?? (() => Date.now());

  const contas = new Map<ContaId, Conta>();
  const credenciais = new Map<ContaId, Credencial>();
  const identidades = new Map<string, IdentidadeSso>();
  const partidas = new Map<PartidaId, Partida>();

  const chaveSso = (p: Provedor, s: string): string => `${p} ${s}`;

  const porEmail = (email: string): Credencial | undefined => {
    const alvo = emailNormalizado(email);
    for (const c of credenciais.values()) if (c.email === alvo) return c;
    return undefined;
  };

  const novoSlug = (apelido: string): string => {
    const usados = new Set([...contas.values()].map((c) => c.slug));
    return slugLivre(slugDe(apelido), (s) => usados.has(s));
  };

  const contasApi: Contas = {
    async criarComSenha({ apelido, avatar, email, hash }) {
      const alvo = emailNormalizado(email);
      if (porEmail(alvo)) return { ok: false, motivo: 'EMAIL_EM_USO' };

      const t = agora();
      const conta: Conta = {
        id: randomUUID(), slug: novoSlug(apelido), apelido, avatar: clonar(avatar),
        epocaSessao: 1, criadaEm: t, atualizadaEm: t,
      };
      contas.set(conta.id, conta);
      credenciais.set(conta.id, {
        contaId: conta.id, email: alvo, emailVerificado: false, hash, atualizadaEm: t,
      });
      return { ok: true, conta: clonar(conta) };
    },

    async criarComSso({ apelido, avatar, provedor, subject, email }) {
      const t = agora();
      const conta: Conta = {
        id: randomUUID(), slug: novoSlug(apelido), apelido, avatar: clonar(avatar),
        epocaSessao: 1, criadaEm: t, atualizadaEm: t,
      };
      contas.set(conta.id, conta);
      identidades.set(chaveSso(provedor, subject), {
        provedor, subject, contaId: conta.id,
        email: email === null ? null : emailNormalizado(email), criadaEm: t,
      });
      return clonar(conta);
    },

    async porId(id) {
      const c = contas.get(id);
      return c ? clonar(c) : null;
    },

    async porSlug(slug) {
      for (const c of contas.values()) if (c.slug === slug) return clonar(c);
      return null;
    },

    async porIdentidade(provedor, subject) {
      const i = identidades.get(chaveSso(provedor, subject));
      if (!i) return null;
      const c = contas.get(i.contaId);
      return c ? clonar(c) : null;
    },

    async credencialPorEmail(email) {
      const c = porEmail(email);
      return c ? clonar(c) : null;
    },

    async provedoresPorEmail(email) {
      const alvo = emailNormalizado(email);
      const achados = new Set<Provedor>();
      for (const i of identidades.values()) if (i.email === alvo) achados.add(i.provedor);
      return [...achados].sort();
    },

    async atualizarPerfil(id, { apelido, avatar }) {
      const c = contas.get(id);
      if (!c) return null;
      // O slug NÃO acompanha o apelido: ele é o endereço do perfil, e link que
      // muda ao trocar de apelido é link quebrado na conversa de outra pessoa.
      const novo: Conta = { ...c, apelido, avatar: clonar(avatar), atualizadaEm: agora() };
      contas.set(id, novo);
      return clonar(novo);
    },

    async novaEpoca(id) {
      const c = contas.get(id);
      if (!c) return null;
      const novo: Conta = { ...c, epocaSessao: c.epocaSessao + 1, atualizadaEm: agora() };
      contas.set(id, novo);
      return novo.epocaSessao;
    },

    async assumirPorSso({ contaId, provedor, subject, email }) {
      const c = contas.get(contaId);
      if (!c) return null;
      const t = agora();
      identidades.set(chaveSso(provedor, subject), {
        provedor, subject, contaId,
        email: email === null ? null : emailNormalizado(email), criadaEm: t,
      });
      credenciais.delete(contaId);
      const novo: Conta = { ...c, epocaSessao: c.epocaSessao + 1, atualizadaEm: t };
      contas.set(contaId, novo);
      return clonar(novo);
    },
  };

  const partidasApi: Partidas = {
    async gravar(entrada) {
      if (!vaiPersistir(entrada.jogadores)) return null;
      const partida: Partida = { ...clonar(entrada), id: randomUUID() };
      partidas.set(partida.id, partida);
      return clonar(partida);
    },

    async porId(id) {
      const p = partidas.get(id);
      return p ? clonar(p) : null;
    },

    async porConta(contaId, opcoes = {}) {
      const minhas = [...partidas.values()]
        .filter((p) => p.jogadores.some((j) => j.contaId === contaId))
        // O desempate pelo id espelha o do Postgres. Duas implementações que
        // ordenam diferente passam a suíte de contrato e divergem na página 2.
        .sort((a, b) => b.terminouEm - a.terminouEm || (a.id < b.id ? 1 : -1));

      const pular = opcoes.pular ?? 0;
      return clonar(minhas.slice(pular, pular + (opcoes.limite ?? 20)));
    },

    async resumoDaConta(contaId) {
      const minhas = [...partidas.values()].filter((p) =>
        p.jogadores.some((j) => j.contaId === contaId));

      let vitorias = 0;
      let soma = 0;
      let comNota = 0;
      for (const p of minhas) {
        const eu = p.jogadores.find((j) => j.contaId === contaId);
        if (!eu) continue;
        if (eu.colocacao === 1) vitorias++;
        // Partida em que a pessoa não jogou rodada nenhuma não tem nota que
        // signifique alguma coisa, e entrar como zero puxaria a média para
        // baixo por ter sido eliminada cedo — que não é o que a nota mede.
        if (eu.jogadas > 0) { soma += eu.nota; comNota++; }
      }

      return {
        partidas: minhas.length,
        vitorias,
        notaMedia: comNota === 0 ? null : Math.round((soma / comNota) * 10) / 10,
      };
    },
  };

  return {
    contas: contasApi,
    partidas: partidasApi,
    async fechar() { /* nada a fechar */ },
  };
}
