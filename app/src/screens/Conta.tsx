import { useState } from 'react';
import { criarConta, entrarComSenha, ErroApi, type ContaPublica } from '../net/sessao';
import { Folha } from '../components/Folha';

/**
 * Criar conta ou entrar.
 *
 * **Conta é acréscimo, nunca pedágio** (plano 01, I-1). Esta tela só existe
 * porque alguém a abriu de propósito — nada no caminho de jogar passa por
 * aqui, e a Home continua com "Criar sala" como ação principal.
 *
 * A frase sobre não haver recuperação de senha não é rodapé jurídico: sem
 * confirmação de e-mail (D-5) não existe "esqueci minha senha", e quem
 * descobrir isso depois perde a conta e o histórico junto. Dizer na hora custa
 * uma linha e é a diferença entre uma escolha informada e uma armadilha.
 */
export function Conta({ aoFechar, aoEntrar }: {
  aoFechar: () => void;
  aoEntrar: (conta: ContaPublica) => void;
}) {
  const [modo, setModo] = useState<'entrar' | 'criar'>('entrar');
  const [apelido, setApelido] = useState('');
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const criando = modo === 'criar';
  const podeEnviar =
    email.trim().length > 3 && senha.length >= 10 && (!criando || apelido.trim().length >= 2);

  async function enviar(): Promise<void> {
    setErro(null);
    setOcupado(true);
    try {
      const r = criando
        ? await criarConta({ apelido: apelido.trim(), email: email.trim(), senha })
        : await entrarComSenha(email.trim(), senha);
      aoEntrar(r.conta);
    } catch (e) {
      setErro(e instanceof ErroApi ? mensagem(e.codigo) : 'Não deu para conectar.');
    } finally {
      setOcupado(false);
    }
  }

  return (
    <Folha rotulo={criando ? 'Criar conta' : 'Entrar'} aoFechar={aoFechar}>
      <div role="tablist" aria-label="Conta" style={{ display: 'flex', gap: 6 }}>
        <Aba atual={modo} valor="entrar" aoEscolher={setModo}>Entrar</Aba>
        <Aba atual={modo} valor="criar" aoEscolher={setModo}>Criar conta</Aba>
      </div>

      <p className="fraco" style={{ fontSize: 13 }}>
        Conta guarda seu apelido, seu avatar e o histórico das suas partidas.
        Para jogar não precisa: o link entra direto.
      </p>

      <div className="pilha" style={{ gap: 10 }}>
        {criando && (
          <label className="pilha" style={{ gap: 4 }}>
            <span className="rotulo">apelido</span>
            <input
              value={apelido}
              onChange={(e) => setApelido(e.target.value)}
              maxLength={16}
              autoComplete="nickname"
            />
          </label>
        )}

        <label className="pilha" style={{ gap: 4 }}>
          <span className="rotulo">e-mail</span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            inputMode="email"
          />
        </label>

        <label className="pilha" style={{ gap: 4 }}>
          <span className="rotulo">senha</span>
          <input
            type="password"
            value={senha}
            onChange={(e) => setSenha(e.target.value)}
            autoComplete={criando ? 'new-password' : 'current-password'}
          />
          {/* Comprimento, e só. Exigir maiúscula e símbolo produz senha pior —
              leva a `Senha@123` — e é o que o NIST desaconselha desde 2017. */}
          <span className="fraco" style={{ fontSize: 11 }}>
            {senha.length < 10
              ? `pelo menos 10 caracteres — faltam ${10 - senha.length}`
              : 'boa'}
          </span>
        </label>
      </div>

      {erro && (
        <p role="alert" style={{ color: 'var(--vidas)', fontSize: 13 }}>{erro}</p>
      )}

      <button disabled={!podeEnviar || ocupado} onClick={() => void enviar()}>
        {ocupado ? 'Um instante…' : criando ? 'Criar conta' : 'Entrar'}
      </button>

      {criando && (
        <p className="fraco" style={{ fontSize: 12, textAlign: 'center' }}>
          Ainda não dá para recuperar a senha por e-mail. Se esquecer, a conta
          se perde — guarde num gerenciador de senhas.
        </p>
      )}
    </Folha>
  );
}

/**
 * Mensagens em português, a partir do código do servidor.
 *
 * `CREDENCIAL_INVALIDA` é de propósito a MESMA frase para senha errada e para
 * e-mail que não existe: dizer "não encontramos esse e-mail" entrega quem tem
 * conta aqui, e o perfil é público por link (D-4).
 */
function mensagem(codigo: string): string {
  switch (codigo) {
    case 'CREDENCIAL_INVALIDA': return 'E-mail ou senha não conferem.';
    case 'EMAIL_EM_USO': return 'Já existe uma conta com esse e-mail.';
    case 'EMAIL_INVALIDO': return 'Esse e-mail não parece um e-mail.';
    case 'SENHA_FRACA': return 'A senha precisa de pelo menos 10 caracteres.';
    case 'APELIDO_INVALIDO': return 'Apelido entre 2 e 16 caracteres.';
    case 'RATE_LIMITED': return 'Muitas tentativas. Espere um pouco.';
    case 'CONTAS_INDISPONIVEIS': return 'As contas estão fora do ar. O jogo funciona normalmente.';
    default: return 'Deu errado. Tente de novo.';
  }
}

function Aba<T extends string>({ atual, valor, aoEscolher, children }: {
  atual: T; valor: T; aoEscolher: (v: T) => void; children: React.ReactNode;
}) {
  const ativa = atual === valor;
  return (
    <button
      role="tab"
      aria-selected={ativa}
      className={ativa ? undefined : 'fantasma'}
      onClick={() => aoEscolher(valor)}
      style={{ flex: 1, minHeight: 40 }}
    >
      {children}
    </button>
  );
}
