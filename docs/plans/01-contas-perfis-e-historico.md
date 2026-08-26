# Plano 01 — Contas, perfis e histórico de partidas

Status: **EM EXECUÇÃO** · Aberto em 26/08/2026 · P11 emendada em 26/08/2026

Fases: **F1 e F2 concluídas** (26/08/2026) · F3 a F5 não começaram.

Cria contas (SSO e e-mail/senha), perfil público de jogador, histórico persistente de
partidas e avatar por imagem.

---

## 1. O que este plano reverte

`00` §4.2 lista, em "fora do escopo da v1", exatamente isto:

> Contas, login, senha, OAuth ou perfil persistente entre sessões.

A reversão é deliberada e segue o mesmo caminho do chat (decisão P9) e dos bots (P10): a
linha sai de §4.2, entra a decisão **P11** em `00` §5, e os requisitos novos passam a viver em
`07` como qualquer outro.

**Feito em 26/08/2026.** §4.2 traz a linha riscada com a data, e P11 está na tabela de decisões.
A exclusão que sobrevive é a que importa: nada do jogo pode **exigir** conta.

`00` §4.3 já previa a porta: *"persistência de histórico de partidas"* estava na lista do que
não entra na v1 mas **não pode ser impossibilitado** pelo desenho de dados. É essa porta que
se abre agora.

**Continua fora**, e este plano não é desculpa para nenhum: ranking global, conquistas,
progressão, moeda, cosméticos, matchmaking público, busca de jogadores.

---

## 2. Três coisas que não podem quebrar

Estas não são preferências. São o que o produto é, e qualquer decisão deste plano que as
contrarie está errada.

| # | Invariante | Por quê |
|---|---|---|
| I-1 | **Jogar sem conta continua funcionando, inteiro.** Entrar por link, jogar, ver o fim de partida — nada disso pede conta. | Está escrito na tela do lobby: *"Quem receber o link entra direto — sem conta, sem instalar nada."* É a promessa central. Conta é acréscimo opcional, nunca pedágio. |
| I-2 | **O motor de regras não é tocado.** `@fdp/rules` não aprende o que é conta. | Ele é determinístico, tem 110 regras `RJ-###` e um teste de propriedade de mil partidas. Toda a projeção, `checkNoLeak` e os invariantes giram em torno de `playerId` opaco. Conta entra pela borda, na sala, nunca no motor. |
| I-3 | **RNF-055 continua valendo**: 180 KB comprimidos no cliente. | Nenhum SDK de OAuth, nenhuma biblioteca de imagem no cliente. Os dois fluxos são de servidor. |

---

## 3. Decisões já tomadas

| # | Decisão | Consequência |
|---|---|---|
| D-1 | **Postgres na mesma VPS**, em container, escutando só em `127.0.0.1` | Infra nova para operar: backup, monitoramento e um alerta no Grafana. O Redis continua exatamente como está — sala viva, TTL, write-behind (`11` §4). São dois bancos com dois papéis, e nenhum invade o do outro. |
| D-2 | **SSO com Google e GitHub** | Dois fluxos OAuth. Apple e Discord ficam fora; a tabela de identidades já nasce preparada para um terceiro provedor sem migração. |
| D-3 | **SSO assume a conta e derruba a senha** quando o e-mail bate | Ver §7. Tem um efeito colateral que precisa de tratamento explícito na tela. |
| D-4 | **Perfil público por link**, sem listagem nem busca | Perfil acessível por URL de quem tem o endereço. Ninguém é encontrável por apelido. |
| D-5 | **Sem confirmação de e-mail, por ora** | Ver §8. É a decisão com a consequência mais séria deste plano, e não é a que parece. |

Decisões que tomei por conta e ficam registradas para serem contestadas:

