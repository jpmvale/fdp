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
| Deploy | Artefatos prontos em `deploy/`, **não executados** | Rodar o roteiro de `deploy/README.md` na VPS |

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

O brief usado está em [`BRIEF-DESIGN.md`](BRIEF-DESIGN.md). **O design já foi
feito** — ver a seção seguinte.

Requisitos normativos completos em [`docs/07-requisitos-ui.md`](docs/07-requisitos-ui.md).

## O design (revisão parcial — 25/08/2026)

Artifact: <https://claude.ai/code/artifact/1f515ea6-794a-43c5-8a49-8964bf5f4407>

Canvas único, tema escuro azul-marinho, design system batizado de **"Nocturne"**.
As duas decisões que o brief deixou em aberto foram resolvidas como recomendado:
escuro, e interface sóbria contrastando com o nome ("o deboche fica por conta dos
jogadores").

**O título do artifact está errado: "Poker site elegante e moderno".** O conteúdo
é o FDP; só o nome ficou de outro trabalho. Vale renomear antes de compartilhar
com alguém.

### Entregue

As 8 telas do brief, todas presentes. Atenção: Home, Perfil e Lobby estão
agrupados **dentro da seção 5**, não como seção própria — ler só os cabeçalhos
dá a impressão errada de que faltam.

| Seção | Estados |
|---|---|
| 1. Fundamentos | tokens, paleta de 8 avatares, componentes |
| 2. Mesa | apostas · meio de vaza · resolução da rodada |
| 3. Rodada de testa | apostando às cegas · revelação |
| 4. Partida pausada | antes da decisão · visão do host · visão de quem não é host |
| 5. Fim de partida | + Lobby (host e host sozinho), Home, Perfil |
| 6. Estados de conexão | os 5 de `07` §2.6 |

### O que eu verifiquei e está certo

- **RF-035 — a própria carta não vaza.** Conferi o HTML do bloco do jogador na
  rodada de testa: é um verso puro com `?`, sem valor em atributo, sem elemento
  escondido por CSS, sem `data-*`. O erro mais fácil de cometer não foi cometido.
- **RF-030 a RF-034**: cartas dos outros de face para cima, texto explícito
  ("você não vê a sua carta — todos os outros veem"), botões **Ganho**/**Perco**
  em vez de 1/0, e na revelação a carta vira antes de o resultado aparecer.
- **Aposta proibida** desabilitada, marcada `PROIBIDO`, com a razão escrita ao
  lado. Ninguém descobre a regra errando.
- **`2/1`** (vazas contra aposta), **vidas como ♥ repetido**, e o estado
  condenado como **"☠ JÁ ERA — CAI NESTA RODADA"**.
- **Débito de vidas com a conta à vista**: "apostou 2 · fez 1 → errou por 1".
- **Auto-play anunciado**; **eliminação** com destaque próprio.
- **Pausa**: nomeia quem caiu, mesa visível atrás, nenhum botão antes de a
  decisão liberar, botões dizendo a consequência, contagem de 3 s ao retomar, e
  a visão de quem não é host (RF-044) — que eu nem tinha pedido explicitamente.
- **Fim de partida**: a vitória de RJ-005 explicada em texto, e quem abandonou
  abaixo de todos (RJ-129).
- **Paleta** entregue com tabela de três colunas: visão normal, deuteranopia e
  protanopia.

### Problemas encontrados — conferidos contra `docs/`

**1. Trunfo não existe no FDP.** A tela da Mesa mostra `NAIPE DA VAZA ♦ · TRUNFO
♠`. Não há uma única menção a trunfo ou manilha em `docs/`. Foi importado do
Fodinha/Truco por hábito.

**2. "Naipe da vaza" contradiz RJ-023**, que é explícito: "Não existe obrigação
de seguir naipe. Qualquer carta da mão é sempre jogável." Pior: a **mesma tela**
diz "toda carta é jogável" logo abaixo. As duas coisas não podem estar certas.

**3. ~~Chat de mesa~~ — NÃO é problema. O chat entra na v1.** Decisão do dono do
produto em 25/08/2026. Eu tinha marcado como fora de escopo porque `docs/00`
§4.2 lista "chat de texto ou voz" entre o que não entra na v1, com razão
registrada, e a tabela de riscos tem a linha "escopo inflar com chat/ranking →
não entrega a v1". A decisão reverte isso: o chat fica na Mesa, na rodada de
testa, na pausa e no lobby, como o design já desenhou.

**`docs/00` §4.2 ainda diz o contrário e precisa ser atualizado** — `docs/` é a
fonte da verdade deste projeto, então enquanto ele não mudar existe uma
contradição registrada. Mexer nele significa tirar o chat da lista de exclusões,
criar o RF do chat em §4.1 e rever aquela linha da tabela de riscos. Não fiz
sozinho: é documento normativo.

Sobram dois erros de brief, não do design: `BRIEF-DESIGN.md` não dizia que não há
trunfo nem citava RJ-023. Isso já está corrigido.

### O que eu NÃO verifiquei

A revisão parou no meio. Ficou de fora:

- **A afirmação de ΔE 21,8.** O design diz que a menor distância perceptual entre
  dois avatares é ΔE 21,8 **nas três condições ao mesmo tempo**, por simulação
  Viénot 1999, e que todas passam de 5,4:1 contra o feltro. Eu ia recalcular e
  não cheguei a rodar. **Trate como não verificado** — é justamente o tipo de
  número que soa autoritativo e passa sem conferência. Os 8 valores de "visão
  normal" estão na seção 1 do canvas.
- **Contraste de texto (RNF-030)** nas telas, medido de verdade.
- **Comportamento em 360 px reais**: o canvas é uma página larga com as telas
  lado a lado; ninguém abriu isso num viewport de 360.
- Alvos de toque medidos (o canvas *afirma* 44×44 e cartas de 48×68).

### Próximo passo sugerido

1. Renomear o artifact.
2. ~~Corrigir `BRIEF-DESIGN.md`~~ — **feito em 25/08/2026**: o brief agora tem a
   seção "O que o FDP **não** tem" (sem trunfo, naipe sem efeito por RJ-022, sem
   seguir naipe por RJ-023) e a lista do que está fora de escopo na v1
   (`docs/00` §4.2), mais dois itens em "O que não fazer".
3. Pedir a correção das telas afetadas — só trunfo e naipe da vaza; o chat fica.
   Decidir o que fazer com `docs/00` §4.2, que ainda proíbe o chat.
4. Retomar a verificação: ΔE, contraste e 360 px.

## Pendências fora da UI

**VPS (Hostinger) — no ar desde 25/08/2026, faltando só o DNS.**

A máquina não era o que o roteiro antigo supunha: `srv1876937` já hospeda coda,
kindred e expense-analyzer, com **Caddy em container** segurando 80/443. O
roteiro bare-metal (apt Caddy, systemd, ufw) teria disputado a porta com o proxy
dos outros três apps. Foi descartado; o FDP seguiu a convenção da máquina.

Estado hoje: `fdp-api` e `fdp-redis` rodando e saudáveis, sem publicar porta;
bloco `fdp.imp-software.cloud` no Caddyfile compartilhado, validado e recarregado
(os outros três sites seguem respondendo 200); sonda de observabilidade no cron.

**O que falta é uma coisa só, e é sua: criar o registro A de
`fdp.imp-software.cloud` apontando para 187.77.242.128.** Hoje dá NXDOMAIN, então
o Let's Encrypt não emite o certificado e o site não abre. Assim que o DNS
propagar, o Caddy emite sozinho — nada a rodar do nosso lado.

Depois disso, falta verificar **CA-046 pelo domínio** (três abas, `docker restart
fdp-api`, a partida continua), registrar o app em `~/bin/deploy.sh` com workflow
no GitHub Actions, e escrever as regras de alerta no Grafana. Detalhes em
[`deploy/README.md`](deploy/README.md).

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
