# 09 — Requisitos Não Funcionais

Status: **ESTÁVEL**

## 1. Desempenho

| ID | Requisito | Como medir |
|---|---|---|
| RNF-050 | Latência comando → evento correspondente: p50 ≤ 120 ms, p95 ≤ 350 ms (mesma região) | Métrica de servidor por comando |
| RNF-051 | Tempo até jogável (LCP + WS conectado) na home: ≤ 2,0 s em 4G simulado | Lighthouse mobile + teste sintético |
| RNF-052 | Reconexão completa (socket + snapshot aplicado): ≤ 1,5 s p95 | Métrica de cliente |
| RNF-053 | Snapshot de sala com 8 jogadores: ≤ 32 KB serializado | Teste unitário sobre a projeção |
| RNF-017 | Envio de avatar: orçamento próprio de 30/h **por conta**, nunca o de cadastro por IP | Teste de integração (CA-390) |
| RNF-018 | `/avatares/:nome` responde `immutable`, com cache em processo limitado **por bytes** | Teste unitário (RNF-018) |
| RNF-019 | Backup dos avatares com restauração **testada uma vez, para valer** — mesmo gate do Postgres | Manual, no gate de F4 do plano 02 |
| RNF-054 | Interface a 60 fps durante animações em aparelho de gama média | Perfil manual |
| RNF-055 | Bundle JS inicial: ≤ 180 KB comprimido | Orçamento verificado no CI |

RNF-055 é orçamento **com falha no CI**, não meta aspiracional. Um jogo que demora para
carregar perde o grupo antes da primeira rodada.

## 2. Escala e disponibilidade

| ID | Requisito |
|---|---|
| RNF-060 | Suportar 500 salas simultâneas e 2.000 conexões WebSocket sem degradar RNF-050 |
| RNF-061 | Estado de sala vive na memória do processo e é persistido no Redis; reinício **DEVE** recarregar as salas vivas (`11` §4) |
| RNF-062 | Deploy **NÃO DEVE** encerrar partida em andamento: desligamento gracioso + reconexão dentro de `TRANSPORT_GRACE` |
| RNF-063 | Perda total do store de estado encerra partidas, mas **NÃO DEVE** deixar o cliente travado — a UI cai em `ERR-001` com saída clara |
| RNF-064 | Disponibilidade alvo: 99% mensal. Não há SLA formal na v1 |
| RNF-065 | Ao receber `SIGTERM`, o servidor **DEVE** fechar os sockets com código de "reconecte" e persistir as salas antes de sair, para que um deploy não vire queda seca (`11` §7) |
| RNF-066 | Reconexão de transporte **NÃO DEVE** ser observável pelo jogador: sem pausa, sem aviso, sem perda de estado |

RNF-062 decorre diretamente do design de `05` §3: como reconectar é indistinguível de um
resync, um deploy no meio da partida é apenas uma reconexão para cada cliente.

## 3. Segurança

| ID | Requisito |
|---|---|
| RNF-070 | O servidor é a **única** autoridade sobre o estado. Nenhum resultado de jogada vem do cliente |
| RNF-071 | Estado oculto **NUNCA** trafega para quem não tem direito de vê-lo (`04` §5, INV-07) |
| RNF-072 | Toda entrada do cliente é validada por schema antes de tocar a lógica de jogo |
| RNF-073 | O `seed` da partida **NÃO DEVE** ser exposto antes de `match:ended` |
| RNF-073b | Na rodada de 1 carta, nenhuma mensagem enviada a um jogador **DEVE** conter a carta dele antes de `EV-023` (RJ-100) |
| RNF-074 | Embaralhamento usa gerador criptograficamente seguro (Fisher-Yates com CSPRNG) |
| RNF-075 | `sessionToken` assinado, escopado a uma sala, expira com ela; nunca em log |
| RNF-076 | Rate limit em HTTP (`06` RNF-003) e em WebSocket (`05` §7) |
| RNF-077 | Nenhuma renderização de conteúdo do usuário como HTML |
| RNF-078 | CSP restritiva, sem `unsafe-inline` em script |
| RNF-079 | Dependências auditadas no CI; vulnerabilidade alta ou crítica quebra o build |

### 3.1 Modelo de ameaça — anti-trapaça

O adversário realista aqui não é um invasor: é um amigo do grupo com o DevTools aberto.

