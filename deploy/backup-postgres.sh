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

# Descarte por idade. Sem isto o disco enche e o backup para de rodar
# exatamente quando ele passa a ser necessário.
find "$DESTINO" -name 'fdp-*.dump' -type f -mtime "+$GUARDAR_DIAS" -delete
