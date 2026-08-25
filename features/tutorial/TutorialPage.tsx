'use client';

import React, { useState } from 'react';
import { ExternalLink, GraduationCap, Play, PlayCircle, Sparkles } from 'lucide-react';

interface TutorialVideo {
  /** ID do vídeo no YouTube (o que vem depois de `v=` ou de `youtu.be/`). */
  youtubeId: string;
  title: string;
  description?: string;
  /** Tópicos abordados (aparecem como etiquetas no card em destaque). */
  topics?: string[];
}

/** Vídeo principal: o tutorial completo de como usar a plataforma. */
const MAIN_VIDEO: TutorialVideo = {
  youtubeId: 'acteIEQeE5Y',
  title: 'Como usar a plataforma',
  description:
    'Tutorial completo para dar os primeiros passos no CRM: navegação, cadastro de leads, pipeline e muito mais.',
  topics: ['Navegação', 'Cadastro de leads', 'Pipeline', 'Primeiros passos'],
};

/**
 * Tutoriais de funcionalidades secundárias do CRM. Para adicionar novos,
 * basta incluir mais itens aqui (a página já renderiza a lista automaticamente).
 */
const FEATURE_VIDEOS: TutorialVideo[] = [
  {
    youtubeId: 'agfwryvQXqg',
    title: 'Como criar modelos de Mensagem API',
    description: 'Aprenda a criar modelos de mensagem para usar nos envios pela API.',
  },
];

const IFRAME_ALLOW =
  'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share';

/**
 * Player "leve": mostra a miniatura do YouTube com um botão de play e só carrega
 * o iframe quando o usuário clica. Deixa a página mais rápida e mais bonita.
 */
