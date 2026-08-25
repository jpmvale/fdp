# Handoff

Estado do projeto para retomar depois. **Próximo foco: a interface.**

Última sessão: 24/08/2026. M1 endurecido: sessão assinada, Redis, limites,
persistência e desligamento gracioso. Validado com Redis real, restart no meio de
partida e partida completa pelo protocolo.

## Como rodar

```bash
npm install
npm run redis    # opcional, noutro terminal: docker run redis:7-alpine
npm start        # http://localhost:3000
npm test         # 246 testes
npm run typecheck
```

Sem `REDIS_URL` o servidor sobe com store em memória e avisa que as salas morrem
com o processo. Com ele, sobrevivem a reinício:

```bash
FDP_SESSION_SECRET=<32+ caracteres> REDIS_URL=redis://127.0.0.1:6379 npm start
```

Para jogar sozinho: abra a URL em **2 ou 3 abas anônimas**. Numa você cria a sala,
nas outras entra com o código, e o host inicia. Recarregar a página volta ao mesmo
lugar — a sessão fica no `localStorage` por sala.

Para parar: `pkill -f "tsx server"`.

### Variáveis de ambiente

| Variável | Efeito |
|---|---|
| `FDP_SESSION_SECRET` | Segredo do JWT. **Obrigatório em produção**; em dev, gera um efêmero e avisa |
| `REDIS_URL` | Sem ela, store em memória |
| `ALLOWED_ORIGIN` | CORS e checagem de `Origin` no upgrade. Ausente = só mesma origem |
| `TRUST_PROXY=1` | Ler o IP de `X-Forwarded-For`. Ligar **só** atrás do Caddy |
| `PORT`, `FDP_VERSION` | Porta e sha exposto em `/api/health` |

## O que está pronto e é definitivo

| Pacote | O quê |
|---|---|
| `packages/rules` | Motor de regras puro e determinístico. 110 regras `RJ-###` |
| `packages/store` | `RoomStore` de 6 métodos, em memória **e em Redis**, mesma suíte de contrato |
| `packages/protocol` | Contrato cliente ↔ servidor, tipos e validação separados |
| `packages/room` | Máquina de sala: ciclo de vida, conexão, pausa, timers, auto-play |
| `server/` | HTTP de `06`, WebSocket de `05`, sessão, limites, persistência, `SIGTERM` |

Todo o comportamento do jogo e da rede está aí, testado e rastreado a critério de
aceite.

## O que ainda é provisório

| Item | Situação hoje | Precisa virar |
|---|---|---|
| `app/index.html` | HTML único, sem build, deliberadamente feio | Cliente Vite + React de `07`, com design system |
| Aplicação incremental de eventos | O cliente provisório pede snapshot a cada evento | Os redutores por evento, na camada `state/` do cliente React |
| Deploy | Nada na VPS | `deploy/Caddyfile`, `deploy/fdp.service`, README de instalação |

A **decisão** de reconciliação de `05` §3 — aplicar, descartar ou pedir resync — já
está pronta e testada em [`app/src/net/reconcile.ts`](app/src/net/reconcile.ts),
que é onde `11` §6 põe a camada de rede. O que falta é o outro lado: aplicar cada
evento ao estado local, que é o `state/` do cliente React e não existe sem ele.
O cliente provisório continua pedindo o retrato inteiro, de propósito.

## Verificado funcionando

**No navegador**

- Rodada de testa: cada aba vê as cartas dos outros e um verso no próprio lugar.
  O servidor nunca envia a carta do observador.
- Aposta proibida aparece desabilitada, com a razão escrita.
- Fechar uma aba: nada acontece por 10 s; passou disso, a mesa pausa nomeando quem
  caiu; reabrir retoma sozinho.
- Auto-play dispara para quem está conectado e não age, e é anunciado.
- Partida completa de 5 rodadas entre 3 jogadores, com vencedor correto nas 3 telas.
- **Recarregar a página volta ao mesmo lugar**, sem criar jogador novo (CA-007).

**Contra Redis de verdade**

- **CA-046**: `SIGTERM` no meio de uma partida, **842 ms** de janela, os 3 clientes
  reconectam e a partida segue em `EM_PARTIDA` — mesma rodada, mesmo `matchId`,
  mesmo jogador da vez, sem pausar uma vez.
