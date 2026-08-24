# Handoff

Estado do projeto para retomar depois. **Próximo foco: a interface.**

Última sessão: 24/08/2026. Validado local com partida completa entre 3 conexões.

## Como rodar

```bash
npm install
npm start        # http://localhost:3000
npm test         # 137 testes
npm run typecheck
```

Para jogar sozinho: abra a URL em **2 ou 3 abas anônimas**. Numa você cria a sala,
nas outras entra com o código, e o host inicia.

Para parar: `pkill -f "tsx server"`.

## O que está pronto e é definitivo

| Pacote | O quê |
|---|---|
| `packages/rules` | Motor de regras puro e determinístico. 110 regras `RJ-###` implementadas |
| `packages/store` | `RoomStore` de 6 métodos + implementação em memória |
| `packages/protocol` | Contrato cliente ↔ servidor, tipos e validação separados |
| `packages/room` | Máquina de sala: ciclo de vida, conexão, pausa, timers, auto-play |

Esses quatro são o núcleo e não devem mudar por causa da UI. Todo o comportamento
do jogo já está lá, testado e coberto por critério de aceite.

## O que é provisório e será substituído

O `server/` e o `app/` de hoje existem para **provar que as mecânicas funcionam no
navegador**, não como produto. O que precisa ser refeito:

| Item | Situação hoje | Precisa virar |
|---|---|---|
| `app/index.html` | HTML único, sem build, deliberadamente feio | Cliente Vite + React de `07`, com design system |
| Reconciliação | Cliente pede o estado inteiro a cada evento | Aplicar eventos incrementais + resync só em buraco de versão (`05` §3) |
| Sessão | Token aleatório num `Map` em memória | JWT assinado, escopado à sala, com expiração (`06` §4) |
| Persistência | Nenhuma — cai com o processo | `RoomStore` em Redis, mesma suíte de contrato da versão em memória |
| Rate limit | Não existe | RNF-010 (WebSocket) e RNF-003 (HTTP) |
| Desligamento | Abrupto | `SIGTERM` fecha sockets com código de "reconecte" e persiste (RNF-065) |

Nada disso bloqueia o trabalho de UI: o protocolo e os eventos já estão no formato
final.

## Verificado funcionando no navegador

- Rodada de testa: cada aba vê as cartas dos outros e um verso no próprio lugar.
  O servidor nunca envia a carta do observador.
- Aposta proibida aparece desabilitada, com a razão escrita — ninguém descobre a
  restrição errando.
- Fechar uma aba: nada acontece por 10 s (carência de transporte); passou disso, a
  mesa pausa nomeando quem caiu; reabrir retoma sozinho.
- Auto-play dispara para quem está conectado e não age, e é anunciado.
- Partida completa de 5 rodadas entre 3 jogadores, com vencedor correto nas 3 telas.

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
- **Paleta de 8 cores de avatar** distinguíveis sob deuteranopia e protanopia — é
  como se identifica quem é quem na mesa.
- Cor **nunca** como único canal: todo estado precisa de ícone ou texto junto.
- Orçamento: bundle inicial ≤ 180 KB comprimido (RNF-055), verificado no CI.

Requisitos normativos completos em [`docs/07-requisitos-ui.md`](docs/07-requisitos-ui.md).

## Pendências fora da UI

**VPS (Hostinger).** A arquitetura de `docs/11` assume um processo Node persistente
atrás do Caddy, com Redis local. Para configurar, falta:

1. Host e usuário — a chave SSH está no Mac do usuário, não nesta máquina
2. Domínio apontando para a VPS (o Caddy precisa dele para o TLS automático)
3. Saída de `ssh <host> "nproc; free -h; df -h /; cat /etc/os-release | head -2"`

Depois disso: `deploy/Caddyfile`, `deploy/fdp.service` e o README de instalação.

**Vercel foi descartada** por custo do Redis gerenciado. A integração foi removida e
o projeto desvinculado — não há nada sendo cobrado. A VPS acabou sendo a escolha
melhor de qualquer forma: elimina o fan-out entre instâncias e a reciclagem de
socket por teto de duração de função (`docs/11` §3).

## Decisões que valem lembrar

- **`docs/` é a fonte da verdade.** 110 regras, 139 critérios de aceite e 18
  invariantes, todos com ID estável e rastreados até o teste que os cobre. Requisito
  sem teste que cite seu ID é requisito não entregue.
- **Mutação de sala não pode conter `await`** (`docs/11` §5). É o que dá atomicidade
  de graça no laço de eventos do Node. Quebrar isso reintroduz corrida silenciosa.
- **Eventos com estado oculto saem já projetados, um por destinatário.** A camada de
  transporte não sabe o que esconder e por isso não pode errar nisso.
- **Os testes de propriedade acharam 3 bugs** que revisão de código não pegaria:
  carta de testa contada duas vezes; partida encerrada mantendo "jogador da vez"
  num jogador que saiu; e `match:started` saindo antes de existir carta. Manter
  esses testes rodando importa mais do que parece.
- **Licença MIT** foi escolha minha, não do usuário. Trocar se ele preferir.
