'use client';

import React from 'react';
import { GraduationCap, PlayCircle } from 'lucide-react';

interface TutorialVideo {
  /** ID do vídeo no YouTube (o que vem depois de `v=`). */
  youtubeId: string;
  title: string;
  description?: string;
}

/**
 * Vídeos do tutorial. Para adicionar novos, basta incluir mais itens aqui
 * (a página já renderiza a lista automaticamente).
 */
const TUTORIAL_VIDEOS: TutorialVideo[] = [
  {
    youtubeId: 'acteIEQeE5Y',
    title: 'Como usar a plataforma',
    description:
      'Tutorial completo para dar os primeiros passos no CRM: navegação, cadastro de leads, pipeline e muito mais.',
  },
];

export function TutorialPage() {
  return (
    <div className="h-full overflow-y-auto scrollbar-custom">
      <div className="max-w-5xl mx-auto p-4 sm:p-6 space-y-6">
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

        {/* Vídeos */}
        <div className="space-y-6">
          {TUTORIAL_VIDEOS.map((video) => (
            <div
              key={video.youtubeId}
              className="glass rounded-xl border border-slate-200 dark:border-white/5 shadow-sm overflow-hidden"
            >
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
              <div className="p-4 sm:p-5">
                <h2 className="flex items-center gap-2 text-base sm:text-lg font-bold text-slate-900 dark:text-white">
                  <PlayCircle size={18} className="text-primary-500 shrink-0" />
                  {video.title}
                </h2>
                {video.description && (
                  <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{video.description}</p>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default TutorialPage;