| # | Decisão | Por quê |
|---|---|---|
| D-6 | Hash de senha com **`scrypt` do `node:crypto`**, não argon2id | O projeto já escolheu escrever o JWT sobre `node:crypto` em vez de trazer biblioteca (`session.ts`). `scrypt` é memória-dura, está na biblioteca padrão e é aceito pelo OWASP. argon2id é melhor, mas é módulo nativo — se você aceitar a dependência, troque, e o resto do plano não muda. |
| D-7 | Sessão de conta em **cookie `HttpOnly; Secure; SameSite=Lax`** | O token de sala viaja na query string, e é aceitável porque expira com a sala e só serve para ela (`session.ts`). Sessão de conta não pode viajar assim: fica em cookie, e o token de sala passa a ser **derivado** dela. |
| D-8 | Revogação por **época na conta**, não por tabela de sessões | Um inteiro em `contas`; o token carrega a época; incrementar derruba tudo que foi emitido antes. Resolve "sair de todos os aparelhos" e o item de §7 sem tabela nova nem varredura. |
| D-9 | Redimensionamento **no servidor**, com `sharp` | I-3. E o cliente não é confiável para decidir o que é uma imagem. |
| D-10 | **Recuperação de senha por e-mail**, adiada | Envio comum, como qualquer serviço. Não bloqueia fase nenhuma; traz o primeiro terceiro do qual o projeto depende para funcionar, e por isso precisa de monitoramento próprio. Ver §8 |
| D-11 | **Apelido duplicado resolve-se na mesa** | Duas contas podem se chamar igual; a mesa, não. `04` §2 e CA-374/CA-375 já garantem isso. Entrar com conta passa a poder colidir, e a F2 tem de desempatar na entrada — ver §13 |

---

## 4. Modelo de dados

Postgres. Nomes em português, como o resto do código.

```
contas
  id              uuid pk
  slug            text unique            -- identificador PÚBLICO, usado na URL do perfil
  apelido         text not null
  avatar          jsonb not null         -- ver §10
  epoca_sessao    int not null default 1 -- D-8
  criada_em       timestamptz not null
  atualizada_em   timestamptz not null

credenciais_senha                        -- 0 ou 1 por conta
  conta_id        uuid pk references contas
  email           citext unique not null
  email_verificado boolean not null default false
  hash            text not null          -- scrypt: N,r,p + sal + digest
  atualizada_em   timestamptz not null

identidades_sso                          -- 0..n por conta
  provedor        text not null          -- 'google' | 'github'
  subject         text not null          -- o `sub` do provedor, imutável
  conta_id        uuid not null references contas
  email           citext                 -- informativo; o subject é a chave
  criada_em       timestamptz not null
  primary key (provedor, subject)

partidas
  id              uuid pk
  sala_codigo     text not null
  comecou_em      timestamptz not null
  terminou_em     timestamptz not null
  motivo_fim      text not null          -- EndReason de `04`
  rodadas         int not null
  opcoes          jsonb not null         -- MatchOptions, congeladas

partida_jogadores
  partida_id      uuid references partidas
  posicao         int not null           -- índice em playerOrder
  conta_id        uuid null references contas   -- NULL = convidado ou bot
  apelido         text not null          -- SNAPSHOT, ver abaixo
  avatar          jsonb not null         -- SNAPSHOT
  bot             boolean not null
  dificuldade     text null
  colocacao       int not null           -- 1 = campeão (RJ-012, RJ-129)
  vidas_finais    int not null
  eliminado_rodada int null
  morto_em_vaza   int null
  acertos         int not null
  jogadas         int not null
  erro_medio      numeric(4,2) not null
  pior_erro       int not null
  nota            numeric(3,1) not null
  primary key (partida_id, posicao)
```

**Por que apelido e avatar são snapshot e não referência.** É a mesma razão pela qual
`ChatMessage` já copia o `nickname` no envio em vez de resolvê-lo pelo `playerId` na hora de
exibir (`protocol/index.ts` §89). O histórico é um registro do que aconteceu: quem trocar de
apelido amanhã não reescreve a partida de ontem, e o convidado que não tem conta precisa
aparecer de algum jeito. Com referência viva, uma partida de seis meses atrás mudaria de
elenco sozinha.

---

## 5. Onde a conta encosta na sala — e onde não encosta

Esta é a parte que mais pode dar errado, então é a que fica mais explícita.

`playerId` **continua sendo o que é hoje**: um identificador opaco, por sala, que o motor usa
para tudo. A conta não substitui, não vira chave e não entra em `MatchState`. Ela pendura um
campo a mais no jogador da SALA:

```ts
export interface PublicPlayer {
  playerId: PlayerId;
  nickname: string;
  avatar: Avatar;
  // ...
  /** Slug público da conta, quando há conta. É por aqui que se abre o perfil. */
  conta: string | null;
}
```

