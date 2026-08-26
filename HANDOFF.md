# Handoff

Estado do projeto para retomar depois.

**O jogo está no ar, jogável, em <https://fdp.imp-software.cloud>.**

Última sessão: 25/08/2026. Cliente React com o design Nocturne, bots, deploy
automático na VPS, CA-046 verificado em produção, rotação da chave de acesso à
máquina, paleta de avatares corrigida — e uma leva de ajustes de mesa: a vaza
acontece no centro, o vencedor fica visível antes de a mesa limpar, balões
saem do jogador, e o fim de partida virou um resumo com nota de desempenho.

## Como rodar

```bash
npm install
npm run build:client   # OBRIGATÓRIO antes do primeiro `npm start`
npm run redis          # opcional, noutro terminal
npm start              # http://localhost:3000
npm test               # 302 testes
npm run typecheck
```

**A armadilha nova:** o servidor serve o cliente de `app/build/`, que é gerado
pelo Vite e não vive no git. Sem `npm run build:client`, `npm start` sobe e a
raiz devolve 500 sem causa aparente no log. O CI roda esse passo antes dos
testes pelo mesmo motivo — a suíte de HTTP lê o `index.html` de lá.

Para mexer na interface com recarga automática, `npm run dev:client` em paralelo
com `npm start`: o Vite serve a UI em 5173 e repassa `/api` para o processo real.

Para jogar sozinho, o caminho curto é **sentar bots pelo lobby**. Para exercitar
várias conexões de verdade, 2 ou 3 abas anônimas.

Para parar: `pkill -f "tsx server"`.

### Variáveis de ambiente

| Variável | Efeito |
|---|---|
| `FDP_SESSION_SECRET` | Segredo do JWT. **Obrigatório em produção**; em dev, gera um efêmero e avisa |
| `REDIS_URL` | Sem ela, store em memória |
| `ALLOWED_ORIGIN` | CORS e checagem de `Origin` no upgrade. Ausente = só mesma origem |
| `TRUST_PROXY=1` | Ler o IP de `X-Forwarded-For`. Ligar **só** atrás do Caddy |
| `PORT`, `FDP_VERSION` | Porta e sha exposto em `/api/health` |

## O que está pronto

| Pacote | O quê |
|---|---|
| `packages/rules` | Motor de regras puro e determinístico. 110 regras `RJ-###` |
| `packages/bot` | Decisão dos bots — puro, só depende de `rules`. As quatro dificuldades |
| `packages/store` | `RoomStore` de 6 métodos, em memória **e em Redis**, mesma suíte de contrato |
| `packages/protocol` | Contrato cliente ↔ servidor, tipos e validação separados |
| `packages/room` | Máquina de sala: ciclo de vida, conexão, pausa, timers, auto-play, bots |
| `server/` | HTTP de `06`, WebSocket de `05`, sessão, limites, persistência, `SIGTERM` |
| `app/` | Cliente Vite + React com o design system Nocturne |

Chat (RF-017) implementado contra CA-330 a CA-341, incluindo a garantia que
protege a mecânica: `EV-040` sai idêntico para todos, com exatamente cinco
campos e nada derivado da partida (CA-338).

## O que ainda é provisório

Nada estrutural. O que segue é o único ponto onde o cliente não é completo, e é
por escolha.

Os **redutores por evento** de `11` §6 estão em
[`app/src/state/redutores.ts`](app/src/state/redutores.ts), ligados ao
reconciliador de `05` §3 que já existia. Cada redutor devolve o estado novo ou
`null` — "não sei montar isto" —, e `null` termina onde tudo terminava antes:
pedindo o retrato. **84% dos eventos reduzidos** numa partida completa (CA-342).

Os 16% que sobram são as fronteiras de rodada e de partida. Reconstruí-las
exigiria carregar no evento praticamente o retrato inteiro — a essa altura,
pedir o retrato é mais honesto que fingir que não se está pedindo.

## Verificado funcionando

**No navegador, em 360 px**

- Fluxo inteiro: home → perfil → lobby → partida → fim → sair.
- Rodada de testa: cada um vê as cartas dos outros e um verso no próprio lugar.
  Conferido no DOM vivo — sem valor em atributo, sem nó escondido, sem `data-*`.
