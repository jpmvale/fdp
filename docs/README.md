# FDP — Especificação

Jogo de cartas de **vazas, aposta e blefe** para 2 a 8 pessoas, jogado no navegador, cada uma
no seu próprio dispositivo, conectadas por uma **sala com código de convite**.

Você declara quantas vazas vai ganhar e perde vidas ao errar. Uma regra estrutural impede que
a soma das apostas feche com o número de vazas disponíveis: **alguém sempre se dá mal**. Na
rodada de 1 carta, você aposta sem ver a própria carta — ela fica na sua testa, à vista de
todos os outros.

Este diretório é a **fonte da verdade** do produto. Nenhuma linha de código de gameplay deve
ser escrita antes do documento correspondente estar marcado como `ESTÁVEL`.

## Índice

| Documento | O que responde | Status |
|---|---|---|
| [00-visao-e-escopo.md](./00-visao-e-escopo.md) | Por que existe, para quem, o que entra e o que não entra na v1 | ESTÁVEL |
| [01-glossario.md](./01-glossario.md) | Vocabulário único do domínio | ESTÁVEL |
| [02-regras-do-jogo.md](./02-regras-do-jogo.md) | **Como se joga FDP** — 109 regras `RJ-###` | ESTÁVEL |
| [03-maquina-de-estados.md](./03-maquina-de-estados.md) | Ciclo de vida de sala, conexão, partida e rodada + 18 invariantes | ESTÁVEL |
| [04-modelo-de-dados.md](./04-modelo-de-dados.md) | Entidades, estado oculto, matriz de visibilidade | ESTÁVEL |
| [05-contrato-realtime.md](./05-contrato-realtime.md) | Comandos, 27 eventos e 15 erros do WebSocket | ESTÁVEL |
| [06-api-http.md](./06-api-http.md) | Endpoints REST de sala e sessão | ESTÁVEL |
| [07-requisitos-ui.md](./07-requisitos-ui.md) | Telas, fluxos e estados de interface | ESTÁVEL |
| [08-acessibilidade-e-i18n.md](./08-acessibilidade-e-i18n.md) | Requisitos de a11y e idioma | ESTÁVEL |
| [09-nao-funcionais.md](./09-nao-funcionais.md) | Latência, escala, segurança, anti-trapaça | ESTÁVEL |
| [10-criterios-de-aceite.md](./10-criterios-de-aceite.md) | **137 critérios testáveis — a definição de "entregue"** | ESTÁVEL |
| [11-arquitetura-e-stack.md](./11-arquitetura-e-stack.md) | Decisões técnicas e estrutura do repositório | ESTÁVEL |
| [12-roadmap.md](./12-roadmap.md) | Fases de entrega e gates de qualidade | ESTÁVEL |

### Planos

Os documentos `00`–`12` dizem o que o produto **é**. Um plano diz como uma capacidade nova vai
entrar, e vive aqui até virar emenda nos normativos — enquanto for `PROPOSTO`, não manda em
nada.

| Plano | O que propõe | Status |
|---|---|---|
| [plans/01-contas-perfis-e-historico.md](./plans/01-contas-perfis-e-historico.md) | Contas (SSO e e-mail/senha), perfil público, histórico persistente e avatar por imagem. Reverteu `00` §4.2 pela decisão P11 | ENTREGUE (F1–F5 ✅, 26/08/2026) |

## Por onde começar

- **Vai implementar as regras?** `02` → `03` §4 → `10` §4. Nada mais é necessário.
- **Vai implementar a rede?** `05` → `04` → `11` §5.
- **Vai implementar a UI?** `07` → `04` §5 (o que você pode e não pode exibir) → `08`.
- **Quer saber se acabou?** `10`.

## Convenções

Palavras-chave de obrigatoriedade seguem o espírito da RFC 2119:

- **DEVE** / **NÃO DEVE** — requisito obrigatório. Sua ausência reprova a entrega.
- **DEVERIA** — fortemente recomendado; desviar exige justificativa registrada.
- **PODE** — opcional.

Identificadores estáveis, usados para rastrear requisito → teste → código:

| Prefixo | Significado | Onde |
|---|---|---|
| `RF-###` | Requisito funcional | `00`, `07` |
| `RNF-###` | Requisito não funcional | `06`, `08`, `09` |
| `RJ-###` | Regra de jogo | `02` |
| `INV-##` | Invariante de estado | `03` §5 |
| `EV-###` | Evento de realtime | `05` |
| `ERR-###` | Código de erro | `05` §6 |
| `CA-###` | Critério de aceite | `10` |

Ao implementar, referencie o ID no commit e no teste. Um requisito sem teste que cite seu ID é
considerado **não entregue** (RNF-102).

## Definição de "entregue"

O jogo está entregue quando **todos** os 137 critérios de
[10-criterios-de-aceite.md](./10-criterios-de-aceite.md) passam — os automatizados no CI, os
marcados `manual` executados — e o roteiro de aceitação de `10` §8 é cumprido por 4 pessoas
reais em 4 dispositivos distintos.

Dois critérios têm peso desproporcional e valem atenção especial:

- **CA-310 / CA-311** — 1.000 partidas simuladas, com desconexões injetadas, terminam sem
  violar invariante e sem ficar presas em `PAUSADA`. É a prova de que a partida nunca trava.
- **CA-281 / CA-285** — a própria carta de testa não vaza, nem na projeção nem no fio. É a
  prova de que o jogo é honesto.

## Próximo passo

`M0` está concluído. As fases `M1` (fundação de realtime) e `M2` (lobby) podem começar
imediatamente e em paralelo — ver [12-roadmap.md](./12-roadmap.md).
