# FDP

Jogo de cartas de **vazas, aposta e blefe** para 2 a 8 pessoas, jogado no navegador — cada uma
no seu próprio dispositivo, conectadas por uma sala com código de convite.

Você declara quantas vazas vai ganhar e perde vidas ao errar. Uma regra estrutural impede que a
soma das apostas da mesa feche com o número de vazas disponíveis: **alguém sempre se dá mal**.
E na rodada de 1 carta você aposta sem ver a própria carta — ela fica na sua testa, à vista de
todos os outros.

Da família do **Fodinha** brasileiro, parente do Oh Hell.

## Estado

Em desenvolvimento. O jogo ainda não é jogável.

| Fase | O quê | Status |
|---|---|---|
| M0 | Especificação completa | ✅ |
| M1 | Servidor, sala, WebSocket, persistência | 🚧 jogável local; falta Redis e deploy |
| M2 | Lobby jogável | ⬜ |
| M3 | Partida | ⬜ |
| M4 | Endurecimento e entrega | ⬜ |

```
packages/rules/      ✅  motor de regras — puro e determinístico
packages/store/      ✅  RoomStore: interface + memória (Redis pendente)
packages/protocol/   ✅  contrato cliente ↔ servidor + validação
packages/room/       ✅  máquina de sala, timers, pausa, auto-play
server/              🚧  Hono + WebSocket — funcional, sem sessão assinada
app/                 🚧  casca HTML para validar mecânicas; UI real vem depois
```

## Como se joga

Cada rodada tem um número de cartas, que cresce de 1 até o teto e volta a 1. Você aposta
quantas vazas vai ganhar, depois joga. Errou a aposta? Perde uma vida por vaza de diferença.
Zerou as vidas, está fora. Último de pé vence.

A pegadinha: **a soma das apostas da mesa nunca pode bater com o número de vazas**. O último a
apostar é obrigado a estragar a conta de alguém.

Regras completas e normativas em [`docs/02-regras-do-jogo.md`](docs/02-regras-do-jogo.md).

## Documentação

O diretório [`docs/`](docs/) é a **fonte da verdade** do projeto — 14 documentos com 110 regras
de jogo, 139 critérios de aceite testáveis e 18 invariantes de estado, todos com identificador
estável e rastreados até o teste que os cobre.

Comece pelo [índice](docs/README.md).

## Desenvolvimento

Requer Node 24+.

```bash
npm install
npm start         # http://localhost:3000 — abra em 2-3 abas anônimas
npm test          # 137 testes
npm run typecheck
```

Já dá para jogar uma partida completa local. O cliente atual é uma casca sem build,
deliberadamente feia: existe para validar as mecânicas no navegador antes de investir
em design. Ver [HANDOFF.md](HANDOFF.md).

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

## Arquitetura

Um processo Node persistente numa VPS, atrás do Caddy, com Redis local para persistência.

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