É `slug` e não o `uuid` da conta de propósito: o id interno nunca sai do servidor.

Consequências que precisam ser cumpridas:

- `PROTOCOL_VERSION` sobe de `1` para `2`. `PublicPlayer` e `Avatar` mudam de forma, e cliente
  velho com servidor novo tem de recusar limpo — **e esse caminho já existe e funciona**:
  `validate.ts` devolve o código `PROTOCOL_VERSION` quando o `v` não bate, `ws.ts` o emite, e
  há teste de integração em `server/test/ws.test.ts`. Subir para `2` já faz o cliente velho
  receber `ERR-426` e pedir para recarregar; não há nada a construir.

  > Correção de 26/08/2026. A primeira versão deste plano afirmava o contrário — que nada no
  > servidor conferia o `v` — e mandava implementar a checagem como primeira tarefa da F2. Era
  > engano meu: procurei em `protocol/src/index.ts` e em `server/src/*.ts`, e `validate.ts`
  > está em `protocol/src/`, exatamente na fresta entre as duas buscas.
- Quem entra com conta **não escolhe apelido nem avatar na sala**: vêm da conta. Quem entra sem
  conta escolhe como hoje, e nada muda.
- Espectador com conta também carrega `conta`. Perfil se abre de qualquer assento.

### 5.1 Quando duas contas colidem na mesa

Entrou aqui em 26/08/2026, junto de D-11. A unicidade de apelido, emoji e cor **dentro da
sala** já é garantida por `packages/room/src/identidade.ts` (`04` §2, CA-374 e CA-375). O que
muda com contas é que a identidade deixa de ser escolhida na porta e passa a vir pronta — duas
contas chamadas "João" entram e colidem sem que ninguém tenha escolhido colidir.

| # | Regra | Por quê |
|---|---|---|
| R-1 | A entrada **desempata e deixa entrar**. Nunca recusa. | É a mesma razão de CA-006: quem chegou depois não escolheu colidir, e barrar na porta é atrito puro. Com conta é pior ainda — a pessoa não tem como ceder, o apelido é da conta dela. |
| R-2 | Só a metade que colide é trocada. | Já é a regra da mesa. Perder a cor por causa do emoji apagaria uma escolha que ninguém disputou. |
| R-3 | **O desempate é da MESA, não da conta.** A conta nunca é reescrita por causa de uma sala. | Sem isto, entrar numa sala onde já existe um "João" renomearia a sua conta para sempre. A sala guarda um apelido de exibição; a conta segue intacta. |
| R-4 | O editor de perfil no lobby, para quem tem conta, mostra e salva **a identidade da CONTA** — nunca a desempatada. | É a armadilha desta seção. Se a sala te renomeou para "João (2)" e o editor mostrar isso, salvar grava "João (2)" **na sua conta**, e o sufixo vira permanente. O editor tem de ler da conta. |
| R-5 | Salvar pelo editor continua recusando com motivo (CA-375), e a recusa vale contra a mesa. | A escolha ali é deliberada, e a tela mostra o que está tomado. Desempatar em silêncio trocaria a escolha de alguém. |
| R-6 | Avatar de **imagem nunca é trocado** pela mesa. A cor pode repetir quando as 8 acabarem. | A imagem é canal de identificação mais forte que um emoji: duas fotos diferentes não se confundem a 360 px, mesmo com o mesmo anel. Trocar a foto de alguém para satisfazer uma regra de cor seria trocar o rosto da pessoa. |
| R-7 | Quem foi desempatado **é avisado** na mesa. | Ver o próprio nome com um sufixo, sem explicação, se parece com defeito. Uma linha basta: *"já havia um João nesta mesa"*. |

R-6 abre um buraco que o desenho atual não tinha e que é preciso assumir de olho aberto: hoje,
com a cor esgotada, o **emoji único** é o que ainda garante o par de `04` §2. Avatar de imagem
não tem emoji, então esse resgate deixa de existir. A conta fecha assim mesmo — 8 cores para no
máximo 12 pessoas, e a partir da nona a foto é o que distingue —, mas quem for mexer em `04` §2
depois precisa saber que essa é uma **exceção deliberada**, e não um caso esquecido.

---

## 6. Autenticação

### 6.1 E-mail e senha

