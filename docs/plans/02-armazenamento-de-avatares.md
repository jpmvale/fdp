# Plano 02 — Armazenamento de avatares

Status: **NO AR** desde 27/08/2026 · F1 a F4 implantadas · falta só o gate de RNF-019 · Aberto em 26/08/2026

Os 32 avatares foram conferidos contra o próprio hash (**nenhum corrompido**),
copiados para `fdp-avatares`, e a aplicação lê de lá desde 27/08/2026. Falta o
gate de **RNF-019**: restaurar o backup do bucket uma vez, para valer. Até isso
acontecer, o volume `fdp_avatares` continua montado como rede de segurança.

Tira as fotos de avatar do disco do container e as põe num bucket R2, com backup
e com o pipeline calibrado por medição em vez de suposição.

---

## 1. Por que agora

O gatilho honesto não é arquitetura. É que **as fotos não têm backup nenhum**.

O Postgres tem: dump diário, restauração testada uma vez num banco vazio (plano
01, F1). Os avatares vivem num volume Docker na VPS, e o que existe sobre eles é
uma linha no `compose` dizendo que o volume não é opcional. Se aquele volume for
embora — disco, um `docker volume prune` distraído, a máquina trocada — todo
mundo perde a foto e não há de onde trazer de volta.

Isso não é hipótese: o volume já foi esquecido uma vez no desenho e entrou no
`compose` depois, justamente porque o container é recriado a cada deploy.

O segundo motivo é que já usamos R2 nos outros serviços da VPS, então a decisão
de fornecedor não está sendo tomada aqui — está sendo repetida.

E o terceiro apareceu enquanto este plano era escrito: **o envio de avatar
nunca tinha funcionado em produção**. A causa não era nada do pipeline — era o
volume montado como `root` com o processo rodando como `node`. Ver §12.

## 2. O que já foi corrigido, e o que sobrou

Quatro coisas quebravam o envio. As três primeiras eram do pipeline e estavam
todas erradas; **nenhuma delas era a causa** de o envio nunca ter funcionado.
Essa era a quarta, e está na §12. Ficam
aqui porque são a evidência de que a régua deste subsistema foi escrita sem
medição, que é o que este plano quer corrigir de vez.

| O quê | Estava | Ficou |
|---|---|---|
| Orçamento de envio | Gastava o de cadastro: 10/h **por IP**, contando tentativas recusadas | 30/h **por conta** (RNF-017) |
| Teto de bytes | 5 MB — abaixo de um JPEG de 12 MP comum | 25 MB, num único lugar (`LIMITS.avatarBytesMax`) |
| Teto de pixels | 4096² = 16,7 MP — recusava 48, 50 e 108 MP | 16 000² = 256 MP (CA-391) |
| **Gravação** | Volume `root`, processo `node` — **EACCES em tudo, sempre** | `chown` na imagem + sonda na subida (§12) |

O teto de pixels é o que mais ensina. Ele existia contra a bomba de
descompressão, e a bomba é real. Mas o número saiu de uma conta ingênua —
largura × altura × 4 bytes — que **não descreve como o `libvips` funciona**.

Medido (macOS, libvips 8.18.6, saída de 256 px):

| Entrada | Tempo | RSS |
|---|---|---|
| JPEG 108 MP (foto de 4 MB) | 95 ms | +9 MB |
| PNG chapado 64 MP (bomba) | 71 ms | +41 MB |
| PNG chapado 256 MP (bomba) | 249 ms | +45 MB |

Duas coisas que a conta ingênua não previa. O `libvips` processa em **tiles** e
nunca segura o bitmap inteiro — por isso 256 MP custam 45 MB, e não o gigabyte e
meio da multiplicação. E o JPEG tem **shrink-on-load**: pedindo 256 px de saída,
o decodificador lê em escala reduzida, e a foto de 108 MP sai **mais barata que
a bomba de 64 MP**.

O teto quase não separava o caro do barato. Separava fotos reais de fotos reais.

> A lição, que vale além deste arquivo: um limite escolhido para proteger contra
> um ataque precisa ser medido **contra o ataque e contra o uso legítimo**. Este
> foi medido contra nenhum dos dois, e o resultado foi um subsistema que barrava
> usuários sem barrar o atacante na proporção que se imaginava.

O que sobrou para este plano é o armazenamento, e os três itens da §6.

## 3. O que este plano NÃO muda

- **O processamento continua no servidor.** D-9 segue de pé, e a razão dele não
  era custo: é que "a imagem já veio pequena" é afirmação do cliente, e o
  cliente é quem ataca. R2 muda onde o resultado é guardado, nunca quem decide
  o que ele é.