- Aposta proibida desabilitada, marcada, com a razão escrita ao lado.
- Nada rola na horizontal, nenhum assento colide com a mesa cheia, nenhum alvo
  de toque abaixo de 44×44.
- Modal de sessão em outra aba exercitado abrindo a segunda aba de verdade; o
  "Jogar aqui" traz a mesa de volta.
- Log da partida sobrevive a recarregar a página no meio da rodada — ele é
  montado do retrato do servidor, não de eventos acumulados no cliente.

**Contra Redis de verdade**

- Partida completa entre 3 conexões pelo protocolo, com vencedor correto.
- A suíte de contrato do `RoomStore` passa igual em memória e em Redis.

**CA-046 em produção (25/08/2026)** — três conexões reais em
`fdp.imp-software.cloud`, `docker restart fdp-api` no meio da rodada 2:

| Medida | Resultado |
|---|---|
| Janela de indisponibilidade | 1.904 ms |
| Reconexão de cada cliente | 607–635 ms |
| `matchId` e rodada | iguais antes e depois |
| Status | `EM_PARTIDA` o tempo todo, nunca `PAUSADA` |

Não podia nem chegar a pausar: `TRANSPORT_GRACE` é 10 s e ninguém ficou fora
mais de 635 ms.

## A mesa, depois dos ajustes de 25/08/2026

Cinco mudanças pedidas pelo usuário. **As três primeiras eram requisitos de
`07` que nunca tinham sido implementados**, não funcionalidades novas — e a
primeira não era cosmética.

### `RECOLHIMENTO`: uma fase nova no motor

O motor fechava a vaza e abria a seguinte **no mesmo passo**. Não existia
instante nenhum em que a mesa mostrasse quem levou. `07` §2.4 sempre pediu de
1,5 a 3 s com a carta vencedora à vista.

Fazer isso no cliente seria mentira: com a vaza seguinte já aberta no servidor,
um bot joga em 900 ms e a tela mostraria uma disputa encerrada. Virou fase
automática de verdade (`03` §4.2), de 1,8 s — 1,5 s parado mais 300 ms de
viagem das cartas até o vencedor.

Detalhes que valem lembrar:

- **A vaza fechada vive só em `resolvedTricks`.** Deixá-la também em
  `currentTrick`, para o cliente ter onde ler, contaria as cartas duas vezes e
  quebraria INV-03.
- **A última vaza da rodada também passa por aqui.** Ia direto ao acerto de
  contas e era a única do jogo cujo resultado ninguém via.
- **A rodada de testa fica de fora**: lá as cartas estão nas testas, não na
  mesa, e quem mostra o resultado é `REVELACAO`.
- Cobrado por CA-346 e CA-347. Sem o prazo no relógio da sala, o próximo
  despertar da mesa cai em `ROOM_MAX_LIFE` e a partida fica parada **quatro
  horas** — o teste mede isso.

### As cartas no centro, e o limite que as tinha afastado de lá

O código prendia a carta ao assento com um comentário dizendo que o centro
cobre nomes e placar com 8 jogadores. **Medi: estava certo** — duas cartas
invadiam os assentos laterais.

A saída não foi desistir do centro. O contador da rodada subiu para o
cabeçalho, a vaza ficou confinada à faixa entre os assentos (`67% − 104px`,
~137 px em 360), e a carta encolhe para `mini` quando passa de 4 na mesa.
Remedido com 8: **zero colisões, sem rolagem horizontal**.

O destaque de quem está ganhando usa `trickStanding`, **a mesma função do
motor** — reimplementá-la no cliente seria pedir para as duas divergirem no
empate em cascata de `EMPATE_ANULA_CARTAS`, que é o caso mais difícil de
perceber.

### Vocabulário: a tela diz "mão"

O que `docs/` chama de **vaza**, a interface chama de **"mão"**. E o que era "a
mão do jogador" virou **"suas cartas"** — a palavra foi ocupada pela disputa, e
sem essa segunda troca a mesma tela usaria o mesmo nome para duas coisas.

