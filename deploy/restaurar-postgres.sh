#!/usr/bin/env bash
# Restaura um backup do FDP num banco VAZIO.
#
# Não restaura por cima de banco com dado: `--clean` sobre a base errada apaga
# o que estava lá, e a hora de descobrir isso não é durante um incidente. O
# script recusa se achar tabela `contas` no destino.
#
#   ./restaurar-postgres.sh /var/backups/fdp/fdp-2026....dump 'postgres://.../fdp_restauracao'

set -euo pipefail

arquivo="${1:?uso: restaurar-postgres.sh <arquivo.dump> <url-de-destino>}"
destino="${2:?uso: restaurar-postgres.sh <arquivo.dump> <url-de-destino>}"

[ -r "$arquivo" ] || { echo "não consigo ler $arquivo" >&2; exit 1; }

existe=$(psql "$destino" -tAc \
  "SELECT count(*) FROM information_schema.tables WHERE table_name = 'contas'")

if [ "$existe" != "0" ]; then
  echo "destino JÁ TEM a tabela contas — recusando para não sobrescrever." >&2
  echo "restaure num banco vazio e promova depois." >&2
  exit 1
fi

pg_restore --no-owner --no-privileges --exit-on-error --dbname="$destino" "$arquivo"

echo "restaurado. conferindo:"
psql "$destino" -tAc "SELECT 'contas: ' || count(*) FROM contas"
psql "$destino" -tAc "SELECT 'partidas: ' || count(*) FROM partidas"
psql "$destino" -tAc "SELECT 'jogadores: ' || count(*) FROM partida_jogadores"