- **O nome continua sendo o sha256 do RESULTADO.** É o que faz reenviar ser
  idempotente, duas pessoas com a mesma foto dividirem um arquivo, e o cache
  poder ser imutável. A chave no bucket é esse mesmo nome.
- **O emoji e a cor continuam por baixo.** A imagem é um campo a mais no avatar,
  não uma união (plano 01 §10). Com R2 isso importa mais, não menos: um bucket
  inacessível precisa degradar para o emoji, não para um buraco.
- **Nada disso pode exigir conta para jogar.** I-1.

## 4. A decisão de desenho

**Uma interface, duas implementações, uma suíte de contrato.** O mesmo caminho
de `RoomStore` (memória e Redis) e de `@fdp/contas` (memória e Postgres), e pelo
mesmo motivo: é o que permite rodar e testar sem infraestrutura, e é o que já
provou pegar divergência entre implementações duas vezes neste projeto.

```ts
export interface DepositoDeAvatares {
  /** Grava, se ainda não existir. Idempotente pelo nome. */
  guardar(nome: string, bytes: Buffer): Promise<void>;
  /** `undefined` quando não existe — nunca lança por ausência. */
  ler(nome: string): Promise<Buffer | undefined>;
  apagar(nome: string): Promise<void>;
}
```

> O rascunho deste plano trazia um terceiro parâmetro `tipo` em `guardar`. Ele
> saiu na implementação: **todo** avatar é WebP por construção, porque
> `processarAvatar` reescreve tudo nesse formato antes de chegar aqui. Um
> parâmetro que só admite um valor não é flexibilidade, é um lugar a mais onde
> alguém pode passar outra coisa.

Três métodos, e `ler` existe por uma razão específica que vale registrar: **a
alternativa era servir por URL assinada ou por domínio público do R2, e as duas
vazam o fornecedor para dentro do HTML.** Servindo pelo nosso `/avatares/:nome`
como hoje, trocar de bucket um dia não muda uma linha do cliente, e a CSP não
precisa de origem externa nova. O custo é a latência de um GET a mais, resolvida
por cache — ver §5.

Implementações: `DepositoEmDisco` (o que existe hoje, extraído) e `DepositoR2`
(S3 compatível). A suíte de contrato roda nas duas; a do R2 só com as variáveis
presentes, e o CI confere que ela **de fato rodou** — como já é feito com Redis
e Postgres, porque suíte pulada em silêncio é suíte que não existe.

## 5. O cache, que é o que torna isto viável

Sem cache, cada assento na mesa vira um GET no R2 a cada render. Com 8 jogadores
numa partida de 40 minutos isso é absurdo, e é cobrado.

Três camadas, da mais barata para a mais cara:

1. **`Cache-Control: public, max-age=31536000, immutable`** na resposta. O nome é
   o hash do conteúdo, então o arquivo naquele endereço nunca muda — esta é a
   situação exata para a qual `immutable` foi inventado. O navegador nem pergunta.
2. **Cache em memória no processo**, pequeno e limitado por bytes, não por
   número de itens. Um avatar de 256 px em WebP tem alguns KB; um teto de 32 MB
   guarda milhares e é irrelevante ao lado do resto.
3. **O R2**, só quando as duas primeiras erram.

A camada 2 precisa de teto **por bytes** e não por contagem, e vale dizer por
quê: o tamanho de cada item aqui é conhecido e pequeno, mas contar itens é o
tipo de escolha que envelhece mal no dia em que alguém guardar a variante grande
junto.

## 6. Migração, e o que fazer com o que já está lá

Existem avatares no volume hoje, e eles pertencem a pessoas reais.

**Nada de "copia tudo e reza".** A ordem:

1. Escrever nos **dois** (disco e R2) durante uma janela, lendo ainda do disco.
   Falha no R2 não derruba envio nesta fase — ela é registrada.
2. Copiar o que já existia, conferindo o hash de cada arquivo contra o nome dele.
   Um arquivo cujo conteúdo não bate com o próprio nome é corrupção, e precisa
   aparecer, não ser copiado por cima.
3. Passar a ler do R2, com o disco como reserva silenciosa.
4. Só então parar de escrever no disco.

O passo 2 é onde mora o valor real: é a **primeira vez** que os avatares
guardados vão ser verificados. O hash no nome torna isso trivial, e é a segunda
vez neste projeto que essa escolha se paga.

## 7. Requisitos e critérios

