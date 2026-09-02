import { useEffect, useRef, useState } from 'react';
import type { Avatar, ModoDeFila } from '@fdp/protocol';
import { entrarNaFila, type EstadoDaFila, type NaFila, type Pareamento } from '../net/fila';
import { Folha } from '../components/Folha';

/** O que a fila precisa saber de quem entra. Sem conta, vem daqui. */
export interface IdentidadeNaFila {
  nickname?: string | undefined;
  avatar?: Avatar | undefined;
}

const MINIMO = 4;

/**
 * A tela de espera (plano 03 §5).
 *
 * A tela existe enquanto o socket existe, e é isso que a mantém honesta: não há
 * estado de "na fila" guardado em lugar nenhum do cliente que pudesse sobreviver
 * a uma queda e mentir para a pessoa.
 */
export function Fila({ modo, identidade, aoParear, aoFechar }: {
  modo: ModoDeFila;
  identidade: IdentidadeNaFila;
  aoParear: (p: Pareamento) => void;
  aoFechar: () => void;
}) {
  const [espera, setEspera] = useState<EstadoDaFila | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [caiu, setCaiu] = useState(false);
  const [agora, setAgora] = useState(Date.now());
  const conexao = useRef<NaFila | null>(null);

  useEffect(() => {
    const ligacao = entrarNaFila(modo, identidade, {
      aoEsperar: setEspera,
      aoParear,
      aoRecusar: (motivo) => setErro(RECUSAS[motivo] ?? 'Não deu para entrar na fila.'),
      aoCair: () => setCaiu(true),
    });
    conexao.current = ligacao;
    return () => ligacao.sair();
    // `identidade` de propósito fora: ela não muda com a fila aberta, e
    // incluí-la faria um objeto novo a cada render reabrir o socket — a pessoa
    // perderia o lugar na fila a cada quadro.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modo]);

  /**
   * §5.2: trocar de aplicativo TIRA da fila.
   *
   * Aqui a regra é a oposta da RJ-117b, que vale em partida — e as duas estão
   * certas. Em partida, segundo plano não pausa nada, porque a pessoa está no
   * meio de um compromisso com outras quatro e o relógio dela tem de continuar
   * correndo. Na fila, o mesmo gesto significa outra coisa: quem foi para o
   * Instagram não está esperando partida, e cair numa mesa com quatro
   * estranhos que vão esperar 45 s por uma aposta que não vem é pior para todo
   * mundo do que perder o lugar na fila.
   *
   * Uma protege um compromisso já assumido; a outra evita assumir um que não
   * vai ser cumprido.
   */
  useEffect(() => {
    const aoEsconder = (): void => {
      if (document.visibilityState !== 'hidden') return;
      conexao.current?.sair();
      setCaiu(true);
      setEspera(null);
    };
    document.addEventListener('visibilitychange', aoEsconder);
    return () => document.removeEventListener('visibilitychange', aoEsconder);
  }, []);

  // Um relógio de um segundo só para o "esperando há X" andar. Não decide nada.
  useEffect(() => {
    const t = setInterval(() => setAgora(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const ranqueada = modo === 'RANQUEADA';
  const naFila = espera?.naFila ?? 0;
  const faltam = Math.max(0, MINIMO - naFila);
  const segundos = espera ? Math.max(0, Math.floor((agora - espera.desde) / 1000)) : 0;
  const janela = espera?.janelaAte ?? null;
  const paraFormar = janela === null ? null : Math.max(0, Math.ceil((janela - agora) / 1000));

  return (
    <Folha rotulo={ranqueada ? 'Fila ranqueada' : 'Fila'} aoFechar={aoFechar}>
      {erro && (
        <div className="cartao pilha" style={{ gap: 8 }}>
          <p style={{ textAlign: 'center' }}>{erro}</p>
          <button className="fantasma" onClick={aoFechar}>Voltar</button>
        </div>
      )}

      {!erro && caiu && (
        <div className="cartao pilha" style={{ gap: 8 }}>
          <p style={{ textAlign: 'center' }}>Você saiu da fila.</p>
          <p className="fraco" style={{ textAlign: 'center', fontSize: 12 }}>
            {/* Dizer o motivo, e não só o fato. "Saiu da fila" sem explicação
                lê como defeito — e o motivo é justamente o que faz a regra
                parecer razoável em vez de arbitrária. */}
            A fila só conta com quem está de olho na tela: trocar de aplicativo
            ou perder a conexão devolve o lugar para quem está esperando.
          </p>
          <button onClick={() => { setCaiu(false); location.reload(); }}>
            Entrar na fila de novo
          </button>
        </div>
      )}

      {!erro && !caiu && (
        <>
          <div className="cartao pilha" style={{ gap: 10, alignItems: 'center' }}>
            <Pontinhos />
            <span style={{ fontSize: 28, fontWeight: 500, fontVariantNumeric: 'tabular-nums' }}>
              {naFila} {naFila === 1 ? 'pessoa' : 'pessoas'}
            </span>
            <span className="fraco" style={{ fontSize: 13, textAlign: 'center' }}>
              {paraFormar !== null
                ? `Mesa fechando em ${paraFormar}s — ainda dá para chegar mais gente.`
                : faltam > 0
                  ? `Faltam ${faltam} para a mesa existir.`
                  : 'Formando a mesa…'}
            </span>
            <span className="fraco" style={{ fontSize: 11 }}>
              esperando há {segundos < 60 ? `${segundos}s` : `${Math.floor(segundos / 60)}min`}
            </span>
          </div>

          {/* RF-104: o custo do abandono aparece ANTES, e não depois.
              Descobrir a punição depois de tê-la levado é o desenho que faz
              alguém abandonar o jogo, e não a partida. */}
          {ranqueada && (
            <p className="fraco" style={{ fontSize: 12, textAlign: 'center' }}>
              Sair no meio de uma ranqueada conta como último lugar, e ainda
              custa 25 pontos a mais. Queda de internet não conta: dá tempo de
              voltar antes de o assento virar bot.
            </p>
          )}

          <p className="fraco" style={{ fontSize: 12, textAlign: 'center' }}>
            A mesa começa direto, sem lobby — de 4 a 8 pessoas.
          </p>

          <button className="fantasma" onClick={aoFechar}>Sair da fila</button>
        </>
      )}
    </Folha>
  );
}

const RECUSAS: Record<string, string> = {
  RANQUEADA_EXIGE_CONTA: 'A fila ranqueada precisa de conta — é onde o seu elo mora.',
  SEM_APELIDO: 'Escolha um apelido antes de entrar na fila.',
  JA_ESTA_NA_FILA: 'Você já está nesta fila.',
};

/** Três pontinhos que respiram. Só para a espera não parecer uma tela travada. */
function Pontinhos() {
  return (
    <div style={{ display: 'flex', gap: 6 }} aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="pontinho-da-fila"
          style={{ animationDelay: `${i * 0.18}s` }}
        />
      ))}
    </div>
  );
}
