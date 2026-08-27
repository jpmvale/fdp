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
# **Usa o `enviar-r2.sh` da máquina**, o mesmo de `backup-mongo.sh` e dos
# outros. Ele já lê as credenciais de `~/.config/backup-r2.env`, aplica
# retenção, e recusa mandar dump para o bucket PÚBLICO de mídia. Escrever um
# segundo caminho aqui — com outro arquivo de credencial e outra variável de
# bucket — seria uma convenção paralela para o mesmo problema, e a segunda
# convenção é sempre a que alguém esquece de atualizar.
#
# Opcional de propósito: sem o `enviar-r2.sh` (máquina de teste, clone local),
# o backup roda igual e o script não falha.
ENVIAR="${HOME}/bin/enviar-r2.sh"
if [ -x "$ENVIAR" ]; then
  if "$ENVIAR" "$arquivo" "fdp/$(basename "$arquivo")" "${RETENCAO_R2_DIAS:-30}"; then
    echo "cópia fora da máquina ok"
  else
    # Falha no envio NÃO derruba o backup local, que já está gravado e
    # conferido. Mas sai com erro para o `com-alerta.sh` avisar: um backup que
    # deixou de sair da máquina em silêncio é o pior dos dois mundos.
    echo "[$(date -Is)] ERRO: backup local ok, mas o envio ao R2 falhou" >&2
    FALHOU_ENVIO=1
  fi
else
  echo "sem $ENVIAR: backup só local"
fi

# Descarte por idade. Sem isto o disco enche e o backup para de rodar
# exatamente quando ele passa a ser necessário.
#
# Só o LOCAL é descartado. O que está no bucket segue a política de retenção do
# R2, que é onde ela deve viver: apagar remoto a partir daqui exigiria listar o
# bucket, e um erro nessa listagem apagaria o que se quer guardar.
find "$DESTINO" -name 'fdp-*.dump' -type f -mtime "+$GUARDAR_DIAS" -delete

exit "${FALHOU_ENVIO:-0}"
