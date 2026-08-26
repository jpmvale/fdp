#!/usr/bin/env bash
# Sonda o FDP de fora e expõe o resultado como métrica do textfile collector.
#
# Instalado em ~/bin/metrica-fdp.sh na VPS e chamado pelo cron. NÃO passa pelo
# com-alerta.sh: aquele wrapper existe para jobs de backup, que rodam uma vez
# por dia e cuja falha merece email. Esta sonda roda de minuto em minuto — um
# email por minuto durante uma queda seria ruído, e o alerta certo para
# indisponibilidade se escreve no Grafana, sobre a métrica que este script
# publica.
#
# O que o cAdvisor já dá de graça (CPU e memória do container) não se repete
# aqui. O que ele NÃO responde é o que este script mede:
#
#   - o caminho INTEIRO funciona? DNS, TLS, Caddy e aplicação, na ordem que o
#     jogador percorre. Um container "Up" com o Caddy roteando errado é
#     exatamente a falha que a métrica de container não enxerga.
#   - quantas salas estão vivas? É a única métrica de USO do jogo, e sai
#     pronta de /api/health.
#
# Escrita atômica (tmp + mv) porque o exporter pode ler no meio da gravação e
# um arquivo pela metade quebra o parse de TODO o diretório.
set -uo pipefail

URL="${FDP_URL:-https://fdp.imp-software.cloud/api/health}"
METRICAS="${HOME}/metricas"
NOME="fdp"

mkdir -p "$METRICAS"

INICIO=$(date +%s%N)
CORPO=$(curl -fsS --max-time 10 "$URL" 2>/dev/null)
CODIGO=$?
FIM=$(date +%s%N)
LATENCIA_MS=$(( (FIM - INICIO) / 1000000 ))

if [ "$CODIGO" -eq 0 ]; then
  DISPONIVEL=1
  # `rooms` vem de /api/health (`server/src/http.ts`). Sem jq na máquina, e o
  # campo é um inteiro simples — grep resolve sem dependência nova.
  SALAS=$(echo "$CORPO" | grep -o '"rooms":[0-9]*' | cut -d: -f2)
  VERSAO=$(echo "$CORPO" | grep -o '"version":"[^"]*"' | cut -d'"' -f4)
  # Contas de pé ou não. É informação SEPARADA de `disponivel` de propósito: o
  # jogo funciona sem contas (plano 01, I-1), então o banco fora do ar não pode
  # marcar o serviço como indisponível — mas também não pode passar
  # despercebido até alguém tentar entrar na conta.
  case "$CORPO" in
    *'"contas":true'*)  CONTAS=1 ;;
    *'"contas":false'*) CONTAS=0 ;;
    *) CONTAS="" ;;   # versão antiga do app, sem o campo
  esac
else
  DISPONIVEL=0
  SALAS=""
  VERSAO=""
  CONTAS=""
fi

TMP="${METRICAS}/.${NOME}.tmp"
{
  echo "# HELP vps_fdp_disponivel 1 se /api/health respondeu 2xx pelo domínio público, 0 se não."
  echo "# TYPE vps_fdp_disponivel gauge"
  echo "vps_fdp_disponivel ${DISPONIVEL}"

  echo "# HELP vps_fdp_sonda_latencia_ms Tempo da sonda, do DNS à resposta."
  echo "# TYPE vps_fdp_sonda_latencia_ms gauge"
  echo "vps_fdp_sonda_latencia_ms ${LATENCIA_MS}"

  echo "# HELP vps_fdp_ultima_sonda_segundos Unix timestamp da última execução desta sonda."
  echo "# TYPE vps_fdp_ultima_sonda_segundos gauge"
  echo "vps_fdp_ultima_sonda_segundos $(date +%s)"

  if [ -n "$SALAS" ]; then
    echo "# HELP vps_fdp_salas Salas vivas no processo."
    echo "# TYPE vps_fdp_salas gauge"
    echo "vps_fdp_salas ${SALAS}"
  elif [ -f "${METRICAS}/${NOME}.prom" ]; then
    # Numa queda, preserva a última contagem conhecida em vez de publicar 0:
    # zero salas e "não sei" são estados diferentes, e um gráfico que despenca
    # a zero durante um incidente conta a história errada depois.
    grep "^vps_fdp_salas" "${METRICAS}/${NOME}.prom" || true
  fi

  if [ -n "$CONTAS" ]; then
    echo "# HELP vps_fdp_contas 1 se o Postgres de contas está conectado, 0 se o app subiu sem ele."
    echo "# TYPE vps_fdp_contas gauge"
    echo "vps_fdp_contas ${CONTAS}"
  fi

  if [ -n "$VERSAO" ]; then
    echo "# HELP vps_fdp_versao Versão no ar, como rótulo. O valor é sempre 1."
    echo "# TYPE vps_fdp_versao gauge"
    echo "vps_fdp_versao{versao=\"${VERSAO}\"} 1"
  fi
} > "$TMP"
mv -f "$TMP" "${METRICAS}/${NOME}.prom"