| Item | Decisão |
|---|---|
| Hash | `scrypt` (D-6), parâmetros `N=2^15, r=8, p=1`, sal de 16 bytes, guardados junto do digest para permitir rotação |
| Comparação | `crypto.timingSafeEqual`, sempre |
| E-mail desconhecido | **Roda um hash falso mesmo assim** antes de responder. Sem isso o tempo de resposta diz quem tem conta, e §D-4 diz que ninguém deve ser descobrível |
| Senha mínima | 10 caracteres, sem regra de composição. Regra de "1 maiúscula e 1 símbolo" produz senha pior e é o que o NIST desaconselha desde 2017 |
| Tentativas | Limite por IP **e** por conta, janela deslizante, com atraso crescente. Entra em `LIMITS` junto de `commandsPerWindow` |

### 6.2 SSO

Fluxo de **código de autorização com PKCE**, inteiro no servidor. O cliente só é redirecionado;
não há SDK, não há token de provedor chegando ao navegador (I-3).

- `state` assinado e casado com um cookie de vida curta — é a defesa contra CSRF de login, e
  não é opcional.
- A chave da identidade é `(provedor, subject)`, **nunca o e-mail**: o e-mail no Google e no
  GitHub pode mudar; o `sub` não.
- GitHub não devolve e-mail verificado no perfil por padrão: é preciso chamar `/user/emails` e
  usar só o que vier `primary` **e** `verified`. Sem isso, D-3 vira um sequestro de conta.

### 6.3 Sessão

Cookie `HttpOnly; Secure; SameSite=Lax; Path=/`, com JWT assinado pelo mesmo `session.ts` que
já existe, carregando `{ conta, epoca }`. O token de sala passa a ser **derivado**: quem tem
cookie válido recebe o token daquela sala sem digitar nada.

---

## 7. A regra de tomada de conta (D-3)

Quando um SSO chega com e-mail **verificado pelo provedor** que já existe em
`credenciais_senha`:

1. A identidade SSO é vinculada àquela conta.
2. `credenciais_senha` é **apagada** — não desativada, apagada.
3. `epoca_sessao` é incrementada, derrubando todas as sessões abertas (D-8).

Você escolheu isto sabendo do efeito colateral, e ele precisa de tratamento na tela: **quem
cadastrou de boa-fé perde o acesso por senha sem ser avisado.** Sem e-mail, não há como
notificar. O mínimo é que a tela de login não minta:

> RF-06x — Tentar entrar com senha numa conta que foi assumida por SSO **DEVE** dizer o que
> houve e qual é o caminho — *"Esta conta agora entra pelo Google"* —, nunca "senha inválida".

Dizer "senha inválida" é o comportamento fácil, e é o que faz a pessoa tentar de novo cinco
vezes e ir embora achando que é bug.

---

## 8. O que "sem confirmar e-mail" custa

Isto merece seção própria porque a consequência principal não é a que parece.

**Não é o cadastro de e-mail alheio** — D-3 resolve o caso do Google e do GitHub.

**É que não existe recuperação de senha.** Esqueceu a senha, não há para onde mandar link. A
conta, com todo o histórico dela, acaba ali. E como o perfil é público por link (D-4), a pessoa
vê o próprio histórico e não consegue mais entrar nele.

**Decidido em 26/08/2026 (D-10): saída 3, adiada.** A recuperação será um envio de e-mail
comum, como em qualquer outro serviço — link com token de uso único e prazo curto. Não entra
agora e não bloqueia nenhuma fase, mas deixa de ser pergunta em aberto: o desenho de dados já
a acomoda, e a decisão está tomada.

O que isso implica quando chegar a hora:

- **Provedor de envio** (Resend, SES ou equivalente) — infra nova, pequena, e a primeira do
  projeto que depende de terceiro para funcionar. Um e-mail que não chega é um usuário que
  não entra, então precisa de monitoramento próprio, não só de código.
- `email_verificado` já está na tabela justamente para isso não exigir migração.
- Até lá, vale a saída 1 **junto** da 2: o cadastro por senha diz, na hora, que ainda não há
  recuperação, e o SSO fica como caminho principal na tela. Uma frase e uma ordem de botões —
  e é o que impede alguém de perder o histórico sem ter sido avisado.

---

## 9. Histórico de partidas