| Ameaça | Defesa |
|---|---|
| Ler a mão dos outros pela rede | Projeção por jogador; o dado nunca sai do servidor (RNF-071) |
| **Ler a própria carta na rodada de testa** | Projeção **invertida**: EV-011 é serializado uma vez por destinatário, omitindo a carta dele. INV-13, CA-281 (projeção) e CA-285 (no fio) |
| Ler o baralho para prever compras | Baralho é estado oculto; cliente vê só a contagem |
| Jogar carta que não possui | Validação de posse; `ERR-403` e registro de suspeita |
| Jogar fora do turno | Verificação de turno no servidor; `ERR-006` |
| Jogar mais rápido que o humanamente possível via console | Rate limit + validação de fase; não é vantagem, pois o servidor ordena |
| Repetir uma jogada aproveitando reconexão | Idempotência por `id` de comando (RNF-013) |
| Aplicar jogada de rodada ou vaza já encerrada | `matchId` + `roundNumber` + `trickNumber` obrigatórios; `ERR-410` |
| Assumir a sessão de outro jogador | Token assinado e escopado; um socket por sessão (`ERR-409`) |
| Forjar o resultado de uma rodada | O cliente não calcula resultado; só renderiza `round:resolved` |
| Reconstruir o embaralhamento | CSPRNG + `seed` nunca exposto durante a partida (RNF-073/074) |

Ocorrências de `ERR-403` **DEVEM** ser registradas com `roomCode` e `playerId` — não para
punir, mas porque um pico delas indica ou tentativa de trapaça ou bug real de sincronização.

## 4. Privacidade

| ID | Requisito |
|---|---|
| RNF-080 | Coletar apenas apelido e avatar; nada mais é solicitado ou inferido |
| RNF-081 | Nenhum dado sobrevive à sala; TTL apaga tudo |
| RNF-082 | Sem cookies de terceiros, sem rastreadores publicitários, sem fingerprinting |
| RNF-083 | Telemetria anônima e agregada; sem IP em métrica de produto |
| RNF-084 | Logs de aplicação retidos por no máximo 7 dias |

## 5. Observabilidade

Métricas mínimas: salas criadas, partidas iniciadas, partidas concluídas, taxa de abandono,
duração de partida, latência de comando (p50/p95), reconexões por partida — separando
**reciclagem de transporte** de **ausência real** —, auto-plays por
partida, erros por código, **pausas por partida**, **duração de cada pausa**, e distribuição
das resoluções de ausência (reconexão / continuar sem / encerrar / `PAUSE_MAX`).

| ID | Requisito |
|---|---|
| RNF-090 | Todo log de servidor inclui `roomCode` e `stateVersion` para reconstruir a linha do tempo |
| RNF-091 | Erro não tratado no servidor **NÃO DEVE** derrubar a sala; captura, log e `EV-015` ao cliente |
| RNF-092 | Um alerta para partidas travadas: sala em `EM_PARTIDA` sem mudança de `stateVersion` por 5 min |
| RNF-093 | `PAUSADA` **NÃO DEVE** disparar RNF-092 — é pausa legítima. O alerta próprio é sala em `PAUSADA` além de `PAUSE_MAX` + 1 min, que indica timer de encerramento quebrado |
| RNF-094 | A taxa de resolução por `PAUSE_MAX` **DEVE** ser monitorada: alta significa que o host nunca está presente para decidir, e a política de `02` §3.8.3 precisa mudar |

RNF-092 é o alarme que protege a métrica "0 partidas travadas" de `00` §7. Sem ele, o defeito
mais grave do produto é justamente o mais silencioso.

## 6. Compatibilidade

- Navegadores: últimas 2 versões de Chrome, Safari, Firefox e Edge; Safari iOS 16+;
  Chrome Android 110+.
- **NÃO DEVE** haver suporte a navegador sem WebSocket; a UI detecta e explica.
- Funciona em aba em segundo plano: ao voltar ao primeiro plano, resync automático — celular
  bloqueado é o caso mais comum de todos, não uma exceção.

## 7. Manutenibilidade

| ID | Requisito |
|---|---|
| RNF-100 | Lógica de regras é função pura, sem I/O, sem framework, sem `Date.now()` nem `Math.random()` diretos (recebem-se `now` e `rng` por parâmetro) |
| RNF-101 | Cobertura de testes ≥ 90% no módulo de regras; ≥ 70% no restante |
| RNF-102 | Todo `RF-*`, `RNF-*` e `RJ-*` referenciado por ao menos um teste que cite seu ID |
| RNF-103 | Tipagem estrita, sem `any` na fronteira de dados |
| RNF-104 | Contrato de `05` gerado a partir de uma fonte única de tipos, compartilhada entre cliente e servidor |

RNF-100 é o que torna possível testar regras em milissegundos e reproduzir qualquer bug a
partir de `(seed, jogadas[])`. Injetar tempo e aleatoriedade é o que separa um jogo testável
de um jogo em que "só acontece às vezes".
