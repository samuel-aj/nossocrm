'use client';

import React from 'react';
import { GraduationCap, PlayCircle, Sparkles } from 'lucide-react';

interface TutorialVideo {
  /** ID do vídeo no YouTube (o que vem depois de `v=` ou de `youtu.be/`). */
  youtubeId: string;
  title: string;
  description?: string;
}

/** Vídeo principal: o tutorial completo de como usar a plataforma. */
const MAIN_VIDEO: TutorialVideo = {
  youtubeId: 'acteIEQeE5Y',
  title: 'Como usar a plataforma',
  description:
    'Tutorial completo para dar os primeiros passos no CRM: navegação, cadastro de leads, pipeline e muito mais.',
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

function VideoCard({ video, compact = false }: { video: TutorialVideo; compact?: boolean }) {
  return (
    <div className="glass rounded-xl border border-slate-200 dark:border-white/5 shadow-sm overflow-hidden">
      <div className="relative w-full aspect-video bg-black">
        <iframe
          className="absolute inset-0 h-full w-full"
          src={`https://www.youtube-nocookie.com/embed/${video.youtubeId}`}
          title={video.title}
          loading="lazy"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          allowFullScreen
        />
      </div>
      <div className={compact ? 'p-3 sm:p-4' : 'p-4 sm:p-5'}>
        <h2
          className={`flex items-center gap-2 font-bold text-slate-900 dark:text-white ${
            compact ? 'text-sm sm:text-base' : 'text-base sm:text-lg'
          }`}
        >
          <PlayCircle size={compact ? 16 : 18} className="text-primary-500 shrink-0" />
          {video.title}
        </h2>
        {video.description && (
          <p className={`mt-1 text-slate-500 dark:text-slate-400 ${compact ? 'text-xs sm:text-sm' : 'text-sm'}`}>
            {video.description}
          </p>
        )}
      </div>
    </div>
  );
}

export function TutorialPage() {
  return (
    <div className="h-full overflow-y-auto scrollbar-custom">
      <div className="max-w-5xl mx-auto p-4 sm:p-6 space-y-8">
        {/* Cabeçalho */}
        <div className="flex items-start gap-3">
          <span className="shrink-0 w-11 h-11 rounded-xl bg-primary-100 dark:bg-primary-900/40 text-primary-600 dark:text-primary-300 flex items-center justify-center">
            <GraduationCap size={22} />
          </span>
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 dark:text-white font-display tracking-tight">
              Tutorial
            </h1>
            <p className="text-slate-500 dark:text-slate-400 text-sm mt-1">
              Aprenda a usar a plataforma com nossos vídeos. Ideal para quem está começando.
            </p>
          </div>
        </div>

        {/* Vídeo principal */}
        <VideoCard video={MAIN_VIDEO} />

        {/* Tutoriais de funcionalidades */}
        {FEATURE_VIDEOS.length > 0 && (
          <section className="space-y-4">
            <div className="flex items-start gap-3">
              <span className="shrink-0 w-9 h-9 rounded-lg bg-primary-100 dark:bg-primary-900/40 text-primary-600 dark:text-primary-300 flex items-center justify-center">
                <Sparkles size={18} />
              </span>
              <div>
                <h2 className="text-lg sm:text-xl font-bold text-slate-900 dark:text-white font-display tracking-tight">
                  Tutoriais de funcionalidades
                </h2>
                <p className="text-slate-500 dark:text-slate-400 text-sm mt-0.5">
                  Vídeos curtos sobre recursos específicos do CRM.
                </p>
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              {FEATURE_VIDEOS.map((video) => (
                <VideoCard key={video.youtubeId} video={video} compact />
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

export default TutorialPage;
