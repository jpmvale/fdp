/**
 * Contas, credenciais e histórico — o que sobrevive à sala.
 *
 * Este pacote é o par do `@fdp/store` e o oposto dele em quase tudo. O `store`
 * guarda sala viva: efêmera, com TTL, jogada fora quando a mesa acaba. Aqui é o
 * contrário — dado permanente, com transação e chave estrangeira. São dois
 * bancos com dois papéis, e nenhum invade o do outro (plano 01 §D-1).
 *
 * O que NÃO mora aqui, e é de propósito: nada de regra de jogo. `@fdp/rules`
 * não sabe o que é conta e não vai saber (plano 01, invariante I-2).
 */

import type { Avatar } from '@fdp/protocol';
import type { EndReason, MatchOptions } from '@fdp/rules';

export type ContaId = string;
export type PartidaId = string;

/** Os provedores de D-2. A lista é fechada aqui e aberta por migração. */
export const PROVEDORES = ['google', 'github'] as const;
export type Provedor = (typeof PROVEDORES)[number];

export interface Conta {
  id: ContaId;
  /** Identificador PÚBLICO, usado na URL do perfil. O `id` nunca sai daqui. */
  slug: string;
  apelido: string;
  avatar: Avatar;
  /**
   * Revogação em massa sem tabela de sessões (D-8). O token carrega a época;
   * incrementar aqui derruba tudo que foi emitido antes.
   */
  epocaSessao: number;
  criadaEm: number;
  atualizadaEm: number;
}

export interface Credencial {
  contaId: ContaId;
  email: string;
  /**
   * Sempre `false` por ora (D-5). A coluna existe desde o começo para que
   * ligar a confirmação de e-mail não exija migração — ver plano 01 §8.
   */
  emailVerificado: boolean;
  hash: string;
  atualizadaEm: number;
}

export interface IdentidadeSso {
  provedor: Provedor;
  /** O `sub` do provedor. É a chave — NUNCA o e-mail, que muda. */
  subject: string;
  contaId: ContaId;
  email: string | null;
  criadaEm: number;
}

/**
 * Um jogador dentro de uma partida gravada.
 *
 * `apelido` e `avatar` são SNAPSHOT, não referência. É a mesma razão pela qual
 * `ChatMessage` copia o `nickname` no envio: quem trocar de apelido amanhã não
 * reescreve a partida de ontem, e o convidado sem conta precisa aparecer de
 * algum jeito. Com referência viva, uma partida de seis meses atrás mudaria de
 * elenco sozinha.
 */
export interface JogadorDaPartida {
  posicao: number;
  /** `null` em convidado e em bot. */
  contaId: ContaId | null;
  apelido: string;
  avatar: Avatar;
  bot: boolean;
  dificuldade: string | null;
  /** 1 = campeão. Vem de `ranking()` do motor (RJ-012, RJ-129). */
  colocacao: number;
  vidasFinais: number;
  eliminadoRodada: number | null;
  mortoEmVaza: number | null;
  acertos: number;
  jogadas: number;
  erroMedio: number;
  piorErro: number;
  nota: number;
}

export interface Partida {
  id: PartidaId;
  salaCodigo: string;
  comecouEm: number;
  terminouEm: number;
  motivoFim: EndReason;
  rodadas: number;
  opcoes: MatchOptions;
  jogadores: JogadorDaPartida[];
}

/** O que a tela de perfil mostra sem abrir partida nenhuma. */
export interface ResumoDaConta {
  partidas: number;
  vitorias: number;
  /** `null` quando ainda não há partida — média de nada não é zero. */
  notaMedia: number | null;
}

export type CriarComSenha =
  | { ok: true; conta: Conta }
  | { ok: false; motivo: 'EMAIL_EM_USO' };

export interface Contas {
  criarComSenha(dados: {
    apelido: string;
    avatar: Avatar;
    email: string;
    hash: string;
  }): Promise<CriarComSenha>;

  criarComSso(dados: {
    apelido: string;
    avatar: Avatar;
    provedor: Provedor;
    subject: string;
    email: string | null;
  }): Promise<Conta>;

  porId(id: ContaId): Promise<Conta | null>;
  porSlug(slug: string): Promise<Conta | null>;
  porIdentidade(provedor: Provedor, subject: string): Promise<Conta | null>;

  /** Para o login por senha. Devolve a credencial, nunca a conta sozinha. */
  credencialPorEmail(email: string): Promise<Credencial | null>;

  atualizarPerfil(
    id: ContaId,
    dados: { apelido: string; avatar: Avatar },
  ): Promise<Conta | null>;

  /** Devolve a nova época. Usado por "sair de todos os aparelhos" e por §7. */
  novaEpoca(id: ContaId): Promise<number | null>;

  /**
   * A tomada de conta de D-3, em UMA transação: vincula a identidade SSO,
   * **apaga** a credencial de senha e incrementa a época.
   *
   * Tudo ou nada não é preferência. Se o vínculo entrar e a senha ficar, duas
   * pessoas passam a ter acesso à mesma conta — que é exatamente o que a regra
   * existe para impedir.
   */
  assumirPorSso(dados: {
    contaId: ContaId;
    provedor: Provedor;
    subject: string;
    email: string | null;
  }): Promise<Conta | null>;
}

export interface Partidas {
  /**
   * Grava a partida. Devolve `null` — e **não escreve nada** — quando nenhum
   * jogador sentado tem conta (RF-068).
   *
   * A regra mora aqui, e não em quem chama, pelo mesmo motivo que a unicidade
   * de identidade passou a morar na sala: fronteira que confia em quem chama é
   * fronteira por onde a regra escapa.
   */
  gravar(partida: Omit<Partida, 'id'>): Promise<Partida | null>;

  porId(id: PartidaId): Promise<Partida | null>;
  porConta(contaId: ContaId, opcoes?: { limite?: number }): Promise<Partida[]>;
  resumoDaConta(contaId: ContaId): Promise<ResumoDaConta>;
}

export interface Dados {
  contas: Contas;
  partidas: Partidas;
  fechar(): Promise<void>;
}
