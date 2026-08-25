import type { EstadoConexao } from '../net/socket';

/**
 * `07` §2.6: o estado da conexão fica visível sempre que NÃO for "conectado"
 * (RF-023). Conectado não merece pixel — é o esperado.
 */
export function FaixaConexao({ estado }: { estado: EstadoConexao }) {
  if (estado === 'CONECTADO') return null;

  const texto: Record<Exclude<EstadoConexao, 'CONECTADO'>, string> = {
    CONECTANDO: 'Conectando…',
    RECONECTANDO: 'Sem conexão — tentando voltar. Sua vaga está guardada.',
    SESSAO_ASSUMIDA: 'Esta sala foi aberta em outra aba. Só uma por vez.',
    ENCERRADA: 'A sala não existe mais.',
  };

  const grave = estado === 'SESSAO_ASSUMIDA' || estado === 'ENCERRADA';

  return (
    <div
      role="status"
      style={{
        padding: '9px 12px',
        borderRadius: 'var(--r-md)',
        background: grave ? 'rgba(239,77,90,0.12)' : 'rgba(145,132,217,0.12)',
        boxShadow: `inset 0 0 0 1px ${grave ? 'var(--vidas)' : 'var(--acento)'}`,
        fontSize: 13,
        display: 'flex',
        gap: 8,
        alignItems: 'center',
      }}
    >
      <span aria-hidden>{grave ? '✕' : '◐'}</span>
      <span>{texto[estado]}</span>
    </div>
  );
}
