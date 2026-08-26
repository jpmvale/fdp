# 06 — API HTTP

Status: **ESTÁVEL**

O HTTP cobre apenas o que acontece **antes** de existir um WebSocket: criar sala, verificar
sala e obter uma sessão. Tudo que ocorre dentro da sala é realtime (`05`). Essa separação
mantém a superfície HTTP mínima e sem estado de jogo.

Base: `/api`. Formato: JSON. Erros seguem a mesma tabela de códigos de `05` §6.

## 1. Endpoints

### `POST /api/rooms`

Cria uma sala e devolve a sessão do host.

```jsonc
// request
{ "nickname": "Ana", "avatar": { "emoji": "🦊", "color": "amber" } }

// 201
{
  "roomCode": "K7QMP",
  "playerId": "7f3c...",
  "sessionToken": "eyJ...",
  "wsUrl": "wss://fdp.app/api/rooms/K7QMP/ws"
}
```

### `GET /api/rooms/{code}`

Consulta pública e leve, usada para validar o código **antes** de o jogador digitar o apelido.
Não exige sessão e **NÃO DEVE** revelar nada de partida.

```jsonc
// 200
{
  "roomCode": "K7QMP",
  "status": "LOBBY",
  "playerCount": 3,
  "maxPlayers": 8,
  "canJoinAsPlayer": true,
  "canJoinAsSpectator": true
}
// 404 → ERR-001 ROOM_NOT_FOUND
```

### `POST /api/rooms/{code}/join`

```jsonc
// request
{ "nickname": "Beto", "avatar": { "emoji": "🐙", "color": "teal" } }

// 200
{
  "playerId": "9a1b...",
  "sessionToken": "eyJ...",
  "wsUrl": "wss://fdp.app/api/rooms/K7QMP/ws",
  "role": "PLAYER"          // ou "SPECTATOR" se a partida já começou
}
// 404 → ERR-001 | 409 → ERR-002 ROOM_FULL | 422 → ERR-008
```

### `POST /api/rooms/{code}/session`

Revalida um `sessionToken` guardado no dispositivo, para retomar sem recriar jogador.
É o que sustenta "fechei a aba sem querer e voltei".

```jsonc
// request
{ "sessionToken": "eyJ..." }
// 200 → mesmo formato de join
// 401 → ERR-003 INVALID_TOKEN (cliente limpa o storage e faz join normal)
```

### `GET /api/health`

`200 { "ok": true, "version": "<git sha>" }`. Sem autenticação.

## 2. Código da sala

- **5 caracteres**, alfabeto `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` (32 símbolos, sem `I`, `O`,
  `0`, `1` — confundem quando ditados por voz ou lidos em tela pequena).
- Espaço de 32⁵ ≈ 33,5 milhões de combinações.
- Geração: aleatório criptográfico + verificação de colisão contra salas vivas; até 5
  tentativas, depois `500`.
- Entrada do usuário é normalizada: `trim`, maiúsculas, remoção de hífens e espaços.
- Códigos **DEVEM** ser filtrados contra uma lista de palavras ofensivas em PT-BR e EN antes
  de serem atribuídos.
- Um código só volta a ser sorteável após a sala ser `ENCERRADA` e removida do store.

## 3. Link de convite

`https://fdp.app/j/{code}` — abre direto na tela de apelido, com o código pré-preenchido e
bloqueado. É o artefato compartilhado no grupo; o fluxo de "digitar código" existe como
alternativa, não como caminho principal (métrica de tempo-até-jogar em `00` §7).

## 4. Sessão e autenticação

- `sessionToken` é um **JWT assinado** (HS256) com claims: `playerId`, `roomCode`, `iat`,
  `exp` (= `ROOM_MAX_LIFE`). O segredo vive em variável de ambiente e nunca no cliente.
- É guardado em `localStorage` sob a chave `fdp.session.{roomCode}`, permitindo participar de
  salas diferentes em abas diferentes.
- Não há refresh: expirou, o jogador refaz o join.
- O token **NÃO DEVE** aparecer em logs, em mensagens de erro, ou em qualquer evento de `05`.
- Sendo passado na query string do WebSocket, ele **DEVE** ser tratado como potencialmente
  registrado por proxies: por isso é curto, escopado a uma sala e expira com ela.

## 5. Requisitos transversais

| ID | Requisito |
|---|---|
| RNF-001 | Toda resposta de erro segue `{ "code": "...", "params": {...} }` |

## 6. Contas (P11, plano 01 F2)

**Tudo aqui é opcional.** Sem `DATABASE_URL` estas rotas respondem `503 CONTAS_INDISPONIVEIS` e
o jogo funciona inteiro — conta é acréscimo, nunca pedágio.

| Método | Rota | O que faz |
|---|---|---|
| `POST` | `/api/contas` | Cadastro com e-mail e senha. Devolve a conta e já põe o cookie |
| `POST` | `/api/sessao` | Login. Senha errada e e-mail inexistente dão a MESMA resposta (CA-363) |
| `DELETE` | `/api/sessao` | Sai neste aparelho. **Não** derruba os outros |
| `GET` | `/api/eu` | A conta do cookie, ou `null`. Visitante é estado normal, não erro |
| `PATCH` | `/api/eu` | Edita apelido e avatar **da conta** (R-4). O slug não muda |
| `GET` | `/api/perfis/{slug}` | Perfil público (D-4). Sem listagem e sem busca |

### 6.1 SSO (F3)

| Método | Rota | O que faz |
|---|---|---|
| `GET` | `/api/sso` | Que provedores estão de pé. Vazio = nenhum botão na tela |
| `GET` | `/api/sso/{provedor}` | Redireciona ao provedor, com `state` no cookie e na URL |
| `GET` | `/api/sso/{provedor}/retorno` | Volta: confere o `state`, troca o código e entra |

**PKCE só no Google.** O GitHub não implementa PKCE em OAuth App; lá a defesa é o `state` mais o
segredo do cliente. O `state` é obrigatório nos dois, vale uma volta só e expira em dez minutos.

O `destino` aceita **apenas caminho interno**. Login que aceita URL de fora é trampolim de
phishing: manda ao provedor de verdade e traz de volta ao site do atacante, já autenticado.

A tomada de conta de D-3 acontece aqui, e **só com e-mail verificado pelo provedor**. Sem essa
exigência a regra vira sequestro: bastaria pôr o endereço alheio no perfil do provedor.

### 6.2 Sessão

A sessão é um cookie `HttpOnly; Secure; SameSite=Lax`, com JWT de claim `tipo: 'conta'`. O
token de SALA continua na query string do WebSocket porque expira com a sala e só serve para
ela; sessão de conta é identidade permanente e não pode viajar assim. **Os dois nunca se
confundem**: a claim `tipo` é conferida nos dois sentidos.

`POST /api/rooms` e `POST /api/rooms/{code}/join` passam a ler o cookie: quem está logado tem
apelido e avatar tirados da CONTA, e o corpo do pedido é ignorado. Quem não está segue
escolhendo como sempre.
| RNF-002 | CORS restrito à origem da aplicação |
| RNF-003 | Rate limit por IP: 10 criações de sala por hora, 60 joins por hora |
| RNF-004 | Nenhum endpoint HTTP expõe estado de partida — nem placar, nem cartas |
| RNF-005 | Cabeçalhos de segurança: `Content-Security-Policy`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer` |
| RNF-006 | Respostas de `GET /api/rooms/{code}` são `no-store` |