- Restart lento (acima de `TRANSPORT_GRACE`) pausa nomeando quem caiu e retoma
  sozinho quando todos voltam. O ciclo inteiro atravessa o reinício.
- Partida completa entre 3 conexões pelo protocolo: vencedor correto, placar igual
  nas 3 telas, zero erros.
- A suíte de contrato do `RoomStore` passa igual em memória e em Redis.

## Próximo passo: a interface

O usuário vai desenhar as telas no **claude.ai/design** (ferramenta separada) e
trazer os resultados. Brief com as restrições reais:

- **Mobile-first, 360 px**, uma mão, sem rolagem horizontal. Alvos de toque ≥ 44 px.
- **Telas**: Home · Perfil · Lobby · **Mesa** · **Rodada de testa** · **Pausa** ·
  Fim de partida.
- **A tela que decide o produto é a Mesa**: mão em leque na base, adversários em
  cartões compactos com vidas, aposta e vazas no formato `2/3`, e o estado
  "condenado" de quem já não tem salvação.
- **A tela mais distintiva é a rodada de testa**: você vê a carta de todos e um
  verso no seu lugar.
- **Paleta de 8 cores de avatar** distinguíveis sob deuteranopia e protanopia.
- Cor **nunca** como único canal: todo estado precisa de ícone ou texto junto.
- Orçamento: bundle inicial ≤ 180 KB comprimido (RNF-055), verificado no CI.

Ao montar o cliente React, dois pontos já resolvidos que economizam trabalho:

- `app/src/net/reconcile.ts` decide o que fazer com cada quadro do servidor.
- `CLOSE_CODES` e `shouldReconnect` em `@fdp/protocol` dizem quando reconectar e
  quando parar de tentar.

Requisitos normativos completos em [`docs/07-requisitos-ui.md`](docs/07-requisitos-ui.md).

## Pendências fora da UI

**VPS (Hostinger).** A arquitetura de `docs/11` assume um processo Node persistente
atrás do Caddy, com Redis local. O servidor já está pronto para isso — lê segredo do
ambiente, confia em `X-Forwarded-For` sob `TRUST_PROXY`, e sai limpo no `SIGTERM`.
Para configurar, falta:

1. Host e usuário — a chave SSH está no Mac do usuário, não nesta máquina
2. Domínio apontando para a VPS (o Caddy precisa dele para o TLS automático)
3. Saída de `ssh <host> "nproc; free -h; df -h /; cat /etc/os-release | head -2"`

Depois disso: `deploy/Caddyfile`, `deploy/fdp.service` e o README de instalação.

**Vercel foi descartada** por custo do Redis gerenciado. A integração foi removida e
o projeto desvinculado — não há nada sendo cobrado.

## Decisões que valem lembrar

- **`docs/` é a fonte da verdade.** 110 regras, 139 critérios de aceite e 18
  invariantes, todos com ID estável e rastreados até o teste que os cobre. Requisito
  sem teste que cite seu ID é requisito não entregue.
- **Mutação de sala não pode conter `await`** (`docs/11` §5). A persistência é
  write-behind justamente para não quebrar isso: `schedule` marca a sala suja e
  volta na hora.
- **Eventos com estado oculto saem já projetados, um por destinatário.**
- **Um `commit` incrementa `stateVersion` uma vez e pode emitir vários eventos**,
  todos com a mesma versão. A tabela de `05` §3 pressupunha um evento por versão e
  foi corrigida — a regra literal descartaria eventos legítimos.
- **Os testes de propriedade acharam 3 bugs** que revisão de código não pegaria:
  carta de testa contada duas vezes; partida encerrada mantendo "jogador da vez"
  num jogador que saiu; e `match:started` saindo antes de existir carta.
- **O quarto bug apareceu jogando, não testando** — e é a lição desta sessão. A
  sala ficava presa em `EM_PARTIDA` depois de uma vitória, porque só as saídas
  anormais ajustavam o status; `host:rematch` era inalcançável. As 1.300 partidas
  simuladas passavam por cima disso todo dia: INV-05 está certo no `03` §5 —
  "partida **ativa**" — mas a verificação no código só olhava se *havia* partida.
  Invariante mal traduzida é pior que invariante ausente, porque dá a sensação de
  cobertura. Apertada, ela agora cobra isso a cada rodada simulada.
- **Licença MIT** foi escolha minha, não do usuário. Trocar se ele preferir.
