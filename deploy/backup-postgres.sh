#!/usr/bin/env bash
# Backup do Postgres do FDP.
#
# Um backup que nunca foi restaurado não é backup, é esperança. Este script tem
# um par — `restaurar-postgres.sh` — e o plano 01 põe a restauração no gate de
# saída da F1 justamente para que ela aconteça uma vez, para valer, antes de
# haver dado de gente de verdade lá dentro.
#
#   ./backup-postgres.sh                 # usa o container `fdp-postgres`
#   DESTINO=/outro/lugar ./backup-postgres.sh
#   CONTAINER= DATABASE_URL=postgres://... ./backup-postgres.sh   # sem docker
#
# `--format=custom` e não SQL puro: comprime, permite restaurar tabela avulsa e
# não depende da ordem do arquivo.

set -euo pipefail

DESTINO="${DESTINO:-$HOME/backups/fdp}"
GUARDAR_DIAS="${GUARDAR_DIAS:-14}"
# Na VPS o cliente de Postgres não está no host — ele mora no container. Com
# `CONTAINER` definido, tudo roda lá dentro e a senha nunca sai de lá.
CONTAINER="${CONTAINER:-fdp-postgres}"

mkdir -p "$DESTINO"
arquivo="$DESTINO/fdp-$(date -u +%Y%m%dT%H%M%SZ).dump"

if docker inspect "$CONTAINER" >/dev/null 2>&1; then
  # `$POSTGRES_PASSWORD` é lido DENTRO do container: a senha não passa pela
  # linha de comando do host, onde apareceria em `ps` para qualquer usuário.
  docker exec "$CONTAINER" sh -c \
    'PGPASSWORD=$POSTGRES_PASSWORD pg_dump --format=custom --no-owner --no-privileges -U "$POSTGRES_USER" -d "$POSTGRES_DB"' \
    > "$arquivo"
  docker exec -i "$CONTAINER" pg_restore --list < "$arquivo" > /dev/null
else
  : "${DATABASE_URL:?sem container ${CONTAINER}: defina DATABASE_URL}"
  pg_dump --format=custom --no-owner --no-privileges --file="$arquivo" "$DATABASE_URL"
  # Um dump que não abre é um arquivo, não um backup. `--list` lê o índice e
  # falha se o arquivo estiver truncado — é barato e pega o pior caso.
  pg_restore --list "$arquivo" > /dev/null
fi

echo "ok $arquivo ($(du -h "$arquivo" | cut -f1))"

# ---------------------------------------------------------------------------
# Cópia fora da máquina
# ---------------------------------------------------------------------------
#
# Um backup no mesmo disco que o banco protege contra `DROP TABLE`, e contra
# mais nada. Disco perdido, máquina trocada ou provedor com problema levam os
# dois juntos — e é justamente nesses casos que alguém vai procurar o backup.
#
# Opcional de propósito, como o SSO e o R2 dos avatares: sem as variáveis, o
# backup local continua funcionando igual e o script não falha. Quem roda numa
# máquina de teste não precisa de bucket.
if [ -n "${R2_BUCKET:-}" ]; then
  echo "enviando para o R2…"
  # Dentro do container da API: ele tem node e o nosso código, e a VPS não
  # precisa ganhar nada novo no host. `--network host` não é preciso — o
  # container fala com a internet pela rede padrão dele.
  if docker run --rm \
      -v "$DESTINO":/backups:ro \
      -e R2_ENDPOINT -e R2_BUCKET -e R2_ACCESS_KEY_ID -e R2_SECRET_ACCESS_KEY -e R2_REGIAO \
      "${IMAGEM_FDP:-ghcr.io/jpmvale/fdp:latest}" \
      npx tsx server/src/enviar-para-r2.ts "/backups/$(basename "$arquivo")" \
        "postgres/$(basename "$arquivo")"; then
    echo "cópia fora da máquina ok"
  else
    # Falha no envio NÃO derruba o backup local, que já está gravado e
    # conferido. Mas sai com erro para o `com-alerta.sh` avisar: um backup que
    # deixou de sair da máquina em silêncio é o pior dos dois mundos.
    echo "::erro:: o backup local está ok, mas a cópia para o R2 falhou" >&2
    FALHOU_ENVIO=1
  fi
fi

# Descarte por idade. Sem isto o disco enche e o backup para de rodar
# exatamente quando ele passa a ser necessário.
#
# Só o LOCAL é descartado. O que está no bucket segue a política de retenção do
# R2, que é onde ela deve viver: apagar remoto a partir daqui exigiria listar o
# bucket, e um erro nessa listagem apagaria o que se quer guardar.
find "$DESTINO" -name 'fdp-*.dump' -type f -mtime "+$GUARDAR_DIAS" -delete

exit "${FALHOU_ENVIO:-0}"
