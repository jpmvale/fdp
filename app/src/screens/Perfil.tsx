import { useRef, useState } from 'react';
import {
  AVATAR_COLORS, AVATAR_EMOJIS, LIMITS, NICKNAME_MAX, NICKNAME_MIN,
  type Avatar as AvatarProto,
} from '@fdp/protocol';
import { Avatar } from '../components/Avatar';
import type { PublicPlayer } from '../state/tipos';
import { enviarAvatar, removerAvatar, ErroApi } from '../net/sessao';

/** O teto em MB, para a frase — derivado do número, nunca escrito ao lado dele. */
const TETO_EM_MB = Math.round(LIMITS.avatarBytesMax / (1024 * 1024));

/**
 * Perfil: quem você é na mesa.
 *
 * Serve duas situações com a mesma tela — antes de entrar (escolhendo como
 * chegar) e já dentro da sala (trocando de ideia). A diferença é o botão e o
 * fato de que, dentro da sala, dá para saber quais cores já são de alguém.
 */
export function Perfil({ inicial, jaNaMesa, eu, aoConfirmar, aoVoltar, comConta, rotulo, subtitulo }: {
  inicial?: { nickname: string; avatar: AvatarProto } | undefined;
  /** Quem já está na sala, para não escolher a cara de outro. */
  jaNaMesa?: PublicPlayer[] | undefined;
  /** Meu id na sala, quando já estou nela: é por ele que eu me excluo. */
  eu?: string | undefined;
  aoConfirmar: (nickname: string, avatar: AvatarProto) => void;
  aoVoltar: () => void;
  /** Foto só existe com conta (RF-070). */
  comConta?: boolean | undefined;
  /**
   * O que o botão do fim promete.
   *
   * Antes era derivado de `jaNaMesa`, e por isso a tela só sabia dizer duas
   * coisas: "Entrar na mesa" ou "Salvar". Editando a conta fora de qualquer
   * sala nenhuma das duas serve — não há mesa para entrar, e a pessoa não está
   * a caminho de lugar nenhum (RF-078).
   */
  rotulo?: string | undefined;
  subtitulo?: string | undefined;
}) {
  const [apelido, setApelido] = useState(
    inicial?.nickname ?? localStorage.getItem('fdp.apelido') ?? '',
  );
  const [cor, setCor] = useState<string>(inicial?.avatar.color ?? AVATAR_COLORS[0]);
  const [imagem, setImagem] = useState<string | undefined>(inicial?.avatar.imagem);
  const [emoji, setEmoji] = useState<string>(inicial?.avatar.emoji ?? AVATAR_EMOJIS[0]);

  const avatar = { emoji, color: cor, ...(imagem ? { imagem } : {}) } as AvatarProto;
  const limpo = apelido.trim();
  const valido = limpo.length >= NICKNAME_MIN;

  // Identidade é única na mesa, e o SERVIDOR recusa (CA-375) — antes ele
  // reacomodava, e por isso esta tela só marcava as cores sem impedir nada.
  // Marcar e deixar clicar era o pior dos dois mundos: o toque parecia ter
  // funcionado e o erro só aparecia ao salvar.
  //
  // Eu me excluo pelo ID, não pelo apelido: comparar por nome fazia quem tinha
  // apelido igual ao de outro se ver como dono da cor alheia.
  const demais = (jaNaMesa ?? []).filter((p) => p.id !== eu);
  const donoDaCor = (c: string) => demais.find((p) => p.avatar.color === c);
  const donoDoEmoji = (e: string) => demais.find((p) => p.avatar.emoji === e);
  const donoDoApelido = demais.find(
    (p) => p.nickname.trim().toLocaleLowerCase('pt-BR') === limpo.toLocaleLowerCase('pt-BR'),
  );

  return (
    <div className="pilha">
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <button className="fantasma" onClick={aoVoltar} aria-label="Voltar" style={{ minWidth: 44, width: 44, padding: 0 }}>
          ←
        </button>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 500 }}>Perfil</h1>
          <span className="fraco">{subtitulo ?? 'quem você é na mesa'}</span>
        </div>
      </div>

      {/* A prévia é o assento de verdade, não um enfeite: é exatamente assim
          que os outros vão te ver na mesa. */}
      <div className="cartao pilha" style={{ gap: 8, alignItems: 'center' }}>
        <div style={{
          width: 150, padding: 6, borderRadius: 10,
          background: 'rgba(8,14,23,0.88)', boxShadow: 'inset 0 0 0 1px var(--linha)',
        }}>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <Avatar avatar={avatar} tamanho={26} />
            <span style={{ fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {limpo || 'sem nome'}
            </span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 3 }}>
            <span style={{ color: 'var(--vidas)', fontSize: 10, letterSpacing: 1 }}>♥♥♥</span>
            <span style={{ fontSize: 12 }}><b>2</b><span style={{ color: 'var(--texto-apagado)' }}>/3</span></span>
          </div>
        </div>
        <p className="fraco">é exatamente assim que os outros te veem</p>
      </div>

      <div className="cartao pilha" style={{ gap: 6 }}>
        <span className="rotulo">apelido</span>
        <input
          value={apelido}
          onChange={(e) => setApelido(e.target.value)}
          maxLength={NICKNAME_MAX}
          placeholder="Como te chamam"
          autoComplete="nickname"
        />
        {donoDoApelido ? (
          <span style={{ color: 'var(--vidas)', fontSize: 12 }}>
            Esse apelido já é de alguém nesta mesa.
          </span>
        ) : (
          <span className="fraco">
            {limpo.length} de {NICKNAME_MAX} caracteres · mínimo {NICKNAME_MIN}
          </span>
        )}
      </div>

      <div className="cartao pilha" style={{ gap: 10 }}>
        <span className="rotulo">cor</span>
        <div role="radiogroup" aria-label="cor do avatar" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {AVATAR_COLORS.map((c) => {
            const dono = donoDaCor(c);
            return (
              <button
                key={c}
                role="radio"
                aria-checked={c === cor}
                aria-label={dono ? `cor ${c}, já é de ${dono.nickname}` : `cor ${c}`}
                disabled={dono !== undefined}
                onClick={() => setCor(c)}
                style={{
                  width: 44, height: 44, padding: 0, position: 'relative',
                  background: 'transparent',
                  boxShadow: `inset 0 0 0 ${c === cor ? 2 : 1}px ${c === cor ? 'var(--acento)' : 'var(--linha)'}`,
                  opacity: dono ? 0.5 : 1,
                }}
              >
                <span style={{ width: 22, height: 22, borderRadius: 7, background: `var(--avatar-${c})`, display: 'block', margin: '0 auto' }} />
                {/* Marca com símbolo, não só com opacidade: cor não pode ser o
                    único canal, e "apagado" sozinho não diz por quê. */}
                <span aria-hidden style={{ position: 'absolute', right: 3, bottom: 1, fontSize: 10 }}>
                  {c === cor ? '✓' : dono ? '✕' : ''}
                </span>
              </button>
            );
          })}
        </div>
        {donoDaCor(cor) && (
          <span className="fraco">{cor} já é de {donoDaCor(cor)!.nickname} nesta sala</span>
        )}
      </div>

      {/* Foto só para quem tem conta (RF-070): é o que dá um nome ligado ao
          arquivo, e é a única moderação que existe hoje. */}
      {comConta && (
        <div className="cartao pilha" style={{ gap: 8 }}>
          <span className="rotulo">foto</span>
          <p className="fraco" style={{ fontSize: 12 }}>
            Entra por cima do emoji, e o emoji continua embaixo — é ele que
            aparece enquanto a foto carrega.
          </p>
          <FotoDoAvatar
            atual={imagem}
            aoTrocar={(url) => setImagem(url)}
          />
        </div>
      )}

      <div className="cartao pilha" style={{ gap: 10 }}>
        <span className="rotulo">emoji</span>
        <div role="radiogroup" aria-label="emoji do avatar" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {AVATAR_EMOJIS.map((e) => {
            const dono = donoDoEmoji(e);
            return (
              <button
                key={e}
                role="radio"
                aria-checked={e === emoji}
                aria-label={dono ? `emoji ${e}, já é de ${dono.nickname}` : `emoji ${e}`}
                disabled={dono !== undefined}
                onClick={() => setEmoji(e)}
                style={{
                  width: 44, height: 44, padding: 0, fontSize: 20, position: 'relative',
                  background: e === emoji ? 'rgba(145,132,217,0.18)' : 'transparent',
                  boxShadow: `inset 0 0 0 ${e === emoji ? 2 : 1}px ${e === emoji ? 'var(--acento)' : 'var(--linha)'}`,
                  opacity: dono ? 0.4 : 1,
                }}
              >
                {e}
                {/* Símbolo junto da opacidade: apagado sozinho não diz por quê. */}
                {dono && (
                  <span aria-hidden style={{ position: 'absolute', right: 2, bottom: 0, fontSize: 10 }}>✕</span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      <button
        disabled={!valido || donoDoApelido !== undefined}
        onClick={() => {
          localStorage.setItem('fdp.apelido', limpo);
          aoConfirmar(limpo, avatar);
        }}
      >
        {rotulo ?? (jaNaMesa ? 'Salvar' : 'Entrar na mesa')}
      </button>
    </div>
  );
}


/**
 * Escolher, enviar e tirar a foto.
 *
 * O envio é imediato — a foto vai para a conta assim que é escolhida, sem
 * esperar o "salvar" do resto do formulário. É porque o servidor precisa
 * processá-la para devolver o caminho, e não dá para montar o avatar antes de
 * saber o endereço final.
 */
function FotoDoAvatar({ atual, aoTrocar }: {
  atual: string | undefined;
  aoTrocar: (url: string | undefined) => void;
}) {
  const campo = useRef<HTMLInputElement>(null);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function escolheu(arquivo: File | undefined): Promise<void> {
    if (!arquivo) return;
    setErro(null);

    // Recusa aqui o que o servidor recusaria de qualquer jeito: subir um
    // arquivo enorme pelo 4G para receber 413 no fim é gastar o dado da pessoa
    // à toa. O teto é o MESMO dos dois lados, de `@fdp/protocol`.
    if (arquivo.size > LIMITS.avatarBytesMax) {
      setErro(`A imagem passa de ${TETO_EM_MB} MB.`);
      return;
    }

    setOcupado(true);
    try {
      const r = await enviarAvatar(arquivo);
      aoTrocar(r.conta.avatar.imagem);
    } catch (e) {
      setErro(e instanceof ErroApi ? mensagemDaFoto(e.codigo) : 'Não deu para enviar.');
    } finally {
      setOcupado(false);
      if (campo.current) campo.current.value = '';
    }
  }

  return (
    <div className="pilha" style={{ gap: 8 }}>
      <input
        ref={campo}
        type="file"
        /* HEIC/HEIF junto: é o formato padrão da câmera do iPhone, e sem ele
           no `accept` a foto da pessoa nem aparecia como escolhível. */
        /* Sem HEIC: o servidor não sabe abrir esse formato (ver `avatar.ts`),
           e oferecê-lo aqui só levaria a pessoa até a recusa. */
        accept="image/jpeg,image/png,image/webp,image/gif,image/avif"
        onChange={(e) => void escolheu(e.target.files?.[0])}
        style={{ display: 'none' }}
      />

      <div style={{ display: 'flex', gap: 8 }}>
        <button
          className="fantasma"
          disabled={ocupado}
          onClick={() => campo.current?.click()}
          style={{ flex: 1 }}
        >
          {ocupado ? 'Enviando…' : atual ? 'Trocar a foto' : 'Escolher uma foto'}
        </button>

        {atual && (
          <button
            className="fantasma"
            disabled={ocupado}
            onClick={() => {
              void removerAvatar().then(() => aoTrocar(undefined)).catch(() => {
                setErro('Não deu para tirar a foto.');
              });
            }}
          >
            Tirar
          </button>
        )}
      </div>

      {erro && <p role="alert" style={{ color: 'var(--vidas)', fontSize: 12 }}>{erro}</p>}
    </div>
  );
}

/** Cada motivo do servidor vira uma frase que diz o que fazer. */
function mensagemDaFoto(codigo: string): string {
  switch (codigo) {
    case 'GRANDE_DEMAIS': return `A imagem passa de ${TETO_EM_MB} MB.`;
    case 'NAO_E_IMAGEM': return 'Esse arquivo não é uma imagem (JPEG, PNG, WebP, AVIF ou GIF).';
    // É imagem, e é a que o iPhone tira por padrão. A frase diz o que fazer,
    // porque "não é uma imagem" seria falso e não levaria a lugar nenhum.
    case 'HEIC_NAO_SUPORTADO':
      return 'Ainda não abrimos foto HEIC do iPhone. Mande como JPEG — em Ajustes › Câmera › Formatos, escolha "Mais compatível".';
    case 'IMAGEM_ABSURDA': return 'Essa imagem tem pixels demais. Reduza antes de enviar.';
    case 'FALHA_AO_PROCESSAR': return 'Não consegui abrir essa imagem. Ela pode estar corrompida.';
    case 'AVATAR_INDISPONIVEL': return 'O envio de foto está fora do ar.';
    // Distinto de FALHA_AO_PROCESSAR de propósito: a foto está boa, e mandar a
    // pessoa trocar de imagem seria mandá-la resolver o nosso problema.
    case 'DEPOSITO_INDISPONIVEL':
      return 'Não deu para guardar a foto agora — é problema nosso, não da imagem. Tente daqui a pouco.';
    case 'SEM_SESSAO': return 'Sua sessão expirou. Entre de novo.';
    case 'RATE_LIMITED': return 'Muitos envios. Espere um pouco.';
    default: return 'Não deu para enviar.';
  }
}
