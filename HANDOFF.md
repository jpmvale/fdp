# Handoff

Estado do projeto para retomar depois.

**O jogo está no ar, jogável, em <https://fdp.imp-software.cloud>.**

Última sessão: 25/08/2026. Cliente React com o design Nocturne, bots, deploy
automático na VPS, CA-046 verificado em produção, rotação da chave de acesso à
máquina — e a paleta de avatares corrigida: duas cores eram a mesma sob
deuteranopia.

## Como rodar

```bash
npm install
npm run build:client   # OBRIGATÓRIO antes do primeiro `npm start`
npm run redis          # opcional, noutro terminal
npm start              # http://localhost:3000
npm test               # 268 testes
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
| `packages/bot` | Decisão dos bots — puro, só depende de `rules`. Fácil e médio |
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
- **A carta fica dentro do assento**, não solta no feltro ancorada a quem jogou.
  Ancorada ao centro cobre nomes e placar com a mesa cheia.

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
  lá, então não há disciplina a manter (CA-325).
- **Mutação de sala não pode conter `await`** (`docs/11` §5).
- **Eventos com estado oculto saem já projetados, um por destinatário.**
- **Um `commit` incrementa `stateVersion` uma vez e pode emitir vários eventos.**
- **Os testes de propriedade acharam 3 bugs** que revisão de código não pegaria.
- **O quarto bug apareceu jogando, não testando**: a sala ficava presa em
  `EM_PARTIDA` depois de uma vitória. INV-05 estava certa no documento e mal
  traduzida no código — invariante mal traduzida é pior que ausente, porque dá
  sensação de cobertura.
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

Nada obrigatório. O que sobrou é escolha, não dívida:

- **Reduzir as fronteiras de rodada** (os 16% restantes), se algum dia
  incomodarem. Custaria engordar `round:started`/`round:resolved` com quase o
  retrato inteiro, e provavelmente não vale.
- **Alertas de saturação** (CPU, memória, disco) ficaram de fora de propósito:
  numa VPS com quatro apps eles sobem por motivo legítimo e treinam a pessoa a
  ignorar notificação.
- **A mesa inteira sob daltonismo**, que CA-344 não cobre — ele valida a paleta
  de avatares isolada, não feltro contra carta contra texto de estado. Continua
  como checagem manual em `08` §5.
