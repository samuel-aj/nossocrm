import { notFound } from 'next/navigation';
import { WhatsAppChatDemo } from '@/features/whatsapp/WhatsAppChatDemo';

export const dynamic = 'force-dynamic';

export default function ChatDemoPage() {
  if (process.env.VERCEL_ENV !== 'preview' || process.env.VERCEL_GIT_COMMIT_REF !== 'staging') notFound();
  return <WhatsAppChatDemo startedAt={new Date().toISOString()} />;
}