**Regra de gravação:** grava-se a partida se **ao menos um jogador sentado tiver conta**. Bots
não contam. Espectador não conta — quem não sentou não jogou.

Uma mesa inteira de convidados não deixa rastro nenhum, que é o comportamento certo: sem conta,
não há a quem aquilo pertença.

### 9.1 Uma coisa a arrumar antes

`desempenhoDaPartida` mora hoje em `app/src/desempenho.ts` — **no cliente**. O histórico precisa
dos mesmos números no servidor. Se as duas contas existirem em dois lugares, elas vão divergir,
e o histórico vai discordar da tela de fim da mesma partida.

Isto não é hipótese. É exatamente o defeito que **CA-360** foi escrito para prender: a tela de
fim reimplementava a classificação em vez de usar a do motor, e ordenava errado porque todo
eliminado termina com zero vida. Consertou-se importando `ranking()` de `@fdp/rules`.

**Então: mover `desempenho` para `@fdp/rules` antes de gravar qualquer histórico**, com a tela
de fim e o servidor consumindo a mesma função. É pré-requisito da fase F4, não melhoria
opcional.

### 9.2 Quando gravar

No `match:ended`, do lado do servidor, dentro da sala. Toda `EndReason` grava — inclusive
`ENCERRADA_PELO_HOST` e `VITORIA_POR_ABANDONO` —, com o motivo no registro. Partida abortada por
RJ-155 não é partida encerrada e não grava nada.

A gravação **NÃO PODE** bloquear o encerramento da partida nem derrubar a sala se o Postgres
estiver fora: falha de gravação vira log e métrica, e a mesa segue. Histórico é registro, não
jogo.

---

## 10. Avatar por imagem

`Avatar` deixa de ser um par fechado e vira união discriminada:

```ts
export type Avatar =
  | { tipo: 'emoji'; emoji: AvatarEmoji; cor: AvatarColor }
  | { tipo: 'imagem'; url: string; cor: AvatarColor };
```

A `cor` sobrevive nos dois casos: é o anel do assento e o que aparece enquanto a imagem carrega.
Sem ela, a mesa perde o código de cor que `07` §4 garante distinguível sob deuteranopia.

**Processamento, no servidor:**

| Etapa | Regra |
|---|---|
| Envio | Máx. 5 MB, só para quem tem conta |
| Tipo | **Detectado pelo conteúdo**, nunca pelo `Content-Type` nem pela extensão |
| Bomba de descompressão | Teto de pixels na decodificação (`limitInputPixels`); PNG de 50 000² cabe em poucos KB e derruba o processo |
| Saída | Recorte central quadrado, `256×256` e `64×64`, WebP |
| Metadados | EXIF removido — inclusive **GPS**. Foto de celular carrega a coordenada de onde foi tirada, e o avatar é público por link |
| Guarda | `/var/lib/fdp/avatares/<sha256>.webp`, endereçado por conteúdo: reenvio é idempotente e o cache pode ser imutável |
| Serviço | Caddy serve o diretório; a aplicação não fica no caminho do byte |

**Risco que fica aceito e registrado:** imagem enviada por usuário, visível numa mesa e num
perfil público, sem moderação. Mitiga-se o começo restringindo o envio a contas e guardando o
hash — o que permite banir um arquivo. Um caminho de denúncia fica para depois; se a mesa
deixar de ser um grupo de amigos, isso vira urgente.

---

## 11. Requisitos e critérios

IDs livres hoje: **RF-060+**, **RNF-105+**. Em `CA-###`, o bloco **363 a 373** continua
reservado a este plano, e **376+** para o que vier depois — 374 e 375 foram tomados pela
unicidade de identidade na mesa (26/08/2026), que passou na frente. Nenhum `RJ-###` novo — I-2.

