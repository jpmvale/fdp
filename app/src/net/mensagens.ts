/**
 * Motivos do servidor → frase em português.
 *
 * O servidor fala em constantes (`RODADA_OU_VAZA_ANTIGA`) porque elas são
 * estáveis, comparáveis e rastreáveis até o teste. O jogador não fala isso.
 * Sem esta tradução o erro aparece na tela como grito de máquina — foi o que
 * apareceu na primeira partida contra bots, e é o tipo de coisa que passa
 * despercebida porque só acontece em corrida.
 *
 * Motivo desconhecido cai numa frase genérica em vez de mostrar a constante:
 * um erro que ninguém previu ainda não é motivo para vazar vocabulário
 * interno.
 */
const FRASES: Record<string, string> = {
  // Corrida entre a tela e a mesa — comum, e sem gravidade.
  RODADA_OU_VAZA_ANTIGA: 'Essa jogada já passou. A mesa andou.',
  PARTIDA_ANTIGA: 'Essa partida já acabou.',
  NAO_E_SUA_VEZ: 'Ainda não é a sua vez.',
  FASE_ERRADA: 'Não dá para fazer isso agora.',

  // Jogada inválida.
  APOSTA_FORA_DO_INTERVALO: 'Essa aposta não existe nesta rodada.',
  CARTA_NAO_ESTA_NA_MAO: 'Você não tem mais essa carta.',
  JOGADOR_INATIVO: 'Você não está mais nesta partida.',

  // Sala.
  SALA_LOTADA: 'A mesa está cheia: são no máximo 8.',
  ESPECTADORES_LOTADOS: 'Já tem gente demais assistindo.',
  BOTS_DEMAIS: 'Sete bots é o teto.',
  SALA_ENCERRADA: 'Esta sala não existe mais.',
  SO_NO_LOBBY: 'Isso só dá para fazer antes de a partida começar.',
  JOGADORES_INSUFICIENTES: 'Faltam jogadores: são precisos 2.',
  SO_BOTS_NA_MESA: 'Só há bots na mesa. Sente-se para começar.',
  FALTA_PRONTO: 'Ainda falta gente dar pronto.',
  ESPECTADOR_NAO_JOGA: 'Quem está assistindo não precisa dar pronto.',
  // RF-095. A frase diz o ESTADO e quem o desfaz — "não foi possível enviar"
  // faria a pessoa tentar de novo achando que foi a rede.
  SILENCIADO: 'O host silenciou você no chat desta mesa.',
  HOST_NAO_SE_SILENCIA: 'O host não pode se silenciar.',
  BOT_NAO_ASSISTE: 'Bot não assiste — ele joga ou sai.',
  COMANDO_EXIGE_HOST: 'Só quem é host pode fazer isso.',
  HOST_NAO_SE_EXPULSA: 'Você não pode se expulsar.',
  NAO_E_BOT: 'Esse jogador não é um bot.',
  JOGADOR_DESCONHECIDO: 'Esse jogador não está na sala.',

  // Identidade na mesa. Na entrada o servidor desempata sozinho (CA-006); ao
  // EDITAR o perfil ele recusa, porque aí a escolha é deliberada.
  APELIDO_TOMADO: 'Esse apelido já é de outra pessoa na mesa.',
  EMOJI_TOMADO: 'Esse emoji já é de outra pessoa na mesa.',
  COR_TOMADA: 'Essa cor já é de outra pessoa na mesa.',

  // Pausa.
  PARTIDA_PAUSADA: 'A partida está pausada.',
  DECISAO_AINDA_BLOQUEADA: 'Ainda dá tempo de ele voltar. Espere um pouco.',
  NINGUEM_AUSENTE: 'Não há ninguém ausente.',
  SEM_PAUSA: 'A partida não está pausada.',
  SEM_PARTIDA: 'Não há partida em andamento.',
  SEM_FIM_DE_PARTIDA: 'A partida ainda não acabou.',
  JOGADOR_SAIU: 'Esse jogador saiu da sala.',

  // O cliente é velho demais para este servidor. Quem mostra isto é o
  // bloqueio de conexão; a frase fica aqui para o caso de o quadro chegar por
  // um caminho que não passe por ele.
  PROTOCOL_VERSION: 'Esta página está desatualizada. Recarregue para continuar.',

  // Limites de `05` §7.
  RATE_LIMITED: 'Devagar — muitos comandos de uma vez.',
  MENSAGEM_INVALIDA: 'Essa mensagem não vai: vazia ou longa demais.',
  RAPIDO_DEMAIS: 'Espere um segundo entre uma mensagem e outra.',
};

export const frase = (motivo: string | undefined, codigo: string): string =>
  (motivo && FRASES[motivo]) ?? FRASES[codigo] ?? 'Não deu certo. Tente de novo.';
