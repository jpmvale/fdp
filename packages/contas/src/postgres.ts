/**
 * Implementação em Postgres. Mesmo contrato, mesma suíte (`11` §4).
 *
 * O que a versão em memória passa, esta precisa passar — e é a suíte
 * parametrizada, não dois arquivos parecidos, que impede as duas de divergirem
 * em silêncio.
 *
 * Duas coisas ficam do lado do banco de propósito, e não do lado do Node:
 *
 * - **Unicidade de e-mail e de slug** é `UNIQUE` no esquema, não `SELECT` antes
 *   do `INSERT`. Consulta-e-depois-grava tem janela: dois cadastros do mesmo
 *   e-mail chegando juntos passam os dois pelo `SELECT` e gravam os dois. O
 *   banco é o único lugar onde essa corrida não existe.
 * - **Atomicidade** é transação. `assumirPorSso` e `gravar` mexem em mais de
 *   uma tabela, e pela metade as duas produzem estado que a regra existe para
 *   impedir — conta com senha E SSO na primeira, partida sem jogadores na
 *   segunda.
 */

import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import type {
  Conta, Contas, Credencial, Dados, JogadorDaPartida,
  Partida, Partidas, Provedor,
} from './tipos.js';
import { emailNormalizado, slugDe, slugLivre, vaiPersistir } from './regras.js';

/**
 * `numeric` volta como string no driver, e é decisão dele, não descuido: um
 * `numeric(20,10)` não cabe num `number`. Aqui cabe — são notas e médias —,
 * então a conversão é local e explícita, em vez de global e silenciosa.
 */
const num = (v: unknown): number => (typeof v === 'number' ? v : Number(v));
const ms = (v: unknown): number => (v instanceof Date ? v.getTime() : Number(v));

export interface OpcoesPostgres {
  url: string;
  /** Aplica as migrações ao subir. Desligue só se outra coisa já as aplica. */
  migrar?: boolean;
  max?: number;
}

const MIGRACOES = ['001-contas.sql'] as const;

