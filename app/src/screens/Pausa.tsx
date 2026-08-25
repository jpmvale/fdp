import { useEffect, useState } from 'react';
import type { Retrato } from '../state/tipos';

/**
 * A mesa fica VISÍVEL atrás da pausa (esta faixa não cobre a tela): quem
 * ficou quer continuar olhando o jogo enquanto espera. E nenhum botão aparece
 * antes de a decisão liberar — oferecer "continuar sem o Beto" no primeiro
 * segundo em que ele caiu é convidar a mesa a abandoná-lo por impaciência.
 */
export function Pausa({ retrato, eu, aoResolver }: {
  retrato: Retrato;
  eu: string;
  aoResolver: (acao: 'CONTINUAR_SEM' | 'ENCERRAR') => void;
}) {
  const pausa = retrato.pause;
  const [agora, setAgora] = useState(Date.now());

  useEffect(() => {
    const t = setInterval(() => setAgora(Date.now()), 500);
    return () => clearInterval(t);
  }, []);

  if (!pausa) return null;

  const nomes = pausa.absentPlayerIds
    .map((id) => retrato.players.find((p) => p.id === id)?.nickname ?? 'alguém')
    .join(', ');

  const souHost = retrato.hostId === eu;
  const liberou = agora >= pausa.decisionUnlockedAt;
  const faltam = Math.max(0, pausa.decisionUnlockedAt - agora);
  const restante = Math.max(0, pausa.hardDeadline - agora);
  // Barra de progresso, nunca contagem regressiva numérica (RF-027): mesma
  // informação, muito menos ansiedade.
  const fracao = liberou ? 0 : 1 - faltam / Math.max(1, pausa.decisionUnlockedAt - pausa.since);

  return (
    <div
      role="status"
      className="pilha"
      style={{
        gap: 10,
        padding: 14,
        borderRadius: 'var(--r-lg)',
        background: 'rgba(239,77,90,0.10)',
        boxShadow: 'inset 0 0 0 1px var(--vidas)',
      }}
    >
      <div>
        <div style={{ fontWeight: 600 }}>Partida pausada</div>
        <div className="fraco">{nomes} caiu. A mesa espera.</div>
      </div>

      {!liberou && (
        <div className="pilha" style={{ gap: 6 }}>
          <div style={{ height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.10)', overflow: 'hidden' }}>
            <div style={{ width: `${fracao * 100}%`, height: '100%', background: 'var(--acento)' }} />
          </div>
          <p className="fraco">
            {souHost
              ? 'Você poderá decidir daqui a pouco. Dá tempo de ele voltar.'
              : `Se ${nomes} não voltar, o host decide o que fazer.`}
          </p>
        </div>
      )}

      {liberou && souHost && (
        <div className="pilha" style={{ gap: 8 }}>
          {/* Os botões dizem a CONSEQUÊNCIA, não o verbo. */}
          <button onClick={() => aoResolver('CONTINUAR_SEM')}>
            Seguir sem {nomes} — perde as vidas e sai
          </button>
          <button className="perigo" onClick={() => aoResolver('ENCERRAR')}>
            Encerrar a partida para todos
          </button>
        </div>
      )}

      {liberou && !souHost && (
        // RF-044: quem não é host precisa saber que a decisão não é dele, e de
        // quem é. Silêncio aqui vira "travou".
        <p className="fraco">
          A decisão é de {retrato.players.find((p) => p.id === retrato.hostId)?.nickname ?? 'quem é host'}.
          Nada a fazer daqui.
        </p>
      )}

      {restante > 0 && restante < 60_000 && (
        <p className="fraco">A pausa não dura para sempre: está perto do limite.</p>
      )}
    </div>
  );
}