| ID | Requisito (rascunho) |
|---|---|
| RF-060 | Criar conta com e-mail e senha, sem confirmação de e-mail |
| RF-061 | Entrar com Google ou GitHub |
| RF-062 | SSO com e-mail verificado assume conta de senha existente, apaga a senha e derruba as sessões |
| RF-063 | Entrar com senha em conta assumida por SSO diz o que houve e qual é o caminho |
| RF-064 | Jogar sem conta continua completo — I-1 |
| RF-065 | Sessão de conta em cookie `HttpOnly`; token de sala derivado dela |
| RF-066 | Perfil público por link: apelido, avatar, partidas, vitórias, nota média |
| RF-067 | Perfil de qualquer jogador da mesa acessível a partir do assento |
| RF-068 | Histórico grava a partida se ao menos um jogador sentado tiver conta |
| RF-069 | Apelido e avatar são gravados como snapshot |
| RF-070 | Avatar por imagem, reduzido no servidor, com EXIF removido |
| RF-071 | Falha ao gravar histórico não afeta a partida |
| RF-072 | Colisão de identidade entre contas desempata na entrada e avisa quem foi desempatado (§5.1) |
| RF-073 | O editor de perfil de quem tem conta edita a conta, não o apelido desempatado da mesa |

| ID | Critério (rascunho) |
|---|---|
| CA-363 | E-mail desconhecido e senha errada gastam o mesmo tempo — não dá para descobrir quem tem conta |
| CA-364 | `state` inválido ou ausente no retorno do SSO recusa o login |
| CA-365 | SSO só assume conta com e-mail **verificado** pelo provedor; GitHub sem `verified` não assume |
| CA-366 | Tomada de conta apaga a senha e invalida todas as sessões abertas |
| CA-367 | Partida sem nenhum jogador com conta **não** grava nada |
| CA-368 | Números do histórico batem com os da tela de fim da mesma partida — a função é uma só |
| CA-369 | Postgres fora do ar: a partida encerra normalmente e a falha vira métrica |
| CA-370 | Upload que não é imagem, ou que estoura o teto de pixels, é recusado sem derrubar o processo |
| CA-371 | Avatar processado não carrega EXIF nem GPS |
| CA-372 | Sala com jogador sem conta continua funcionando de ponta a ponta |
| CA-373 | Cliente em `PROTOCOL_VERSION` 1 contra servidor 2 recusa limpo com `ERR-426`, e não com tela quebrada — o teste já existe em `server/test/ws.test.ts`; a F2 só precisa mantê-lo verde depois da subida para `2` |
| CA-376 | Duas **contas** com o mesmo apelido na mesma sala: a segunda entra desempatada, e nenhuma é barrada na porta (R-1) |
| CA-377 | O desempate da mesa **não** altera o apelido da conta: sair e entrar noutra sala vazia devolve o nome original (R-3) |
| CA-378 | O editor de perfil de quem tem conta mostra o apelido da CONTA, não o desempatado — salvar não grava o sufixo (R-4) |
| CA-379 | Avatar de imagem não é trocado pela mesa, mesmo com as 8 cores esgotadas (R-6) |

O contrato de repositório segue o precedente do `RoomStore`: **uma suíte só, que a implementação
em memória e a de Postgres passam igual** (`11` §4). Sem isso não há teste de conta que rode
rápido.

---

## 12. Fases

Cada fase tem gate de saída, no formato de `12`.

**F1 — Fundação de persistência.** ✅ **Concluída em 26/08/2026.** Postgres em container,
migrações versionadas, repositórios e a suíte de contrato dupla.
*Gate:* a suíte de contrato passa nas duas implementações; o backup é restaurado uma vez, para
valer, num banco vazio.

*Cumprido:* `@fdp/contas` com `Dados` (memória + Postgres), 22 testes de contrato passando nas
duas, obrigatórios no CI — que falha se qualquer uma das duas suítes for pulada. Backup
(`deploy/backup-postgres.sh`) e restauração (`deploy/restaurar-postgres.sh`) exercitados de
verdade: dump de um banco semeado, restauração num banco vazio, contagens idênticas nas cinco
tabelas, índice funcional e `ON DELETE SET NULL` sobreviveram, e **a aplicação leu o banco
restaurado** com os mesmos dados.

*O que a suíte dupla pegou de imediato:* o esquema dependia da extensão `citext`, que passava em
memória e quebrava no Postgres. Trocada por índice único sobre `lower(email)` — mesma garantia,
do lado do banco, sem exigir `CREATE EXTENSION` (que pede superusuário em boa parte dos Postgres
gerenciados). Era exatamente o tipo de defeito que só apareceria em produção.

*Fica para quando o Postgres subir na VPS:* alerta no Grafana junto dos que já existem, e o
backup no cron.

