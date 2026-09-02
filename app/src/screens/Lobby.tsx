import { useState } from 'react';
import { LIMITS, type BotDifficulty } from '@fdp/protocol';
import { CartaoJogador } from '../components/CartaoJogador';
import { Chat } from '../components/Chat';
import type { Retrato } from '../state/tipos';

/** Só as que hoje jogam diferente. As outras duas ainda não existem. */
const DIFICULDADES: { valor: BotDifficulty; rotulo: string; explica: string }[] = [
  { valor: 'FACIL', rotulo: 'Fácil', explica: 'Aposta e joga no chute, sem olhar as cartas.' },
  { valor: 'MEDIO', rotulo: 'Médio', explica: 'Aposta pela força das cartas e segura carta alta.' },
  { valor: 'DIFICIL', rotulo: 'Difícil', explica: 'Conta as cartas que já saíram e joga para a aposta que fez.' },
  { valor: 'REALISTA', rotulo: 'Realista', explica: 'Lê as apostas da mesa e mede o risco de cada carta. Ganha da maioria.' },
];

export function Lobby({ retrato, eu, aoIniciar, aoExpulsar, aoAdicionarBot, aoRemoverBot, aoAbrirPerfil, aoAbrirRegras, aoSair, aoEnviarChat, aoAssistir, aoDarPronto, aoSilenciar }: {
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
  aoAssistir: (assistir: boolean) => void;
  aoDarPronto: (pronto: boolean) => void;
  aoSilenciar: (playerId: string, silenciado: boolean) => void;
}) {
  const [dificuldade, setDificuldade] = useState<BotDifficulty>('MEDIO');
  const jogadores = retrato.players.filter((p) => !p.isSpectator);
  const plateia = retrato.players.filter((p) => p.isSpectator);
  const souHost = retrato.hostId === eu;
  const assistindo = plateia.some((p) => p.id === eu);
  const mesaCheia = jogadores.length >= LIMITS.maxPlayers;
  const plateiaCheia = plateia.length >= LIMITS.maxSpectators;
  const bots = jogadores.filter((p) => p.bot);
  const cabeMaisBot = bots.length < LIMITS.maxBots && jogadores.length < LIMITS.maxPlayers;
  const suficiente = jogadores.length >= LIMITS.minPlayers;
  // Uma pessoa sentada, no mínimo. `maxBots` = `maxPlayers - 1` deixou de
  // bastar quando virou possível sair da mesa sem sair da sala (RF-083): dois
  // bots sentados e o único humano assistindo passavam nas duas contagens.
  const alguemJogando = jogadores.some((p) => !p.bot);

  // RF-094. Bot nasce pronto, então quem falta é sempre gente.
  const euPronto = jogadores.find((p) => p.id === eu)?.pronto ?? false;
  const faltamProntos = jogadores.filter((p) => !p.pronto);
  const todosProntos = faltamProntos.length === 0;
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
            {/* Pronto de RF-094, visível para a mesa inteira.
                Palavra e não só ícone: um ✓ verde sozinho depende de cor, e
                metade de quem falta precisa ser identificada de relance. */}
            {p.pronto ? (
              <span
                style={{ fontSize: 10, color: 'var(--nota-alta)', letterSpacing: '.04em' }}
                aria-label={`${p.nickname} está pronto`}
              >
                ✓ pronto
              </span>
            ) : (
              <span
                style={{ fontSize: 10, color: 'var(--texto-apagado)', letterSpacing: '.04em' }}
                aria-label={`${p.nickname} ainda não deu pronto`}
              >
                aguardando
              </span>
            )}

            {/* RF-095: silenciar. Só para gente — bot não fala. */}
            {souHost && p.id !== eu && !p.bot && (
              <button
                className="fantasma"
                aria-pressed={p.silenciado}
                aria-label={p.silenciado
                  ? `Devolver a voz a ${p.nickname}`
                  : `Silenciar ${p.nickname} no chat`}
                onClick={() => aoSilenciar(p.id, !p.silenciado)}
                style={{ minWidth: 44, padding: 0, opacity: p.silenciado ? 1 : 0.6 }}
              >
                {p.silenciado ? '🔇' : '🔈'}
              </button>
            )}

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

      {/* A plateia só aparece quando existe: um cartão vazio dizendo "0 de 4"
          em toda sala ocuparia espaço para informar que não há informação. */}
      {plateia.length > 0 && (
        <div className="cartao pilha" style={{ gap: 4 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <span className="rotulo">assistindo</span>
            <span className="fraco">{plateia.length} de {LIMITS.maxSpectators}</span>
          </div>
          {plateia.map((p) => (
            <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <CartaoJogador
                  jogador={p}
                  partida={null}
                  souEu={p.id === eu}
                  /* O host pode estar assistindo: ele vira espectador e só
                     passa a mesa se houver outra PESSOA para recebê-la. Sem a
                     marca aqui, a sala pareceria não ter dono. */
                  ehHost={retrato.hostId === p.id}
                  ausente={false}
                />
              </div>
              {souHost && p.id !== eu && (
                <button
                  className="fantasma"
                  aria-label={`Expulsar ${p.nickname}`}
                  onClick={() => aoExpulsar(p.id)}
                  style={{ minWidth: 44, padding: 0 }}
                >
                  ✕
                </button>
              )}
            </div>
          ))}
          <p className="fraco" style={{ fontSize: 12 }}>
            Quem assiste vê as cartas de todo mundo e pode falar no chat — as
            mensagens saem marcadas.
          </p>
        </div>
      )}

      {/* RF-083: trocar de lado sem sair da sala.
          Ficava faltando os dois caminhos. Quem entrou cedo demais ocupava um
          lugar sem querer e só se livrava dele saindo; e quem chegou no meio da
          partida anterior continuava na plateia sem jeito de sentar. */}
      <button
        className="fantasma"
        disabled={assistindo ? mesaCheia : plateiaCheia}
        onClick={() => aoAssistir(!assistindo)}
      >
        {assistindo ? 'Sentar à mesa' : 'Só assistir'}
      </button>
      {assistindo && mesaCheia && (
        <p className="fraco" style={{ textAlign: 'center' }}>
          A mesa está cheia: são {LIMITS.maxPlayers} no máximo.
        </p>
      )}
      {!assistindo && plateiaCheia && (
        <p className="fraco" style={{ textAlign: 'center' }}>
          A plateia está cheia: são {LIMITS.maxSpectators} no máximo.
        </p>
      )}

      {souHost && (
        <div className="cartao pilha" style={{ gap: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <span className="rotulo">jogar com bots</span>
            <span className="fraco">{bots.length} de {LIMITS.maxBots}</span>
          </div>

          {/* Duas colunas, não quatro numa fila: "Realista" não cabe em 75 px,
              que é o que sobra para cada botão numa fila de quatro em 360. */}
          <div
            role="radiogroup"
            aria-label="dificuldade do bot"
            style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 6 }}
          >
            {DIFICULDADES.map((d) => (
              <button
                key={d.valor}
                role="radio"
                aria-checked={d.valor === dificuldade}
                onClick={() => setDificuldade(d.valor)}
                className={d.valor === dificuldade ? '' : 'fantasma'}
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

      <Chat
        mensagens={retrato.chat}
        eu={eu}
        aoEnviar={aoEnviarChat}
        souHost={souHost}
        silenciados={new Set(retrato.players.filter((p) => p.silenciado).map((p) => p.id))}
        estouSilenciado={retrato.players.find((p) => p.id === eu)?.silenciado ?? false}
        aoSilenciar={aoSilenciar}
      />

      {/* RF-025: toda tela tem saída explícita. Sem isto, entrar numa sala era
          um caminho de mão única — só fechando a aba, o que o servidor leria
          como queda e faria a mesa esperar por quem não vai voltar. */}
      <button className="fantasma" onClick={aoSair}>Sair da mesa</button>

      {/* RF-094: o próprio pronto, para quem está sentado.
          Fica ACIMA do botão do host, porque é o passo que vem antes — e
          porque o host também precisa dar o dele. */}
      {!assistindo && (
        <button
          className={euPronto ? 'fantasma' : undefined}
          onClick={() => aoDarPronto(!euPronto)}
          aria-pressed={euPronto}
        >
          {euPronto ? '✓ Pronto — tocar para desmarcar' : 'Estou pronto'}
        </button>
      )}

      {souHost ? (
        <div className="pilha" style={{ gap: 8 }}>
          <button
            disabled={!suficiente || !alguemJogando || !todosProntos}
            onClick={aoIniciar}
          >
            Começar a partida
          </button>
          {!suficiente ? (
            <p className="fraco">
              Falta gente: são precisos {LIMITS.minPlayers} para começar.
            </p>
          ) : !alguemJogando ? (
            /* O servidor também recusa, com `SO_BOTS_NA_MESA`. Aqui é para a
               recusa não CHEGAR: um botão que aceita o toque e devolve erro
               vermelho é pior que um botão desligado que diz o que fazer. */
            <p className="fraco">
              Só há bots na mesa. Sente-se para a partida começar.
            </p>
          ) : !todosProntos && (
            /* Dizer QUEM falta, e não "aguardando jogadores".
               Sem os nomes, a espera vira adivinhação e o host acaba
               expulsando quem não devia. */
            <p className="fraco">
              Falta {faltamProntos.map((p) => p.nickname).join(', ')} dar pronto.
            </p>
          )}
        </div>
      ) : (
        <div className="cartao" style={{ textAlign: 'center' }}>
          <p className="fraco">
            {todosProntos
              ? `Esperando ${retrato.players.find((p) => p.id === retrato.hostId)?.nickname ?? 'o host'} começar.`
              : `Faltam ${faltamProntos.length} ${faltamProntos.length === 1 ? 'pessoa' : 'pessoas'} dar pronto.`}
          </p>
        </div>
      )}
    </div>
  );
}