`docs/` e o código seguem em "vaza", registrado em `01` e `07`. São 110 regras
`RJ-###` com ID estável mais `Trick`/`tricksWon`/`trickNumber` em quatro
pacotes; renomear a espinha do projeto não mudaria nada que o jogador vê.

### Balões, log de vidas e o resumo do fim

- **Balões saem do assento** de quem falou no chat ou perdeu vida, e os
  corações debitados caem do próprio contador. O débito de vida não tinha sinal
  nenhum antes — o número mudava sozinho, no momento de maior carga da partida.
- **Log de vidas perdidas** embaixo do chat, por rodada, saindo de `history`:
  sobrevive a recarregar a página.
- **Fim de partida** com aposta contra mãos feitas, quem saiu em cada rodada, e
  **nota de desempenho de 0 a 10**.

### A nota de desempenho (`app/src/desempenho.ts`)

Responde outra pergunta que não o placar: **quem jogou melhor**. Pontaria 45%,
acertos em cheio 30%, sobrevivência 25%. Vencer garante o piso da faixa
excelente.

**O piso é 8, e não 9, por medição e não por gosto.** Com 9, o cenário que
motivou a nota — o segundo colocado que acerta tudo e desaba na última rodada —
chega a 8,1 e nunca passaria do vencedor mais sofrível. O piso precisa caber
dentro do alcance de quem jogou bem e perdeu, senão "vencer não garante a maior
nota" vira letra morta. A fronteira da faixa excelente acompanha o piso.

Rodada abortada não entra na conta de ninguém, nem no numerador nem no
denominador (RJ-155). As quatro cores da nota têm teste de contraste, e cada
faixa carrega a palavra junto — cor nunca é o único canal (RNF-031).

## Identidade na mesa (26/08/2026)

Apelido, emoji e **cor** são únicos dentro da sala — `04` §2 exigia só que o *par*
`(emoji, cor)` fosse único, e não bastava: a cor é o canal principal de identificação
(`07` §4), e dois jogadores de cor igual já são parecidos demais a 360 px.

A regra morava em **três lugares com três implementações** — entrada pelo HTTP, criação de
bot, e nenhuma na edição de perfil. A que faltava era a que valia: bastava abrir o perfil no
lobby para a mesa ter dois "Ana" da mesma cor. Agora é uma só, em
[`packages/room/src/identidade.ts`](packages/room/src/identidade.ts), e a garantia é da
**sala** — não da fronteira HTTP, que é por onde ela escapava.

Os dois caminhos tratam colisão de formas diferentes, de propósito: a **entrada** desempata
sozinha e deixa entrar (CA-006 — quem chegou depois não escolheu colidir), a **edição** recusa
com motivo (a escolha é deliberada e a tela mostra o que está tomado). Cobrado por CA-374 e
CA-375.

A conta fecha: 8 cores para 8 assentos, 24 emojis para no máximo 12 pessoas. Com mais gente
que cor — jogadores mais espectadores —, a cor repete e o emoji único é o que ainda garante o
par de `04` §2.

## Deploy

**Automático.** Push na `main` → CI → imagem no GHCR → `~/bin/deploy.sh fdp <sha>`
na VPS por SSH. O `deploy.sh` é compartilhado com coda, kindred e
expense-analyzer: põe o repositório no mesmo commit da imagem, confere que os
containers rodam a tag pedida, verifica pela URL pública e **reverte sozinho** se
falhar.

A VPS **não é uma máquina vazia** — hospeda outros três apps, com Caddy em
container segurando 80/443 e Grafana Alloy coletando. Detalhes, incluindo a
observabilidade e o que ainda falta nela, em [`deploy/README.md`](deploy/README.md).

## O design

Canvas do Claude Design, tema escuro, design system **Nocturne**, com a paleta
já corrigida: <https://claude.ai/code/artifact/f5dffc3b-96b6-405d-a8aa-bca500cf6ddb>

A fonte editável vive em [`design/Main.dc.html`](design/Main.dc.html) — é dela
que sai qualquer atualização do canvas. Para republicar, semeie e publique pelo
`/design`; o arquivo gerado é saída de build e está no `.gitignore`.

