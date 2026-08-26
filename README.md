# FDP

Jogo de cartas de **vazas, aposta e blefe** para 2 a 8 pessoas, jogado no navegador — cada uma
no seu próprio dispositivo, conectadas por uma sala com código de convite.

Você declara quantas vazas vai ganhar e perde vidas ao errar. Uma regra estrutural impede que a
soma das apostas da mesa feche com o número de vazas disponíveis: **alguém sempre se dá mal**.
E na rodada de 1 carta você aposta sem ver a própria carta — ela fica na sua testa, à vista de
todos os outros.

Da família do **Fodinha** brasileiro, parente do Oh Hell.

## Estado

**No ar e jogável em <https://fdp.imp-software.cloud>.** Partida completa, contas, SSO,
histórico e perfil público.

| Fase | O quê | Status |
|---|---|---|
| M0 | Especificação completa | ✅ |
| M1 | Servidor, sala, WebSocket, persistência | ✅ na VPS, com Redis e desligamento gracioso |
| M2 | Lobby jogável | ✅ |
| M3 | Partida | ✅ |
| M4 | Endurecimento e entrega | 🚧 falta o que define "entregue" — ver abaixo |

```
packages/rules/      ✅  motor de regras — puro e determinístico
packages/bot/        ✅  decisão dos bots, quatro dificuldades
packages/store/      ✅  RoomStore: interface, memória e Redis — mesma suíte
packages/contas/     ✅  contas, credenciais, SSO e histórico — memória e Postgres
packages/protocol/   ✅  contrato cliente ↔ servidor + validação
packages/room/       ✅  máquina de sala, timers, pausa, auto-play, bots
server/              ✅  HTTP + WebSocket, sessão assinada, limites, SIGTERM
app/                 ✅  cliente Vite + React com o design system Nocturne
```

O que falta para o M4 fechar, na ordem em que compra mais confiança:

- **Nenhuma suíte E2E existe.** São 17 critérios de nível `E` que hoje ninguém executa.
- **Nenhum teste de carga** (RNF-060: 500 salas, 2.000 sockets) nem os de desempenho.
- Os dois testes manuais de acessibilidade de `08` §5 e a auditoria de segurança de `09` §3.1.
- O roteiro manual de `10` §8: 4 pessoas reais, 4 dispositivos.
- **LGPD**: retenção e apagamento de conta. Não bloqueia jogar; bloqueia divulgar o jogo fora
  do círculo de amigos.

Estado detalhado, decisões e armadilhas em [HANDOFF.md](HANDOFF.md).

## Como se joga

Cada rodada tem um número de cartas, que cresce de 1 até o teto e volta a 1. Você aposta
quantas vazas vai ganhar, depois joga. Errou a aposta? Perde uma vida por vaza de diferença.
Zerou as vidas, está fora. Último de pé vence.

A pegadinha: **a soma das apostas da mesa nunca pode bater com o número de vazas**. O último a
apostar é obrigado a estragar a conta de alguém.

Regras completas e normativas em [`docs/02-regras-do-jogo.md`](docs/02-regras-do-jogo.md).

## Documentação

O diretório [`docs/`](docs/) é a **fonte da verdade** do projeto — 14 documentos com 113 regras
de jogo, 207 critérios de aceite e 18 invariantes de estado, todos com identificador estável e
rastreados até o teste que os cobre.

Capacidades novas entram por um **plano** em [`docs/plans/`](docs/plans/), que vive lá até
virar emenda nos normativos. O primeiro — contas, perfis e histórico — está entregue.

Comece pelo [índice](docs/README.md).

## Desenvolvimento

Requer Node 24+.

```bash
npm install
npm run build:client   # OBRIGATÓRIO antes do primeiro `npm start`
npm start              # http://localhost:3000
npm test               # 550 testes
npm run typecheck
```

O servidor serve o cliente de `app/build/`, que o Vite gera e o git não guarda: sem
`build:client`, a raiz responde 500 sem causa aparente no log.

Os dois bancos são **opcionais em desenvolvimento**, e o que se perde sem eles é explícito:
sem `REDIS_URL` as salas morrem com o processo; sem `DATABASE_URL` não há contas. Com eles,
uma partida sobrevive a `SIGTERM` exatamente onde estava.

```bash
npm run redis     # noutro terminal
FDP_SESSION_SECRET=<32+ caracteres> REDIS_URL=redis://127.0.0.1:6379 npm start
```

Para jogar sozinho, o caminho curto é **sentar bots pelo lobby**.

O motor de regras roda sem servidor, sem WebSocket e sem navegador. `npm test` inclui um teste
de propriedade que simula **1.000 partidas** — 2 a 8 jogadores, ambos os modos de empate — e
verifica os 18 invariantes a cada jogada, além de checar vazamento de informação oculta em toda
projeção gerada.

Há um segundo teste de propriedade que simula 300 partidas **com quedas de conexão e decisões
de ausência aleatórias**, verificando que nenhuma sala fica presa em pausa.

Os dois já encontraram bugs reais que nenhuma revisão de código teria pego:

- Na rodada de testa, a carta era contada duas vezes — na mão e na mesa — quebrando a
  conservação de cartas sem sintoma visível.
- Uma partida encerrada por retirada mantinha o "jogador da vez" apontando para quem acabou de
  sair, fazendo a interface pedir jogada a um fantasma.

E um que eles **não** pegaram, porque a invariante estava mal traduzida: a sala ficava presa em
`EM_PARTIDA` depois de uma vitória, tornando a revanche inalcançável. `03` §5 sempre exigiu
partida *ativa*; o código só verificava se havia partida. Apareceu jogando.

## Arquitetura

Um processo Node persistente numa VPS, atrás do Caddy, com **dois bancos de papéis opostos**:
Redis guarda a sala viva — efêmera, com TTL, morre com a mesa — e Postgres guarda o que
sobrevive a ela: contas, identidades de SSO e histórico de partidas. Confundir os dois é o
erro que o desenho existe para impedir.

Escolha deliberada: com todas as conexões de uma sala na memória do mesmo processo, o broadcast
é um laço sobre um `Set` de sockets, e o laço de eventos do Node dá atomicidade de mutação sem
lock nem compare-and-set. Some, junto, o problema de conexões WebSocket serem recicladas por
teto de duração de função.

Detalhes e contrapartidas em [`docs/11-arquitetura-e-stack.md`](docs/11-arquitetura-e-stack.md).

## Princípios

- **O servidor é a única autoridade.** O cliente é uma tela; nunca decide resultado de jogada.
- **Estado oculto nunca trafega** para quem não tem direito de vê-lo. A projeção monta a visão
  do jogador por allowlist, e há teste que falha se um `CardId` proibido aparecer em qualquer
  profundidade do objeto serializado.
- **A partida nunca fica sem saída.** Pausar por ausência é aceitável; ficar preso não é — toda
  pausa tem prazo, decisão explícita e encerramento automático.
- **Requisito sem teste que cite seu ID é requisito não entregue.**
