import { useState } from 'react';
import { criarConta, ErroApi, sairDaConta } from '../net/sessao';
import { mensagemDeConta, SENHA_MINIMA } from '../net/erroDeConta';
import { Folha } from '../components/Folha';
import { CampoSenha } from '../components/CampoSenha';

/**
 * Criar conta, em tela própria.
 *
 * Termina **no login**, e não dentro do jogo. O servidor cria a sessão junto
 * com a conta, então o cadastro encerra essa sessão antes de mandar para
 * "Entrar" — sem isso a pessoa veria um formulário de login já estando
 * autenticada, que é incoerente.
 *
 * O passo extra tem uma razão específica deste produto: **não há recuperação
 * de senha** (D-5 do plano 01). Entrar uma vez com o que se acabou de digitar
 * prova que a senha funciona, e prova enquanto ela ainda está fresca na
 * cabeça. Num serviço com "esqueci minha senha" isso seria só atrito; aqui é a
 * última hora barata de descobrir um erro de digitação.
 */
export function CriarConta({ aoFechar, aoVoltarParaEntrar, aoCriada }: {
  aoFechar: () => void;
  aoVoltarParaEntrar: () => void;
  /** Conta criada: leva para o login, com o e-mail já preenchido. */
  aoCriada: (email: string) => void;
}) {
  const [apelido, setApelido] = useState('');
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [confirmacao, setConfirmacao] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const curta = senha.length < SENHA_MINIMA;
  // Só reclama depois de a pessoa começar a digitar a confirmação: acusar
  // divergência no primeiro caractere é ruído garantido.
  const diverge = confirmacao.length > 0 && confirmacao !== senha;
  const podeEnviar =
    apelido.trim().length >= 2 && email.trim().length > 3 && !curta && confirmacao === senha;

  async function enviar(): Promise<void> {
    if (!podeEnviar || ocupado) return;
    setErro(null);
    setOcupado(true);
    const endereco = email.trim();
    try {
      await criarConta({ apelido: apelido.trim(), email: endereco, senha });
      // A conta nasce com sessão aberta; encerra antes de pedir o login.
      // Falha aqui não desfaz o cadastro, e insistir seria pior — a pessoa
      // segue para o login e a sessão velha morre no primeiro `entrar`.
      await sairDaConta().catch(() => {});
      aoCriada(endereco);
    } catch (e) {
      setErro(e instanceof ErroApi ? mensagemDeConta(e.codigo, e.params) : 'Não deu para conectar.');
      setOcupado(false);
    }
  }

  return (
    <Folha rotulo="Criar conta" aoFechar={aoFechar} cabecalho={<b style={{ fontSize: 15 }}>Criar conta</b>}>
      <p className="fraco" style={{ fontSize: 13 }}>
        Conta guarda seu apelido, seu avatar e o histórico das suas partidas.
        Para jogar não precisa: o link entra direto.
      </p>

      <div className="pilha" style={{ gap: 10 }}>
        <label className="pilha" style={{ gap: 4 }}>
          <span className="rotulo">apelido</span>
          <input
            value={apelido}
            onChange={(e) => setApelido(e.target.value)}
            maxLength={16}
            autoComplete="nickname"
          />
        </label>

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

        <CampoSenha
          rotulo="senha"
          valor={senha}
          aoMudar={setSenha}
          autoComplete="new-password"
          ajuda={
            // Comprimento, e só. Exigir maiúscula e símbolo produz senha pior —
            // leva a `Senha@123` — e é o que o NIST desaconselha desde 2017.
            <span className="fraco" style={{ fontSize: 11 }}>
              {curta
                ? `pelo menos ${SENHA_MINIMA} caracteres — faltam ${SENHA_MINIMA - senha.length}`
                : 'boa'}
            </span>
          }
        />

        <CampoSenha
          rotulo="repita a senha"
          valor={confirmacao}
          aoMudar={setConfirmacao}
          autoComplete="new-password"
          invalido={diverge}
          aoEnter={() => void enviar()}
          ajuda={
            diverge
              ? <span style={{ color: 'var(--vidas)', fontSize: 11 }}>As duas senhas não são iguais.</span>
              : undefined
          }
        />
      </div>

      {/* Não é rodapé jurídico. Sem confirmação de e-mail (D-5) não existe
          "esqueci minha senha", e quem descobrir isso depois perde a conta e o
          histórico junto. Fica ACIMA do botão, onde ainda dá para mudar de
          ideia e entrar pelo Google. */}
      <p style={{
        fontSize: 12, padding: '10px 12px', borderRadius: 'var(--r-md)',
        background: 'rgba(239,77,90,0.10)', boxShadow: 'inset 0 0 0 1px rgba(239,77,90,0.4)',
      }}>
        <b>Ainda não dá para recuperar a senha por e-mail.</b> Se esquecer, a
        conta e o histórico se perdem — guarde num gerenciador de senhas, ou
        entre pelo Google ou GitHub, que nunca ficam sem acesso.
      </p>

      {erro && <p role="alert" style={{ color: 'var(--vidas)', fontSize: 13 }}>{erro}</p>}

      <button disabled={!podeEnviar || ocupado} onClick={() => void enviar()}>
        {ocupado ? 'Criando…' : 'Criar conta'}
      </button>

      <p style={{ textAlign: 'center', fontSize: 13 }}>
        <span className="fraco">Já tem conta? </span>
        <button
          className="fantasma"
          onClick={aoVoltarParaEntrar}
          style={{
            background: 'transparent', boxShadow: 'none', padding: '0 4px',
            minHeight: 'var(--toque)', color: 'var(--acento-claro)',
            textDecoration: 'underline', width: 'auto', display: 'inline',
          }}
        >
          Entrar
        </button>
      </p>
    </Folha>
  );
}