**Dois links antigos continuam circulando e nenhum dos dois se atualiza daqui**,
porque são renders estáticos e não canvas editáveis:
`555d5b00-…` (original, de outra conta) e `1f515ea6-…` (cópia publicada, ainda
com a paleta velha e com o título errado, "Poker site elegante e moderno").
Use o link de cima.

**A interface implementada é fiel ao canvas**, com duas divergências
deliberadas, ambas comentadas no código:

- **Os assentos não seguem ângulo em elipse.** Com 8 jogadores os cartões se
  atropelam e vazam dos 360 px, e nenhum ajuste de raio resolve — o limite é
  largura de cartão contra largura de tela. Vale o arranjo do design: até 3 em
  cima, o resto nas laterais, você na base.
- **A carta de testa fica no assento; a carta jogada, no centro.** O canvas
  desenha as duas na mesa. A de testa está na cabeça da pessoa, e é do assento
  que ela fala; na revelação ela também vai para o centro, e o assento esvazia.

**Três erros do design, conferidos contra `docs/` e NÃO implementados:** trunfo
(não existe no FDP), "naipe da vaza" (RJ-022: naipe não tem efeito algum) e —
este sim implementado, por decisão posterior — o chat. Os dois primeiros eram
falha do meu brief, que já foi corrigido.

### O quarto erro: a paleta de avatares (corrigido em 25/08/2026)

O canvas afirmava que a menor distância entre dois avatares era **ΔE 21,8 nas
três condições**, por simulação Viénot 1999. Recalculando: a simulação de
**protanopia** batia com a minha até a terceira casa, a de **deuteranopia** não
batia de jeito nenhum. Quando duas condições usam o mesmo método e só uma
diverge, o erro está na que diverge — e as saídas dela eram fisicamente
implausíveis (`teal` virando roxo, `lime` virando cinza-terroso; sob
deuteranopia verde e vermelho convergem para amarelo).

O valor real era **ΔE2000 2,0** entre `lime` e `orange` sob deuteranopia: a
mesma cor. A paleta tinha sido otimizada contra uma simulação com bug, então a
otimização não entregou o que anunciava. O `21,8` também era ΔE76, não
CIEDE2000 — ΔE76 exagera diferença exatamente nos amarelos e azuis saturados
onde uma paleta de avatares vive.

`lime` passou de `#4ebf00` para `#6cd317`: mínimo de 2,0 → **7,5**, com desvio
visual de ΔE 5,7 (continua claramente verde). Reotimizar as oito chegaria a
10,9, mas moveria cinco cores e transformaria o `lime` num sálvia que não é mais
lime — não valia a identidade visual.

A afirmação de contraste ("todas passam de 5,4:1") também era falsa: seis das
oito ficam abaixo disso contra o feltro claro. Mas RNF-030 pede **3:1** para
elemento gráfico e todas passam — o requisito estava cumprido, era o número
auto-declarado que estava errado. O canvas agora traz os dois números certos.

**Por que isso não virou defeito visível:** `Avatar.tsx` sempre renderiza cor
**e** emoji. O segundo canal de RNF-031 segurou a mesa — e escondeu o erro.

## Decisões que valem lembrar

- **`docs/` é a fonte da verdade.** Requisito sem teste que cite seu ID é
  requisito não entregue.
- **Chat e bots entraram no escopo depois** (P9 e P10 em `docs/00` §5),
  revertendo exclusões da v1. A decisão está registrada no documento, não só no
  código.
- **O bot não pode trapacear por construção**: `packages/bot` recebe a mesma
  `PlayerView` que um humano. A informação que ele não deve ver não chega até
  lá, então não há disciplina a manter (CA-325). O que separa um nível do outro
  não é acesso a informação, é **quanto do que está à vista ele usa** —
  `leitura.ts` é a camada onde isso mora.
- **A escada de dificuldade é medida em torneio, não afirmada** (CA-348). A
  primeira versão do realista PERDIA do difícil, e foi o torneio que pegou: ele
  comparava a soma parcial das apostas contra a rodada inteira, e quem apostava
  cedo enxergava uma mesa vazia.