function VideoPlayer({ video, priority = false }: { video: TutorialVideo; priority?: boolean }) {
  const [playing, setPlaying] = useState(false);
  const [thumb, setThumb] = useState(`https://i.ytimg.com/vi/${video.youtubeId}/maxresdefault.jpg`);

  if (playing) {
    return (
      <iframe
        className="absolute inset-0 h-full w-full"
        src={`https://www.youtube-nocookie.com/embed/${video.youtubeId}?autoplay=1&rel=0`}
        title={video.title}
        allow={IFRAME_ALLOW}
        allowFullScreen
      />
    );
  }

  return (
    <button
      type="button"
      onClick={() => setPlaying(true)}
      aria-label={`Assistir: ${video.title}`}
      className="group/play absolute inset-0 h-full w-full cursor-pointer overflow-hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-inset"
    >
      {/* Miniatura externa do YouTube (não passa pelo otimizador do Next). */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={thumb}
        alt=""
        loading={priority ? 'eager' : 'lazy'}
        onError={() => {
          const fallback = `https://i.ytimg.com/vi/${video.youtubeId}/hqdefault.jpg`;
          if (thumb !== fallback) setThumb(fallback);
        }}
        className="h-full w-full object-cover transition-transform duration-500 ease-out group-hover/play:scale-[1.04]"
      />
      <span className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/55 via-black/5 to-transparent transition-opacity duration-300 group-hover/play:opacity-80" />
      <span className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <span className="flex h-14 w-14 sm:h-16 sm:w-16 items-center justify-center rounded-full bg-white/95 text-primary-600 shadow-xl ring-1 ring-black/5 transition-transform duration-300 group-hover/play:scale-110">
          <Play size={26} className="ml-1 fill-current" />
        </span>
      </span>
    </button>
  );
}

function TopicChip({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full border border-primary-100 dark:border-primary-800/40 bg-primary-50 dark:bg-primary-900/30 px-2.5 py-1 text-xs font-medium text-primary-700 dark:text-primary-200">
      {children}
    </span>
  );
}

export function TutorialPage() {
  const total = 1 + FEATURE_VIDEOS.length;

  return (
    <div className="h-full overflow-y-auto scrollbar-custom">
      <div className="max-w-6xl mx-auto px-4 py-6 sm:px-6 sm:py-8 lg:px-8 lg:py-10 space-y-10 sm:space-y-12">
        {/* Cabeçalho */}
        <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex items-start gap-4">
            <span className="shrink-0 w-12 h-12 rounded-2xl bg-primary-100 dark:bg-primary-900/40 text-primary-600 dark:text-primary-300 flex items-center justify-center shadow-sm">
              <GraduationCap size={24} />
            </span>
            <div>
              <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 dark:text-white font-display tracking-tight">
                Tutorial
              </h1>
              <p className="mt-1.5 max-w-xl text-sm sm:text-base leading-relaxed text-slate-500 dark:text-slate-400">
                Aprenda a usar a plataforma no seu ritmo. Comece pelo vídeo principal e depois explore os
                tutoriais de cada funcionalidade.
              </p>
            </div>
          </div>
          <span className="inline-flex w-fit shrink-0 items-center gap-1.5 rounded-full border border-slate-200 dark:border-white/10 bg-white/60 dark:bg-white/5 px-3 py-1.5 text-xs font-semibold text-slate-600 dark:text-slate-300">
            <PlayCircle size={14} className="text-primary-500" />
            {total} {total === 1 ? 'vídeo' : 'vídeos'}
          </span>
        </header>

        {/* Vídeo principal */}
        <section aria-labelledby="tutorial-principal">
          <article className="glass rounded-2xl border border-slate-200 dark:border-white/5 shadow-sm overflow-hidden">
            <div className="grid lg:grid-cols-[minmax(0,1.65fr)_minmax(0,1fr)]">
              <div className="relative aspect-video bg-black">
                <VideoPlayer video={MAIN_VIDEO} priority />
              </div>
              <div className="flex flex-col justify-center gap-4 p-5 sm:p-6 lg:p-8 lg:border-l border-slate-200/70 dark:border-white/5">
                <p className="text-[11px] font-bold uppercase tracking-wider text-primary-600 dark:text-primary-300">
                  Comece por aqui
                </p>
                <h2
                  id="tutorial-principal"
                  className="text-xl sm:text-2xl font-bold leading-tight text-slate-900 dark:text-white font-display tracking-tight"
                >
                  {MAIN_VIDEO.title}
                </h2>
                {MAIN_VIDEO.description && (
                  <p className="text-sm sm:text-base leading-relaxed text-slate-500 dark:text-slate-400">
                    {MAIN_VIDEO.description}
                  </p>
                )}
                {MAIN_VIDEO.topics && MAIN_VIDEO.topics.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {MAIN_VIDEO.topics.map((topic) => (
                      <TopicChip key={topic}>{topic}</TopicChip>
                    ))}
                  </div>
                )}
                <a
                  href={`https://www.youtube.com/watch?v=${MAIN_VIDEO.youtubeId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex w-fit items-center gap-1.5 text-sm font-semibold text-primary-600 hover:text-primary-700 dark:text-primary-300 dark:hover:text-primary-200 transition-colors"
                >
                  Abrir no YouTube
                  <ExternalLink size={14} />
                </a>
              </div>
            </div>
          </article>
        </section>

        {/* Tutoriais de funcionalidades */}
        {FEATURE_VIDEOS.length > 0 && (
          <section className="space-y-5 sm:space-y-6" aria-labelledby="tutorial-funcionalidades">
            <div className="flex items-start gap-3">
              <span className="mt-0.5 shrink-0 w-9 h-9 rounded-xl bg-primary-100 dark:bg-primary-900/40 text-primary-600 dark:text-primary-300 flex items-center justify-center">
                <Sparkles size={18} />
              </span>
              <div>
                <p className="text-[11px] font-bold uppercase tracking-wider text-primary-600 dark:text-primary-300">
                  Passo a passo
                </p>
                <h2
                  id="tutorial-funcionalidades"
                  className="mt-0.5 text-lg sm:text-xl font-bold text-slate-900 dark:text-white font-display tracking-tight"
                >
                  Tutoriais de funcionalidades
                </h2>
                <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                  Vídeos curtos sobre recursos específicos do CRM.
                </p>
              </div>
            </div>

            <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
              {FEATURE_VIDEOS.map((video, index) => (
                <article
                  key={video.youtubeId}
                  className="glass flex flex-col rounded-2xl border border-slate-200 dark:border-white/5 shadow-sm overflow-hidden transition-all duration-300 hover:-translate-y-0.5 hover:shadow-lg"
                >
                  <div className="relative aspect-video bg-black">
                    <VideoPlayer video={video} />
                  </div>
                  <div className="flex flex-1 flex-col gap-1.5 p-4 sm:p-5">
                    <p className="text-[11px] font-bold uppercase tracking-wider text-primary-600 dark:text-primary-300">
                      Tutorial {String(index + 1).padStart(2, '0')}
                    </p>
                    <h3 className="text-base font-bold leading-snug text-slate-900 dark:text-white">
                      {video.title}
                    </h3>
                    {video.description && (
                      <p className="text-sm leading-relaxed text-slate-500 dark:text-slate-400">
                        {video.description}
                      </p>
                    )}
                  </div>
                </article>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

export default TutorialPage;
