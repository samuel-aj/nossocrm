'use client';

import dynamic from 'next/dynamic';
import { PageLoader } from '@/components/PageLoader';

const ChatsPage = dynamic(
  () => import('./ChatsPage').then(m => ({ default: m.ChatsPage })),
  { loading: () => <PageLoader />, ssr: false }
);

export function ChatsClient({ stagingDemo = false }: { stagingDemo?: boolean }) {
  return <ChatsPage stagingDemo={stagingDemo} />;
}
