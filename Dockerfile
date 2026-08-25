# Imagem de produção do FDP.
#
# Roda dos fontes TypeScript sob `tsx`, e não de um bundle: os pacotes do
# workspace exportam `.ts` e os imports usam `.js` — convenção ESM do
# TypeScript que o resolvedor do Node não mapeia de volta, então `node` puro
# não sobe o processo. Por isso `tsx` está em `dependencies`.
#
# Empacotar com esbuild é a alternativa e vale a pena quando o tempo de subida
# incomodar. Hoje não incomoda, e um passo de build a menos é um jeito a menos
# de o que roda divergir do que está commitado.

FROM node:24-alpine

# `tini` como PID 1. Sem ele o processo Node recebe os sinais sem o
# encanamento de init do Linux, e o desligamento gracioso de `main.ts` — que é
# o que faz CA-046 passar — depende de o SIGTERM chegar inteiro.
RUN apk add --no-cache tini

WORKDIR /app

# Camada de dependências separada do código: enquanto o lockfile não muda, um
# deploy só reconstrói a camada de baixo.
COPY package.json package-lock.json ./
COPY packages/rules/package.json    packages/rules/
COPY packages/store/package.json    packages/store/
COPY packages/protocol/package.json packages/protocol/
COPY packages/room/package.json     packages/room/
RUN npm ci --omit=dev

COPY . .

# Usuário sem privilégio. A imagem do Node já traz `node` (uid 1000); se o
# processo for comprometido, o que se ganha é o mínimo.
USER node

ENV NODE_ENV=production \
    PORT=3000

EXPOSE 3000

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["npx", "tsx", "server/src/main.ts"]
