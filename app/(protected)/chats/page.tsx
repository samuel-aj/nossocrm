import { ChatsClient } from '@/features/chats/ChatsClient';

export const dynamic = 'force-dynamic';

export default function Chats() {
    const stagingDemo = process.env.VERCEL_ENV === 'preview' && process.env.VERCEL_GIT_COMMIT_REF === 'staging';
    return <ChatsClient stagingDemo={stagingDemo} />;
}
