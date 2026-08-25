import type { EstadoConexao } from '../net/socket';

/**
 * `07` §2.6: cinco estados, e cada um bloqueia uma coisa diferente.
 *
 * A distinção que importa é entre o que o jogador PODE resolver e o que ele só
 * pode esperar. Reconectando é espera — a mesa segue visível, ele acompanha o
 * que perdeu. Sessão em outra aba e sala encerrada são becos: exigem ação, e
 * mostrar isso como uma faixinha sem botão deixa a pessoa presa olhando um
 * aviso que não a leva a lugar nenhum.
 */

/** Estados que não impedem de jogar: uma faixa acima da mesa e nada mais. */
export function FaixaConexao({ estado }: { estado: EstadoConexao }) {
  if (estado === 'CONECTADO' || bloqueia(estado)) return null;

  const texto = estado === 'CONECTANDO'
    ? 'Conectando…'
    : 'Reconectando você à mesa — a mesa continua aí, você acompanha o que perdeu.';

  return (
    <div
      role="status"
      style={{
        padding: '9px 12px',
        borderRadius: 'var(--r-md)',
        background: 'rgba(145,132,217,0.12)',
        boxShadow: 'inset 0 0 0 1px var(--acento)',
        fontSize: 13,
        display: 'flex',
        gap: 8,
        alignItems: 'center',
      }}
    >
      <span aria-hidden>{estado === 'CONECTANDO' ? '◐' : '↻'}</span>
      <span>{texto}</span>
    </div>
  );
}

export const bloqueia = (estado: EstadoConexao): boolean =>
  estado === 'SESSAO_ASSUMIDA' || estado === 'ENCERRADA' || estado === 'DESATUALIZADO';

/**
 * Os três estados que exigem ação. Cada um vem com a saída junto — um beco sem
 * botão é o mesmo que travar a pessoa.
 */
export function BloqueioConexao({ estado, codigo, aoJogarAqui, aoVoltar }: {
  estado: EstadoConexao;
  codigo: string | null;
  aoJogarAqui: () => void;
  aoVoltar: () => void;
}) {
  if (!bloqueia(estado)) return null;

  const conteudo = {
    SESSAO_ASSUMIDA: {
      icone: '⧉',
      titulo: 'Você abriu a partida em outra aba',
      corpo: 'Só uma pode jogar. Se a mesa está aqui, é só retomar.',
      acao: 'Jogar aqui',
      aoAgir: aoJogarAqui,
      cheia: false,
    },
    ENCERRADA: {
      icone: '✕',
      titulo: codigo ? `A sala ${codigo} foi encerrada` : 'A sala foi encerrada',
      corpo: 'Nada mais acontece aqui.',
      acao: 'Voltar ao início',
      aoAgir: aoVoltar,
      cheia: true,
    },
    DESATUALIZADO: {
      icone: '↻',
      titulo: 'O jogo foi atualizado',
      corpo: 'Recarregue para voltar à mesa. Sua cadeira fica guardada.',
      acao: 'Recarregar',
      aoAgir: () => location.reload(),
      cheia: true,
    },
  }[estado as 'SESSAO_ASSUMIDA' | 'ENCERRADA' | 'DESATUALIZADO'];

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-label={conteudo.titulo}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 20,
        display: 'grid',
        placeItems: 'center',
        padding: 20,
        // Tela cheia opaca para o que é definitivo; véu translúcido para o que
        // é recuperável — dá para ver que a mesa continua ali atrás.
        background: conteudo.cheia ? 'var(--fundo)' : 'rgba(8,11,20,0.86)',
      }}
    >
      <div className="cartao pilha" style={{ gap: 12, maxWidth: 340, textAlign: 'center' }}>
        <span aria-hidden style={{ fontSize: 28, color: 'var(--acento-claro)' }}>{conteudo.icone}</span>
        <h2 style={{ fontSize: 20, fontWeight: 500 }}>{conteudo.titulo}</h2>
        <p className="fraco">{conteudo.corpo}</p>
        <button onClick={conteudo.aoAgir}>{conteudo.acao}</button>
      </div>
    </div>
  );
}
