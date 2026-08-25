# Imagem de produção do FDP.
#
# Duas etapas por um motivo específico: o cliente precisa do Vite e do
# TypeScript para ser construído, e nada disso tem o que fazer na imagem final.
# A primeira etapa constrói `app/build/`; a segunda leva só o resultado.

# --- etapa 1: o cliente ------------------------------------------------------
FROM node:24-alpine AS cliente

WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/rules/package.json    packages/rules/
COPY packages/store/package.json    packages/store/
COPY packages/protocol/package.json packages/protocol/
COPY packages/room/package.json     packages/room/
# Com devDependencies: é aqui que o Vite existe.
RUN npm ci

COPY . .
RUN npm run build:client

# --- etapa 2: o que roda -----------------------------------------------------
FROM node:24-alpine

# `tini` como PID 1. Sem ele o processo Node recebe os sinais sem o encanamento
# de init do Linux, e o desligamento gracioso de `main.ts` — que é o que faz
# CA-046 passar — depende de o SIGTERM chegar inteiro.
RUN apk add --no-cache tini

WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/rules/package.json    packages/rules/
COPY packages/store/package.json    packages/store/
COPY packages/protocol/package.json packages/protocol/
COPY packages/room/package.json     packages/room/
RUN npm ci --omit=dev

COPY . .

# O build do cliente vem da etapa anterior, e NÃO do contexto: se dependesse do
# contexto, a imagem sairia com o `app/build/` que por acaso estivesse na
# máquina de quem publicou — ou sem cliente nenhum num checkout limpo, com o
# sintoma sendo um 500 na raiz sem causa aparente.
COPY --from=cliente /app/app/build ./app/build

# Roda dos fontes TypeScript sob `tsx`: os pacotes do workspace exportam `.ts` e
# os imports usam `.js` — convenção ESM do TypeScript que o resolvedor do Node
# não mapeia de volta, então `node` puro não sobe o processo.
USER node

ENV NODE_ENV=production \
    PORT=3000

EXPOSE 3000

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["npx", "tsx", "server/src/main.ts"]
