-- 002 — elo das partidas ranqueadas. Plano 03 §6.1.

-- Uma linha por conta que JÁ jogou ranqueada. Quem nunca jogou não tem linha, e
-- lê-se elo inicial: criar linha no cadastro encheria a tabela de contas que
-- talvez nunca entrem na fila, e obrigaria o cadastro a saber o que é elo.
CREATE TABLE elo (
  conta_id      uuid        PRIMARY KEY REFERENCES contas(id) ON DELETE CASCADE,
  pontos        integer     NOT NULL,
  -- Só ranqueadas. É este número que define o K (plano 03 §4.1), e por isso ele
  -- não pode contar partida privada: quem joga com os amigos há meses não está
  -- calibrado para a fila.
  partidas      integer     NOT NULL DEFAULT 0,
  melhor_pontos integer     NOT NULL,
  atualizado_em timestamptz NOT NULL
);

-- 'PRIVADA' | 'FILA' | 'RANQUEADA'. Default para as partidas que já existem:
-- todas elas são de sala criada por link, que é o que 'PRIVADA' quer dizer.
ALTER TABLE partidas ADD COLUMN origem text NOT NULL DEFAULT 'PRIVADA';

-- NULL quando a partida não é ranqueada, e não zero: zero é um delta, ausência
-- de elo não é um delta. A tela precisa dessa diferença para não escrever "±0"
-- numa partida que nunca teve elo.
ALTER TABLE partida_jogadores ADD COLUMN elo_antes integer;
ALTER TABLE partida_jogadores ADD COLUMN elo_delta integer;
ALTER TABLE partida_jogadores ADD COLUMN abandonou boolean NOT NULL DEFAULT false;
