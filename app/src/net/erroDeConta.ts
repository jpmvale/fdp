/**
 * Códigos do servidor → frase em português, para as telas de conta.
 *
 * Vive fora das telas porque as duas — entrar e cadastrar — recebem os mesmos
 * códigos, e duas cópias divergiriam na primeira mensagem que alguém melhorar
 * só de um lado.
 *
 * `CREDENCIAL_INVALIDA` é de propósito a MESMA frase para senha errada e para
 * e-mail que não existe: dizer "não encontramos esse e-mail" entrega quem tem
 * conta aqui, e o perfil é público por link (D-4 do plano 01).
 */
export function mensagemDeConta(codigo: string, params?: Record<string, unknown>): string {
  switch (codigo) {
    case 'CREDENCIAL_INVALIDA': return 'E-mail ou senha não conferem.';
    // RF-063. Dizer "senha inválida" aqui é o comportamento fácil, e o que faz
    // a pessoa tentar cinco vezes e ir embora achando que é bug.
    case 'CONTA_MIGRADA_PARA_SSO': {
      const lista = Array.isArray(params?.['provedores']) ? params['provedores'] as string[] : [];
      const nome = lista.includes('google') ? 'Google' : lista.includes('github') ? 'GitHub' : 'outro serviço';
      return `Esta conta agora entra pelo ${nome}. Use o botão acima.`;
    }
    case 'EMAIL_EM_USO': return 'Já existe uma conta com esse e-mail.';
    case 'EMAIL_INVALIDO': return 'Esse e-mail não parece um e-mail.';
    case 'SENHA_FRACA': return 'A senha precisa de pelo menos 10 caracteres.';
    case 'APELIDO_INVALIDO': return 'Apelido entre 2 e 16 caracteres.';
    case 'RATE_LIMITED': return 'Muitas tentativas. Espere um pouco.';
    case 'CONTAS_INDISPONIVEIS': return 'As contas estão fora do ar. O jogo funciona normalmente.';
    default: return 'Deu errado. Tente de novo.';
  }
}

/** Mínimo de caracteres da senha, espelhando `senhaAceitavel` no servidor. */
export const SENHA_MINIMA = 10;
