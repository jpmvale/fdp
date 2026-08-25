import { useState } from 'react';
import { LIMITS, type BotDifficulty } from '@fdp/protocol';
import { CartaoJogador } from '../components/CartaoJogador';
import { Chat } from '../components/Chat';
import type { Retrato } from '../state/tipos';

/** Só as que hoje jogam diferente. As outras duas ainda não existem. */
const DIFICULDADES: { valor: BotDifficulty; rotulo: string; explica: string }[] = [
  { valor: 'FACIL', rotulo: 'Fácil', explica: 'Aposta e joga no chute, sem olhar a mão.' },
  { valor: 'MEDIO', rotulo: 'Médio', explica: 'Aposta pela força da mão e segura carta alta.' },
];

export function Lobby({ retrato, eu, aoIniciar, aoExpulsar, aoAdicionarBot, aoRemoverBot, aoAbrirPerfil, aoAbrirRegras, aoSair, aoEnviarChat }: {
  retrato: Retrato;
  eu: string;
  aoIniciar: () => void;
  aoExpulsar: (playerId: string) => void;
  aoAdicionarBot: (dificuldade: BotDifficulty) => void;
  aoRemoverBot: (playerId: string) => void;
  aoAbrirPerfil: () => void;
  aoAbrirRegras: () => void;
  aoSair: () => void;
  aoEnviarChat: (texto: string) => void;
}) {
  const [dificuldade, setDificuldade] = useState<BotDifficulty>('MEDIO');
  const jogadores = retrato.players.filter((p) => !p.isSpectator);
  const souHost = retrato.hostId === eu;
  const bots = jogadores.filter((p) => p.bot);
  const cabeMaisBot = bots.length < LIMITS.maxBots && jogadores.length < LIMITS.maxPlayers;
  const suficiente = jogadores.length >= LIMITS.minPlayers;
  const convite = `${location.origin}/?sala=${retrato.code}`;

  return (
    <div className="pilha">
      <div className="cartao pilha" style={{ gap: 10 }}>
        <span className="rotulo">código da sala</span>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <span style={{
            fontFamily: 'ui-monospace, monospace', fontSize: 32, fontWeight: 700,
            letterSpacing: 6, color: 'var(--acento-claro)',
          }}>
            {retrato.code}
          </span>
          <button
            className="fantasma"
            style={{ marginLeft: 'auto' }}
            onClick={() => void navigator.clipboard?.writeText(convite)}
          >
            Copiar convite
          </button>
        </div>
        <p className="fraco">
          Quem receber o link entra direto — sem conta, sem instalar nada.
        </p>
      </div>

      <div className="cartao pilha" style={{ gap: 4 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <span className="rotulo">na mesa</span>
          <span className="fraco">{jogadores.length} de {LIMITS.maxPlayers}</span>
        </div>
        {jogadores.map((p) => (
          <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <CartaoJogador
                jogador={p}
                partida={null}
                souEu={p.id === eu}
                ehHost={retrato.hostId === p.id}
                ausente={false}
              />
            </div>
            {souHost && p.id !== eu && (
              <button
                className="fantasma"
                aria-label={p.bot ? `Tirar ${p.nickname} da mesa` : `Expulsar ${p.nickname}`}
                onClick={() => (p.bot ? aoRemoverBot(p.id) : aoExpulsar(p.id))}
                style={{ minWidth: 44, padding: 0 }}
              >
                ✕
              </button>
            )}
          </div>
        ))}
      </div>

      {souHost && (
        <div className="cartao pilha" style={{ gap: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <span className="rotulo">jogar com bots</span>
            <span className="fraco">{bots.length} de {LIMITS.maxBots}</span>
          </div>

          <div role="radiogroup" aria-label="dificuldade do bot" style={{ display: 'flex', gap: 6 }}>
            {DIFICULDADES.map((d) => (
              <button
                key={d.valor}
                role="radio"
                aria-checked={d.valor === dificuldade}
                onClick={() => setDificuldade(d.valor)}
                className={d.valor === dificuldade ? '' : 'fantasma'}
                style={{ flex: 1 }}
              >
                {d.rotulo}
              </button>
            ))}
          </div>

          <p className="fraco">
            {DIFICULDADES.find((d) => d.valor === dificuldade)?.explica}
          </p>

          <button
            className="fantasma"
            disabled={!cabeMaisBot}
            onClick={() => aoAdicionarBot(dificuldade)}
          >
            + Sentar um bot {DIFICULDADES.find((d) => d.valor === dificuldade)?.rotulo.toLowerCase()}
          </button>

          {!cabeMaisBot && (
            <p className="fraco">
              {bots.length >= LIMITS.maxBots
                ? 'Sete bots é o teto: uma mesa só de bot não é jogo.'
                : 'A mesa está cheia.'}
            </p>
          )}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8 }}>
        <button className="fantasma" onClick={aoAbrirPerfil} style={{ flex: 1 }}>
          Trocar apelido e cara
        </button>
        <button className="fantasma" onClick={aoAbrirRegras} style={{ flex: 1 }}>
          Como se joga
        </button>
      </div>

      <Chat mensagens={retrato.chat} eu={eu} aoEnviar={aoEnviarChat} />

      {/* RF-025: toda tela tem saída explícita. Sem isto, entrar numa sala era
          um caminho de mão única — só fechando a aba, o que o servidor leria
          como queda e faria a mesa esperar por quem não vai voltar. */}
      <button className="fantasma" onClick={aoSair}>Sair da mesa</button>

      {souHost ? (
        <div className="pilha" style={{ gap: 8 }}>
          <button disabled={!suficiente} onClick={aoIniciar}>Começar a partida</button>
          {!suficiente && (
            <p className="fraco">
              Falta gente: são precisos {LIMITS.minPlayers} para começar.
            </p>
          )}
        </div>
      ) : (
        <div className="cartao" style={{ textAlign: 'center' }}>
          <p className="fraco">
            Esperando {retrato.players.find((p) => p.id === retrato.hostId)?.nickname ?? 'o host'} começar.
          </p>
        </div>
      )}
    </div>
  );
}
