import { useEffect, useState } from 'react';
import { entrarComSenha, ErroApi, irParaSso, provedoresDeSso, type ContaPublica } from '../net/sessao';
import { mensagemDeConta, SENHA_MINIMA } from '../net/erroDeConta';
import { Folha } from '../components/Folha';
import { CampoSenha } from '../components/CampoSenha';
import { MARCA } from '../components/IconesSso';

/**
 * Entrar.
 *
 * **Conta é acréscimo, nunca pedágio** (plano 01, I-1). Esta tela só existe
 * porque alguém a abriu de propósito — nada no caminho de jogar passa por
 * aqui, e a Home continua com "Criar sala" como ação principal.
 *
 * Entrar e cadastrar eram abas na mesma tela. Viraram duas telas porque são
 * dois momentos diferentes: quem volta quer o caminho mais curto para dentro, e
 * quem nunca entrou precisa ler o que está aceitando. A aba fazia as duas
 * coisas competirem pelo mesmo espaço e empurrava o aviso sobre recuperação de
 * senha para o rodapé de uma tela que ninguém estava lendo.
 */
export function Conta({ emailInicial, recado, aoFechar, aoCriarConta, aoEntrar }: {
  /** Vem do cadastro recém-concluído, para não redigitar. */
  emailInicial?: string | undefined;
  recado?: string | undefined;
  aoFechar: () => void;
  aoCriarConta: () => void;
  aoEntrar: (conta: ContaPublica) => void;
}) {
  const [email, setEmail] = useState(emailInicial ?? '');
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [provedores, setProvedores] = useState<string[]>([]);

  // Só desenha botão de provedor que existe de fato: um "Entrar com Google"
  // que devolve 503 é pior que não oferecer nada.
  useEffect(() => { void provedoresDeSso().then(setProvedores); }, []);

  const podeEnviar = email.trim().length > 3 && senha.length > 0;

  async function enviar(): Promise<void> {
    if (!podeEnviar || ocupado) return;
    setErro(null);
    setOcupado(true);
    try {
      const r = await entrarComSenha(email.trim(), senha);
      aoEntrar(r.conta);
    } catch (e) {
      setErro(e instanceof ErroApi ? mensagemDeConta(e.codigo, e.params) : 'Não deu para conectar.');
    } finally {
      setOcupado(false);
    }
  }

  return (
    <Folha rotulo="Entrar" aoFechar={aoFechar} cabecalho={<b style={{ fontSize: 15 }}>Entrar</b>}>
      {recado && (
        <p role="status" style={{
          fontSize: 13, padding: '10px 12px', borderRadius: 'var(--r-md)',
          background: 'rgba(63,185,138,0.14)', boxShadow: 'inset 0 0 0 1px rgba(63,185,138,0.5)',
        }}>
          {recado}
        </p>
      )}

      <p className="fraco" style={{ fontSize: 13 }}>
        Conta guarda seu apelido, seu avatar e o histórico das suas partidas.
        Para jogar não precisa: o link entra direto.
      </p>

      {/* O SSO vem PRIMEIRO, e não por moda.

          Sem confirmação de e-mail não existe recuperação de senha (§8 do
          plano 01): quem entra pelo Google nunca fica sem acesso, e quem
          escolhe senha assume um risco que o cadastro avisa. Pôr o caminho
          seguro na frente é a única recomendação que a ordem dos botões
          consegue fazer. */}
      {provedores.length > 0 && (
        <div className="pilha" style={{ gap: 8 }}>
          {provedores.map((p) => {
            const marca = MARCA[p];
            return (
              <button
                key={p}
                className="fantasma"
                onClick={() => irParaSso(p, location.pathname + location.search)}
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10 }}
              >
                {marca ? <marca.Icone /> : null}
                Entrar com {marca?.nome ?? p}
              </button>
            );
          })}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ flex: 1, height: 1, background: 'var(--linha)' }} />
            <span className="fraco">ou com e-mail</span>
            <span style={{ flex: 1, height: 1, background: 'var(--linha)' }} />
          </div>
        </div>
      )}

      <div className="pilha" style={{ gap: 10 }}>
        <label className="pilha" style={{ gap: 4 }}>
          <span className="rotulo">e-mail</span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void enviar(); }}
            autoComplete="email"
            inputMode="email"
          />
        </label>

        <CampoSenha
          rotulo="senha"
          valor={senha}
          aoMudar={setSenha}
          autoComplete="current-password"
          aoEnter={() => void enviar()}
        />
      </div>

      {erro && <p role="alert" style={{ color: 'var(--vidas)', fontSize: 13 }}>{erro}</p>}

      <button disabled={!podeEnviar || ocupado} onClick={() => void enviar()}>
        {ocupado ? 'Um instante…' : 'Entrar'}
      </button>

      {/* Link, e não terceiro botão: cadastrar é a ação de quem NÃO é o público
          desta tela, e competir em peso com "Entrar" atrapalharia os dois. */}
      <p style={{ textAlign: 'center', fontSize: 13 }}>
        <span className="fraco">Não tem conta? </span>
        <button
          className="fantasma"
          onClick={aoCriarConta}
          style={{
            background: 'transparent', boxShadow: 'none', padding: '0 4px',
            minHeight: 'var(--toque)', color: 'var(--acento-claro)',
            textDecoration: 'underline', width: 'auto', display: 'inline',
          }}
        >
          Criar conta
        </button>
      </p>

      <p className="fraco" style={{ fontSize: 11, textAlign: 'center' }}>
        A senha precisa de pelo menos {SENHA_MINIMA} caracteres.
      </p>
    </Folha>
  );
}