- **Mutação de sala não pode conter `await`** (`docs/11` §5).
- **Eventos com estado oculto saem já projetados, um por destinatário.**
- **Um `commit` incrementa `stateVersion` uma vez e pode emitir vários eventos.**
- **Os testes de propriedade acharam 3 bugs** que revisão de código não pegaria.
- **O quarto bug apareceu jogando, não testando**: a sala ficava presa em
  `EM_PARTIDA` depois de uma vitória. INV-05 estava certa no documento e mal
  traduzida no código — invariante mal traduzida é pior que ausente, porque dá
  sensação de cobertura.
- **Instrumento estrangulado parece defeito de código.** Passei um bom tempo
  concluindo que a animação de recolher não disparava, porque o navegador
  automatizado me dava 6 amostras em 26 segundos — a janela de 300 ms sumia
  entre duas leituras. O código estava certo desde o começo. Quando a medição
  discordar do raciocínio, **desconfie da medição primeiro**: a pista aqui era
  a taxa de amostragem absurda, visível o tempo todo e ignorada.
- **Cronômetro de cliente não sabe quando a fase começou.** A primeira versão
  da viagem das cartas contava a partir de quando o cliente via a mudança de
  fase — e erra por latência, pela granularidade de 250 ms do relógio da sala,
  e por qualquer resync no meio. O certo é contar **de trás para frente a
  partir de `phaseDeadline`**, que é o instante exato em que o servidor vai
  agir. Virou `esperaAteViajar`, com teste.
- **Número tranquilizador é onde a verificação para.** A checagem de daltonismo
  da paleta foi feita de verdade, e errada, e passou por dois agentes e uma
  revisão porque vinha com um `ΔE 21,8` do lado. Ninguém confere um número que
  já parece bom — e `08` §5 a tratava como checagem manual, que é a que só roda
  quando alguém lembra. Virou CA-344, com duas aferições da própria simulação:
  cinza não pode mudar sob dicromacia, e vermelho contra verde **precisa**
  colapsar sob deuteranopia. Sem elas, uma simulação quebrada aprova a paleta
  por acidente — que foi exatamente o que aconteceu.
- **Duas listas enumeradas envelheceram em silêncio nesta sessão**, ambas
  derrubando produção: o `Dockerfile` copiava `app/build` do contexto (funcionava
  na minha máquina, imagem sem cliente num checkout limpo) e enumerava os
  pacotes do workspace um a um (quebrou ao entrar o `@fdp/bot`). Lista enumerada
  de coisa que cresce envelhece sempre; a única questão é quando.
- **Saída de compilação dentro de `src/` faz a suíte rodar contra código velho,
  em silêncio.** Os imports são `'./room.js'` (convenção ESM do TypeScript), e
  com um `.js` de verdade ao lado do `.ts` o Vite resolve o COMPILADO. Havia 34
  desses arquivos, commitados sem ninguém notar, e por uma hora eu depurei um
  bug que não existia — o código estava certo e não era ele que rodava. Agora há
  trava no CI e no `.gitignore`. A pista que denuncia: uma alteração no fonte
  não muda o comportamento do teste, e um `console.log` no meio da função não
  imprime.
- **Licença MIT** foi escolha minha, não do usuário. Trocar se ele preferir.

## Segurança — incidente de 25/08/2026

A chave pessoal de acesso à VPS (`id_ed25519_vps`, com shell como `deploy` **e
como root**) foi colada num segredo do GitHub Actions de um repositório público.
Segredo de CI é lido por qualquer execução do workflow.

**Resolvido**: a chave foi rotacionada nas duas contas e não abre mais nada; no
lugar dela, `id_vps_2026` para acesso pessoal e uma chave dedicada
(`github-actions-fdp`) presa ao `deploy.sh` por forced command.

A lição operacional: `cat >> authorized_keys` é a forma frágil de acrescentar
chave. O arquivo do root não terminava em quebra de linha, e a chave nova foi
colada no fim da linha da antiga — o OpenSSH leu tudo como comentário, a antiga
continuou valendo e a nova era ignorada. Se a antiga tivesse sido removida
naquele momento, o acesso root estaria perdido. A forma robusta:

```bash
printf "\n%s\n" "$(cat chave.pub)" >> ~/.ssh/authorized_keys
```

## O que fazer a seguir

**[Plano 01 — Contas, perfis e histórico](docs/plans/01-contas-perfis-e-historico.md)**, status
`PROPOSTO`. Cinco fases com gate de saída; F1→F3 sequenciais, F4 depende de F1+F2, F5 depende
de F2. A primeira coisa é a emenda **P11** em `00` §5 — nada do plano vale antes dela.

As duas correções que estavam anotadas aqui **já foram aplicadas ao plano** (26/08/2026):

- A checagem de `PROTOCOL_VERSION` **existe** — `validate.ts` recusa `v` diferente, `ws.ts`
  emite, e há teste de integração em `server/test/ws.test.ts`. O plano afirmava o contrário e
  mandava implementá-la como primeira tarefa da F2; §5 agora traz a correção e diz de onde veio
  o engano (a busca original passou ao lado de `protocol/src/validate.ts`). Subir para a versão
  2 já faz o cliente velho pedir recarregar, e CA-373 é um teste que só precisa seguir verde.
- A pendência de apelido duplicado virou **§5.1 do plano**, com sete regras, RF-072/RF-073 e
  CA-376 a CA-379, dentro da F2.

Reserva de IDs, para não colidir de novo: `CA-363` a `CA-373` e `CA-376+` são do plano; 374 e
375 foram para a unicidade de identidade na mesa. `RF-060+` e `RNF-105+` estão livres.

O resto continua sendo escolha, não dívida:

- **Reduzir as fronteiras de rodada** (os 16% restantes), se algum dia
  incomodarem. Custaria engordar `round:started`/`round:resolved` com quase o
  retrato inteiro, e provavelmente não vale.
- **Alertas de saturação** (CPU, memória, disco) ficaram de fora de propósito:
  numa VPS com quatro apps eles sobem por motivo legítimo e treinam a pessoa a
  ignorar notificação.
- **A mesa inteira sob daltonismo**, que CA-344 não cobre — ele valida a paleta
  de avatares isolada, não feltro contra carta contra texto de estado. Continua
  como checagem manual em `08` §5.

## Postgres e o pacote `@fdp/contas` (26/08/2026)

F1 do [plano 01](docs/plans/01-contas-perfis-e-historico.md). São **dois** bancos agora, com
papéis opostos: Redis guarda sala viva (efêmera, TTL, morre com a mesa), Postgres guarda o que
sobrevive a ela (contas, credenciais, identidades de SSO, histórico). Confundir os dois é o erro
tentador, e `11` §4 explica por quê.

O acesso fica atrás da interface `Dados`, com duas implementações e **uma** suíte de contrato —
mesma ideia do `RoomStore`. Ela já provou o valor na primeira execução: o esquema dependia de
`citext`, o que passava em memória e quebrava no Postgres, e teria quebrado de novo em qualquer
Postgres gerenciado, onde `CREATE EXTENSION` pede superusuário. Virou índice único sobre
`lower(email)` — mesma garantia, do lado do banco.

O CI sobe os dois serviços e **falha se qualquer uma das suítes for pulada**. Pular é o pior
resultado possível: verde sem ter testado.

Para rodar a suíte do Postgres na mão:

```bash
docker run -d --rm --name fdp-postgres -p 5433:5432 -e POSTGRES_PASSWORD=fdp postgres:17-alpine
DATABASE_URL='postgres://postgres:fdp@127.0.0.1:5433/postgres' npm test
```

**Backup.** `deploy/backup-postgres.sh` e `deploy/restaurar-postgres.sh`. A restauração recusa
destino que já tenha a tabela `contas` — `--clean` sobre a base errada apaga o que estava lá, e
a hora de descobrir isso não é durante um incidente. O ciclo foi exercitado de verdade em
26/08/2026: banco semeado, dump, restauração num banco vazio, contagens idênticas nas cinco
tabelas, e a aplicação lendo o restaurado. Backup que nunca foi restaurado não é backup.

**Ainda não está na VPS.** O container, o cron do backup e o alerta no Grafana ficam para quando
a F2 precisar do banco de pé.