async function aplicarMigracoes(pool: pg.Pool): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS migracoes (
      nome        text        PRIMARY KEY,
      aplicada_em timestamptz NOT NULL DEFAULT now()
    )
  `);

  for (const nome of MIGRACOES) {
    const cliente = await pool.connect();
    try {
      await cliente.query('BEGIN');
      // O lock impede duas instâncias subindo juntas de aplicarem a mesma
      // migração em paralelo. Hoje o processo é único (`11` §3.1), mas migração
      // aplicada duas vezes é o tipo de estrago que não se desfaz.
      await cliente.query('SELECT pg_advisory_xact_lock(hashtext($1))', [nome]);
      const { rowCount } = await cliente.query(
        'SELECT 1 FROM migracoes WHERE nome = $1', [nome]);
      if (rowCount === 0) {
        const caminho = fileURLToPath(new URL(`./migracoes/${nome}`, import.meta.url));
        await cliente.query(await readFile(caminho, 'utf8'));
        await cliente.query('INSERT INTO migracoes (nome) VALUES ($1)', [nome]);
      }
      await cliente.query('COMMIT');
    } catch (erro) {
      await cliente.query('ROLLBACK');
      throw erro;
    } finally {
      cliente.release();
    }
  }
}

const paraConta = (r: Record<string, unknown>): Conta => ({
  id: r['id'] as string,
  slug: r['slug'] as string,
  apelido: r['apelido'] as string,
  avatar: r['avatar'] as Conta['avatar'],
  epocaSessao: num(r['epoca_sessao']),
  criadaEm: ms(r['criada_em']),
  atualizadaEm: ms(r['atualizada_em']),
});

const paraCredencial = (r: Record<string, unknown>): Credencial => ({
  contaId: r['conta_id'] as string,
  email: r['email'] as string,
  emailVerificado: r['email_verificado'] as boolean,
  hash: r['hash'] as string,
  atualizadaEm: ms(r['atualizada_em']),
});

const paraJogador = (r: Record<string, unknown>): JogadorDaPartida => ({
  posicao: num(r['posicao']),
  contaId: (r['conta_id'] as string | null) ?? null,
  apelido: r['apelido'] as string,
  avatar: r['avatar'] as JogadorDaPartida['avatar'],
  bot: r['bot'] as boolean,
  dificuldade: (r['dificuldade'] as string | null) ?? null,
  colocacao: num(r['colocacao']),
  vidasFinais: num(r['vidas_finais']),
  eliminadoRodada: r['eliminado_rodada'] === null ? null : num(r['eliminado_rodada']),
  mortoEmVaza: r['morto_em_vaza'] === null ? null : num(r['morto_em_vaza']),
  acertos: num(r['acertos']),
  jogadas: num(r['jogadas']),
  erroMedio: num(r['erro_medio']),
  piorErro: num(r['pior_erro']),
  nota: num(r['nota']),
});

const paraPartida = (
  r: Record<string, unknown>,
  jogadores: JogadorDaPartida[],
): Partida => ({
  id: r['id'] as string,
  salaCodigo: r['sala_codigo'] as string,
  comecouEm: ms(r['comecou_em']),
  terminouEm: ms(r['terminou_em']),
  motivoFim: r['motivo_fim'] as Partida['motivoFim'],
  rodadas: num(r['rodadas']),
  opcoes: r['opcoes'] as Partida['opcoes'],
  jogadores: jogadores.sort((a, b) => a.posicao - b.posicao),
});

/** `23505` é violação de UNIQUE. É assim que se lê "esse e-mail já existe". */
const ehDuplicata = (erro: unknown): boolean =>
  typeof erro === 'object' && erro !== null && (erro as { code?: string }).code === '23505';

export async function criarDadosEmPostgres(opcoes: OpcoesPostgres): Promise<Dados> {
  const pool = new pg.Pool({ connectionString: opcoes.url, max: opcoes.max ?? 10 });
  if (opcoes.migrar !== false) await aplicarMigracoes(pool);

  /**
   * Slug livre dentro da transação corrente.
   *
   * O `UNIQUE` do banco é a garantia final; isto só evita a colisão comum.
   * Duas contas "João" chegando no mesmo milissegundo ainda podem escolher o
   * mesmo slug e uma leva `23505` — que é tratado com nova tentativa em
   * `criarComSenha`/`criarComSso`.
   */
  const slugLivreNa = async (c: pg.PoolClient, apelido: string): Promise<string> => {
    const base = slugDe(apelido);
    const { rows } = await c.query<{ slug: string }>(
      'SELECT slug FROM contas WHERE slug = $1 OR slug LIKE $1 || $2', [base, '-%']);
    const usados = new Set(rows.map((r) => r.slug));
    return slugLivre(base, (s) => usados.has(s));
  };

  const emTransacao = async <T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T> => {
    const cliente = await pool.connect();
    try {
      await cliente.query('BEGIN');
      const resultado = await fn(cliente);
      await cliente.query('COMMIT');
      return resultado;
    } catch (erro) {
      await cliente.query('ROLLBACK');
      throw erro;
    } finally {
      cliente.release();
    }
  };

  const contasApi: Contas = {
    async criarComSenha({ apelido, avatar, email, hash }) {
      const alvo = emailNormalizado(email);

      for (let tentativa = 0; tentativa < 5; tentativa++) {
        try {
          return await emTransacao(async (c) => {
            const id = randomUUID();
            const slug = await slugLivreNa(c, apelido);
            const { rows } = await c.query(
              `INSERT INTO contas (id, slug, apelido, avatar, criada_em, atualizada_em)
               VALUES ($1, $2, $3, $4, now(), now()) RETURNING *`,
              [id, slug, apelido, JSON.stringify(avatar)]);
            await c.query(
              `INSERT INTO credenciais_senha (conta_id, email, hash, atualizada_em)
               VALUES ($1, $2, $3, now())`,
              [id, alvo, hash]);
            return { ok: true as const, conta: paraConta(rows[0]!) };
          });
        } catch (erro) {
          if (!ehDuplicata(erro)) throw erro;
          // Pode ser o e-mail (definitivo) ou o slug (basta tentar de novo).
          const { rowCount } = await pool.query(
            'SELECT 1 FROM credenciais_senha WHERE lower(email) = $1', [alvo]);
          if (rowCount && rowCount > 0) return { ok: false as const, motivo: 'EMAIL_EM_USO' };
        }
      }
      throw new Error('não foi possível achar slug livre em 5 tentativas');
    },

    async criarComSso({ apelido, avatar, provedor, subject, email }) {
      for (let tentativa = 0; tentativa < 5; tentativa++) {
        try {
          return await emTransacao(async (c) => {
            const id = randomUUID();
            const slug = await slugLivreNa(c, apelido);
            const { rows } = await c.query(
              `INSERT INTO contas (id, slug, apelido, avatar, criada_em, atualizada_em)
               VALUES ($1, $2, $3, $4, now(), now()) RETURNING *`,
              [id, slug, apelido, JSON.stringify(avatar)]);
            await c.query(
              `INSERT INTO identidades_sso (provedor, subject, conta_id, email, criada_em)
               VALUES ($1, $2, $3, $4, now())`,
              [provedor, subject, id, email === null ? null : emailNormalizado(email)]);
            return paraConta(rows[0]!);
          });
        } catch (erro) {
          if (!ehDuplicata(erro)) throw erro;
          const { rows } = await pool.query(
            `SELECT c.* FROM contas c
               JOIN identidades_sso i ON i.conta_id = c.id
              WHERE i.provedor = $1 AND i.subject = $2`, [provedor, subject]);
          // A identidade já existia: entrar de novo devolve a mesma conta, e
          // não um erro. É login, não cadastro.
          if (rows[0]) return paraConta(rows[0]);
        }
      }
      throw new Error('não foi possível achar slug livre em 5 tentativas');
    },

    async porId(id) {
      const { rows } = await pool.query('SELECT * FROM contas WHERE id = $1', [id]);
      return rows[0] ? paraConta(rows[0]) : null;
    },

    async porSlug(slug) {
      const { rows } = await pool.query('SELECT * FROM contas WHERE slug = $1', [slug]);
      return rows[0] ? paraConta(rows[0]) : null;
    },

    async porIdentidade(provedor, subject) {
      const { rows } = await pool.query(
        `SELECT c.* FROM contas c
           JOIN identidades_sso i ON i.conta_id = c.id
          WHERE i.provedor = $1 AND i.subject = $2`, [provedor, subject]);
      return rows[0] ? paraConta(rows[0]) : null;
    },

    async credencialPorEmail(email) {
      const { rows } = await pool.query(
        'SELECT * FROM credenciais_senha WHERE lower(email) = $1', [emailNormalizado(email)]);
      return rows[0] ? paraCredencial(rows[0]) : null;
    },

    async atualizarPerfil(id, { apelido, avatar }) {
      // O slug NÃO acompanha o apelido: ele é o endereço do perfil, e link que
      // muda ao trocar de apelido é link quebrado na conversa de outra pessoa.
      const { rows } = await pool.query(
        `UPDATE contas SET apelido = $2, avatar = $3, atualizada_em = now()
          WHERE id = $1 RETURNING *`,
        [id, apelido, JSON.stringify(avatar)]);
      return rows[0] ? paraConta(rows[0]) : null;
    },

    async novaEpoca(id) {
      const { rows } = await pool.query(
        `UPDATE contas SET epoca_sessao = epoca_sessao + 1, atualizada_em = now()
          WHERE id = $1 RETURNING epoca_sessao`, [id]);
      return rows[0] ? num(rows[0].epoca_sessao) : null;
    },

    async assumirPorSso({ contaId, provedor, subject, email }) {
      return emTransacao(async (c) => {
        const existe = await c.query('SELECT 1 FROM contas WHERE id = $1', [contaId]);
        if (existe.rowCount === 0) return null;

        await c.query(
          `INSERT INTO identidades_sso (provedor, subject, conta_id, email, criada_em)
           VALUES ($1, $2, $3, $4, now())
           ON CONFLICT (provedor, subject) DO UPDATE
             SET conta_id = EXCLUDED.conta_id, email = EXCLUDED.email`,
          [provedor, subject, contaId, email === null ? null : emailNormalizado(email)]);

        await c.query('DELETE FROM credenciais_senha WHERE conta_id = $1', [contaId]);

        const { rows } = await c.query(
          `UPDATE contas SET epoca_sessao = epoca_sessao + 1, atualizada_em = now()
            WHERE id = $1 RETURNING *`, [contaId]);
        return rows[0] ? paraConta(rows[0]) : null;
      });
    },
  };

  const partidasApi: Partidas = {
    async gravar(entrada) {
      if (!vaiPersistir(entrada.jogadores)) return null;

      return emTransacao(async (c) => {
        const id = randomUUID();
        await c.query(
          `INSERT INTO partidas
             (id, sala_codigo, comecou_em, terminou_em, motivo_fim, rodadas, opcoes)
           VALUES ($1, $2, to_timestamp($3::double precision / 1000),
                   to_timestamp($4::double precision / 1000), $5, $6, $7)`,
          [id, entrada.salaCodigo, entrada.comecouEm, entrada.terminouEm,
           entrada.motivoFim, entrada.rodadas, JSON.stringify(entrada.opcoes)]);

        for (const j of entrada.jogadores) {
          await c.query(
            `INSERT INTO partida_jogadores
               (partida_id, posicao, conta_id, apelido, avatar, bot, dificuldade,
                colocacao, vidas_finais, eliminado_rodada, morto_em_vaza,
                acertos, jogadas, erro_medio, pior_erro, nota)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
            [id, j.posicao, j.contaId, j.apelido, JSON.stringify(j.avatar), j.bot,
             j.dificuldade, j.colocacao, j.vidasFinais, j.eliminadoRodada,
             j.mortoEmVaza, j.acertos, j.jogadas, j.erroMedio, j.piorErro, j.nota]);
        }

        return { ...entrada, id, jogadores: entrada.jogadores.map((j) => ({ ...j })) };
      });
    },

    async porId(id) {
      const { rows } = await pool.query('SELECT * FROM partidas WHERE id = $1', [id]);
      if (!rows[0]) return null;
      const js = await pool.query(
        'SELECT * FROM partida_jogadores WHERE partida_id = $1', [id]);
      return paraPartida(rows[0], js.rows.map(paraJogador));
    },

    async porConta(contaId, opcoes = {}) {
      const { rows } = await pool.query(
        `SELECT p.* FROM partidas p
           JOIN partida_jogadores j ON j.partida_id = p.id
          WHERE j.conta_id = $1
          ORDER BY p.terminou_em DESC
          LIMIT $2`, [contaId, opcoes.limite ?? 20]);
      if (rows.length === 0) return [];

      const ids = rows.map((r) => r.id as string);
      const js = await pool.query(
        'SELECT * FROM partida_jogadores WHERE partida_id = ANY($1::uuid[])', [ids]);

      const porPartida = new Map<string, JogadorDaPartida[]>();
      for (const linha of js.rows) {
        const lista = porPartida.get(linha.partida_id as string) ?? [];
        lista.push(paraJogador(linha));
        porPartida.set(linha.partida_id as string, lista);
      }
      return rows.map((r) => paraPartida(r, porPartida.get(r.id as string) ?? []));
    },

    async resumoDaConta(contaId) {
      const { rows } = await pool.query(
        `SELECT count(*)::int AS partidas,
                count(*) FILTER (WHERE colocacao = 1)::int AS vitorias,
                avg(nota) FILTER (WHERE jogadas > 0) AS nota_media
           FROM partida_jogadores WHERE conta_id = $1`, [contaId]);
      const r = rows[0]!;
      return {
        partidas: num(r.partidas),
        vitorias: num(r.vitorias),
        notaMedia: r.nota_media === null ? null : Math.round(num(r.nota_media) * 10) / 10,
      };
    },
  };

  return {
    contas: contasApi,
    partidas: partidasApi,
    async fechar() { await pool.end(); },
  };
}
