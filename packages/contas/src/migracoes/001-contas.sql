-- 001 — contas, credenciais, identidades e histórico de partidas.
-- Plano 01 §4. Nomes em português, como o resto do código.

CREATE TABLE contas (
  id            uuid        PRIMARY KEY,
  -- Identificador PÚBLICO, o que vai na URL do perfil. O `id` nunca sai do
  -- servidor: expor a chave primária num link é entregar de graça a ordem e o
  -- volume de cadastros.
  slug          text        NOT NULL UNIQUE,
  apelido       text        NOT NULL,
  avatar        jsonb       NOT NULL,
  -- D-8: revogação em massa sem tabela de sessões. O token carrega a época.
  epoca_sessao  integer     NOT NULL DEFAULT 1,
  criada_em     timestamptz NOT NULL,
  atualizada_em timestamptz NOT NULL
);

CREATE TABLE credenciais_senha (
  conta_id         uuid        PRIMARY KEY REFERENCES contas(id) ON DELETE CASCADE,
  -- "Joao@x.com" e "joao@x.com" são a mesma conta, e a unicidade tem de valer
  -- no BANCO: deixá-la para a aplicação é deixar a porta aberta para dois
  -- cadastros do mesmo e-mail entrando ao mesmo tempo, os dois passando pelo
  -- SELECT antes de qualquer um gravar.
  --
  -- A garantia é o índice único sobre `lower(email)`, logo abaixo, e não a
  -- extensão `citext`. citext exige CREATE EXTENSION — que pede superusuário
  -- em boa parte dos Postgres gerenciados — para entregar o que um índice
  -- funcional já entrega. Também foi ela que quebrou a suíte na primeira
  -- execução: a extensão nasce num esquema só, e some para quem não o tem no
  -- search_path.
  email            text        NOT NULL,
  -- Sempre false por ora (D-5). Existe desde já para que ligar a confirmação
  -- de e-mail não precise de migração — plano 01 §8.
  email_verificado boolean     NOT NULL DEFAULT false,
  hash             text        NOT NULL,
  atualizada_em    timestamptz NOT NULL
);

CREATE UNIQUE INDEX credenciais_senha_email ON credenciais_senha (lower(email));

CREATE TABLE identidades_sso (
  provedor  text        NOT NULL,
  -- O `sub` do provedor. É a chave, e o e-mail NÃO é: e-mail no Google e no
  -- GitHub muda, o subject não.
  subject   text        NOT NULL,
  conta_id  uuid        NOT NULL REFERENCES contas(id) ON DELETE CASCADE,
  email     text,
  criada_em timestamptz NOT NULL,
  PRIMARY KEY (provedor, subject)
);

CREATE INDEX identidades_sso_conta ON identidades_sso (conta_id);

-- RF-063 pergunta "que provedores respondem por este e-mail?" no caminho do
-- login, que é quente. Sem o índice funcional, é varredura da tabela.
CREATE INDEX identidades_sso_email ON identidades_sso (lower(email))
  WHERE email IS NOT NULL;

CREATE TABLE partidas (
  id           uuid        PRIMARY KEY,
  sala_codigo  text        NOT NULL,
  comecou_em   timestamptz NOT NULL,
  terminou_em  timestamptz NOT NULL,
  motivo_fim   text        NOT NULL,
  rodadas      integer     NOT NULL,
  opcoes       jsonb       NOT NULL
);

CREATE TABLE partida_jogadores (
  partida_id       uuid    NOT NULL REFERENCES partidas(id) ON DELETE CASCADE,
  posicao          integer NOT NULL,
  -- NULL em convidado e em bot. `ON DELETE SET NULL` e não CASCADE: apagar uma
  -- conta não pode apagar a partida dos OUTROS jogadores. O apelido fica no
  -- snapshot e a linha vira a de um convidado qualquer — que é o que a pessoa
  -- passa a ser depois de sair.
  conta_id         uuid    REFERENCES contas(id) ON DELETE SET NULL,
  -- Snapshot, não referência: quem trocar de apelido amanhã não reescreve a
  -- partida de ontem.
  apelido          text    NOT NULL,
  avatar           jsonb   NOT NULL,
  bot              boolean NOT NULL,
  dificuldade      text,
  colocacao        integer NOT NULL,
  vidas_finais     integer NOT NULL,
  eliminado_rodada integer,
  morto_em_vaza    integer,
  acertos          integer NOT NULL,
  jogadas          integer NOT NULL,
  erro_medio       numeric(4,2) NOT NULL,
  pior_erro        integer NOT NULL,
  nota             numeric(3,1) NOT NULL,
  PRIMARY KEY (partida_id, posicao)
);

-- A consulta que a tela de perfil faz: as partidas de uma conta, da mais nova
-- para a mais velha. Sem este índice ela varre a tabela inteira.
CREATE INDEX partida_jogadores_conta ON partida_jogadores (conta_id)
  WHERE conta_id IS NOT NULL;