IDs livres: **RF-080+**, **RNF-018+**, **CA-392+**. Nenhum `RJ-###` — I-2.

| ID | Requisito (rascunho) |
|---|---|
| RF-080 | Avatares vivem num depósito com interface própria; disco e R2 são implementações da mesma |
| RF-081 | A foto continua sendo servida pela **nossa** origem, nunca por URL do fornecedor |
| RF-082 | Bucket indisponível degrada para o emoji, nunca para um buraco na mesa |
| RNF-018 | Resposta de `/avatares/:nome` com `immutable` e cache em processo com teto em bytes |
| RNF-019 | Backup dos avatares com restauração **testada uma vez, para valer** — o gate é o mesmo do Postgres |

| ID | Critério |
|---|---|
| CA-392 | A suíte de contrato passa idêntica em disco e em R2; o CI recusa o build se a do R2 não rodou |
| CA-393 | Bucket fora do ar: o envio falha com motivo próprio e a mesa continua, com o emoji no assento |
| CA-394 | Um arquivo cujo conteúdo não bate com o hash do nome é **denunciado**, nunca copiado |
| CA-395 | Duas contas enviando a mesma foto continuam dividindo um objeto só |

## 8. Fases

**F1 — A interface e o depósito em disco.** ✅ **Implementada.** Extrair o que existe para trás de
`DepositoDeAvatares`, com a suíte de contrato escrita contra a interface.
*Gate:* comportamento idêntico ao de hoje, provado pela suíte que já existe;
nenhuma mudança visível em produção.

**F2 — Cache e servir.** ✅ **Implementada.** As três camadas da §5, com a resposta `immutable`.
*Gate:* um avatar pedido duas vezes não toca o depósito na segunda; medido, não
suposto.

**F3 — R2.** ✅ **Implementada.** A segunda implementação, e a escrita dupla da §6.
*Gate:* CA-392 verde no CI, com a suíte do R2 comprovadamente executada.

**F4 — Migração e corte.** ✅ **Feita em 27/08/2026** (o gate de RNF-019 continua aberto). Os passos 2 a 4 da §6.
*Gate:* RNF-019 — o backup restaurado uma vez, num bucket vazio, com os hashes
conferidos. Sem isso, F4 não fecha: era exatamente essa a lacuna que abriu este
plano.

## 9. O que este plano deixa em aberto

- **Moderação.** Continua sem caminho de denúncia (plano 01 §13.2). R2 não muda
  isso; muda só que banir um arquivo passa a ser apagar um objeto. Vira urgente
  se a mesa deixar de ser um grupo de amigos.
- **HEIC.** A foto padrão do iPhone continua recusada, com frase que diz o que
  fazer (CA-389). Aceitar exige um `libvips` com decodificador de HEVC — decisão
  de licença e de imagem de container, não de código. Se entrar um dia, entra
  por aqui, porque é a mesma imagem que precisaria mudar.
- **Redução no cliente antes de enviar.** Hoje sobe a foto inteira: com o teto em
  25 MB isso é lento no 4G, e o resultado é um quadrado de 256 px. Reduzir antes
  de enviar economiza o dado de quem joga pelo celular — que é quase todo mundo.
  **Não é substituto de nada:** o servidor continua processando e validando
  (D-9). É comodidade, e por isso não entrou nas fases; entra quando alguém
  reclamar da espera.


---

## 10. O que a implementação mudou no plano

Três coisas que o plano não previa e a escrita revelou.

**A assinatura é nossa, e a prova dela é um servidor de verdade.** O plano dizia
"R2 (S3 compatível)" sem dizer como. `@aws-sdk/client-s3` traria dezenas de
pacotes para três verbos sem query nem listagem, num projeto com oito
dependências de produção. SigV4 é um procedimento fechado e público, e são umas
oitenta linhas — mas escrever assinatura à mão só se defende se houver prova.

A prova NÃO é um vetor de referência colado num `expect`. Tentei esse caminho e
parei: colar um número que eu "lembrava" não prova nada, e a documentação da AWS
publica o algoritmo com a assinatura substituída por um marcador. A prova é a
suíte de contrato inteira rodando contra **MinIO**, que fala S3 — um vetor
confere um caso, um servidor confere o protocolo. Está no CI, e é obrigatória
(CA-392).

**`ler` não podia ficar dentro do `try` do processamento.** Com a gravação lá
dentro, um bucket fora do ar saía como `FALHA_AO_PROCESSAR` — *"não consegui
abrir essa imagem, ela pode estar corrompida"*. A pessoa procuraria o defeito na
própria foto, trocaria de imagem, e a segunda falharia igual. É a mesma família
do `PROTOCOL_VERSION` que derrubou o jogo: a mensagem mandava investigar o lugar
errado. Virou `DEPOSITO_INDISPONIVEL`, com 503 e não 4xx — 4xx diria que o
problema é do que a pessoa mandou.

