#!/usr/bin/env bash
#
# Deploy do FDP na VPS: rsync dos fontes + dependências + restart gracioso.
#
#   ./deploy/deploy.sh usuario@host
#
# Não faz build: o repositório roda dos fontes TypeScript sob `tsx` (ver
# deploy/README.md). O que vai para a VPS é o que está commitado — a árvore
# precisa estar limpa, para que o que roda em produção seja identificável.

set -euo pipefail

DESTINO="${1:-}"
if [[ -z "$DESTINO" ]]; then
  echo "uso: $0 usuario@host" >&2
  exit 1
fi

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$RAIZ"

if [[ -n "$(git status --porcelain)" ]]; then
  echo "árvore suja: commite ou descarte antes de subir" >&2
  git status --short >&2
  exit 1
fi

SHA="$(git rev-parse --short HEAD)"
echo "==> subindo $SHA para $DESTINO"

# `--delete` sem `.git`, `node_modules` e testes: a VPS recebe o que executa.
rsync -az --delete \
  --exclude '.git' \
  --exclude 'node_modules' \
  --exclude 'dist' \
  --exclude '*.tsbuildinfo' \
  ./ "$DESTINO:/opt/fdp/"

ssh "$DESTINO" bash -euo pipefail <<REMOTO
  cd /opt/fdp
  # \`--omit=dev\` de propósito: vitest e typescript não fazem parte do que roda.
  # \`tsx\` está em dependencies porque é execução, não desenvolvimento.
  npm ci --omit=dev

  # Lido pela unidade como EnvironmentFile opcional; é o que faz
  # /api/health devolver o sha que está no ar.
  echo "FDP_VERSION=$SHA" | sudo tee /etc/fdp/version > /dev/null

  sudo chown -R fdp:fdp /opt/fdp
  sudo systemctl restart fdp
REMOTO

echo "==> aguardando o serviço responder"
for _ in $(seq 1 30); do
  if ssh "$DESTINO" 'curl -sf -o /dev/null http://127.0.0.1:3000/api/health'; then
    echo "==> no ar: $(ssh "$DESTINO" 'curl -s http://127.0.0.1:3000/api/health')"
    exit 0
  fi
  sleep 1
done

echo "o serviço não respondeu em 30s — veja: ssh $DESTINO journalctl -u fdp -n 50" >&2
exit 1