**F2 — Contas por e-mail e senha.** ✅ **Concluída em 26/08/2026.** Cadastro, login, sessão em
cookie, limites de tentativa, `PROTOCOL_VERSION` 2, `PublicPlayer.conta` e o desempate de §5.1.
*Gate:* CA-363, CA-372 e CA-373. Uma pessoa com conta e uma sem jogam a mesma partida inteira.

*Cumprido:* 28 testes de rota e 13 do núcleo de autenticação. Senha com `scrypt` do
`node:crypto` (D-6), sessão em cookie `HttpOnly` (D-7), revogação por época (D-8), perfil
público por slug (D-4) e `PATCH /api/eu` para R-4.

*Três coisas que só apareceram implementando:*

1. **Confusão de tipo entre os dois tokens.** O de sala e o de conta são HS256 com o MESMO
   segredo, então a assinatura de um confere no outro — e o de sala viaja na query string do
   WebSocket, onde proxy registra. Sem separação, um token de log viraria sessão permanente.
   Resolvido com a claim `tipo`, que é obrigatória no token de conta e opcional no de sala
   (ausente = emitido antes, e continua valendo: deploy não expulsa ninguém do meio da
   partida).
2. **O servidor emitia `v: 1` fixo** em `hub.ts`, enquanto validava a entrada contra a
   constante. Subir para 2 teria deixado servidor e cliente falando versões diferentes em
   direções opostas. Agora segue a constante.
3. **As rotas novas violavam RNF-001**, devolvendo `{ error: { code } }` em vez de
   `{ code, params? }`. O cliente lê `code` do topo, então metade das mensagens de erro
   chegaria vazia na tela. Corrigido, com teste que compara os dois formatos.

*Deliberadamente adiado:* CA-379 (avatar de imagem não trocado pela mesa) depende da união de
`Avatar`, que é da F5.

**F3 — SSO.** Google e GitHub, PKCE, `state`, e a regra de tomada de conta com a tela de RF-063.
*Gate:* CA-364, CA-365, CA-366.

**F4 — Histórico e perfil público.** Primeiro mover `desempenho` para `@fdp/rules` (§9.1),
depois gravar e depois expor.
*Gate:* CA-367, CA-368, CA-369. Uma partida real aparece no perfil com os mesmos números da tela
de fim.

**F5 — Avatar por imagem.** Upload, `sharp`, servir por Caddy, e o `Avatar` em união.
*Gate:* CA-370, CA-371, e o avatar aparece na mesa em 360 px sem quebrar o assento.

F1 a F3 são sequenciais. F4 depende de F1 e F2. F5 depende de F2 e é independente das demais.

---

## 13. O que este plano deixa em aberto

1. ~~**Recuperação de senha**~~ — **resolvido** (D-10, §8): envio de e-mail comum, adiado.
   Fica pendente só o provedor de envio, quando a fase chegar.
2. **Moderação de avatar e apelido** — §10, risco aceito.
3. **LGPD**: contas guardam e-mail, e o histórico guarda apelido de convidado. Falta decidir
   retenção e um caminho de apagamento de conta. Não bloqueia F1–F3; bloqueia divulgar o jogo
   fora do círculo de amigos.
4. ~~**Apelido duplicado**~~ — **resolvido** (D-11, 26/08/2026): **resolve-se na mesa, não no
   cadastro**, e a mesa passou a garantir isso antes deste plano. `04` §2 agora exige apelido,
   emoji e cor únicos **dentro da sala**, com a regra implementada em `packages/room` e
   cobrada por CA-374 e CA-375.

   Duas contas podem ter o mesmo apelido — o `slug` resolve a URL do perfil. O que não pode é
   a **mesa** ter dois "João", e é lá que a regra vale. A consequência para este plano: quem
   entra com conta traz apelido e avatar da conta (§5), então **a colisão passa a ser possível
   entre duas contas na mesma sala**, e o caminho de entrada tem de desempatar como já faz com
   convidado — sufixando na entrada, nunca recusando na porta.

   **Escrito em 26/08/2026: virou §5.1**, com sete regras, RF-072/RF-073 e CA-376 a CA-379, e
   está na F2. Duas coisas que só apareceram ao escrever: o editor de perfil precisa ler da
   conta, senão o sufixo da mesa vira permanente ao salvar (R-4); e avatar de imagem não tem
   emoji, então some o resgate que hoje garante o par de `04` §2 quando as cores acabam (R-6).