**O contrato pegou um bug meu antes de qualquer produção.** O teste de gravações
simultâneas do mesmo nome derrubou a primeira versão do depósito em disco: o
rascunho temporário levava o `pid`, e cinco chamadas do mesmo processo dividem o
pid. Duas fotos chegando juntas numa mesa de oito é o caso comum, não uma corrida
exótica. O rascunho passou a ser único por chamada.

Fica registrado porque é o argumento inteiro a favor da suíte de contrato: ela
não existe para provar que o R2 funciona, existe para que a implementação
**simples** — a que todo mundo assume estar certa — seja cobrada do mesmo jeito.

## 11. Como rodar e migrar

```bash
# O outro lado, para desenvolver e testar:
docker run --rm -p 9100:9000 \
  -e MINIO_ROOT_USER=fdpteste -e MINIO_ROOT_PASSWORD=fdptestesenha \
  minio/minio server /data

R2_ENDPOINT=http://127.0.0.1:9100 R2_BUCKET=avatares \
R2_ACCESS_KEY_ID=fdpteste R2_SECRET_ACCESS_KEY=fdptestesenha npm test
```

Migrar (ensaio primeiro — sem `--aplicar` nada é escrito):

```bash
AVATARES_DIR=/dados/avatares \
R2_ENDPOINT=... R2_BUCKET=... R2_ACCESS_KEY_ID=... R2_SECRET_ACCESS_KEY=... \
npx tsx server/src/migrar-avatares.ts
```

O ensaio roda a **conferência inteira** sem tocar no destino, e é essa a
informação que interessa antes de copiar: se há avatar corrompido no volume, dá
para saber sem escrever um byte. Corrupção falha o script de propósito, mesmo
com todo o resto tendo copiado — os íntegros já foram, e rodar de novo é
inofensivo porque a migração é idempotente.


---

## 12. A causa que nenhuma medição do pipeline ia achar

Depois de consertar o orçamento, o teto de bytes e o teto de pixels, o envio de
avatar **continuava falhando em produção** — e continuava porque nenhum dos três
era o problema.

O `Dockerfile` tem `USER node`. O `docker-compose.prod.yml` monta um volume
nomeado em `/var/lib/fdp/avatares`, um caminho que **não existia na imagem** —
e o Docker cria caminho ausente como `root:root 0755`. O usuário `node` não
escreve nele. Toda gravação morria com `EACCES`, desde o primeiro dia.

**Este plano é o que tornou isso visível.** Antes dele, a gravação vivia dentro
do `try` do processamento de imagem e o `catch` traduzia tudo para
`FALHA_AO_PROCESSAR` — *"não consegui abrir essa imagem, ela pode estar
corrompida"*. Quem enviava ia procurar defeito na própria foto. Separar
`DEPOSITO_INDISPONIVEL` (§10, RF-082) foi feito por argumento de desenho, e o
retorno veio no mesmo dia: a frase certa apareceu na tela e a causa ficou
localizável em minutos.

> Vale registrar porque é o argumento inteiro a favor de mensagens de erro que
> distinguem *quem* falhou. Não é cortesia com o usuário: é o que decide se as
> próximas horas de investigação vão para o arquivo dele ou para a nossa
> infraestrutura. Três consertos reais e corretos foram feitos no lugar errado
> antes disso.

O conserto é `mkdir -p` + `chown -R node:node` antes de `USER node`, e o Docker
semeia a dona do diretório da imagem num volume **vazio** — o que alcança o
volume que já está na VPS, justamente porque nenhuma gravação jamais deu certo.
Com conteúdo dentro não alcança, e aí é `chown` na mão (ver HANDOFF).

E RNF-020: uma **sonda de escrita** na subida, que grava, lê, confere e apaga.
O defeito esteve a um `touch` de distância de ser descoberto por semanas, e o
que faltava era alguém dar o `touch`.

**Confirmado em produção em 27/08/2026**, por envio real: o avatar sobe, é
gravado e é servido. Primeira vez desde que a funcionalidade existe.

Isto **não** enfraquece o plano: reforça a §1. Um subsistema cujo armazenamento
nunca foi exercitado por nada além do caminho feliz de produção é exatamente o
que fica anos quebrado sem ninguém saber — e as fotos continuam sem backup.
