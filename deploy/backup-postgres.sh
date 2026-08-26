#!/usr/bin/env bash
# Backup do Postgres do FDP.
#
# Um backup que nunca foi restaurado não é backup, é esperança. Este script tem
# um par — `restaurar-postgres.sh` — e o plano 01 põe a restauração no gate de
# saída da F1 justamente para que ela aconteça uma vez, para valer, antes de
# haver dado de gente de verdade lá dentro.
#
#   ./backup-postgres.sh                 # usa DATABASE_URL
#   DESTINO=/var/backups/fdp ./backup-postgres.sh
#
# `--format=custom` e não SQL puro: comprime, permite restaurar tabela avulsa e
# não depende da ordem do arquivo.

set -euo pipefail

: "${DATABASE_URL:?defina DATABASE_URL}"
DESTINO="${DESTINO:-/var/backups/fdp}"
GUARDAR_DIAS="${GUARDAR_DIAS:-14}"

mkdir -p "$DESTINO"
arquivo="$DESTINO/fdp-$(date -u +%Y%m%dT%H%M%SZ).dump"

pg_dump --format=custom --no-owner --no-privileges --file="$arquivo" "$DATABASE_URL"

# Um dump que não abre é um arquivo, não um backup. `--list` lê o índice e
# falha se o arquivo estiver truncado — é barato e pega o pior caso.
pg_restore --list "$arquivo" > /dev/null

echo "ok $arquivo ($(du -h "$arquivo" | cut -f1))"

# Descarte por idade. Sem isto o disco enche e o backup para de rodar
# exatamente quando ele passa a ser necessário.
find "$DESTINO" -name 'fdp-*.dump' -type f -mtime "+$GUARDAR_DIAS" -delete
