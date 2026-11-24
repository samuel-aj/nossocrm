import { vi } from 'vitest';

// Each transport test supplies its own fake fetch. An accidental request should fail locally.
vi.stubGlobal('fetch', async () => { throw new Error('A rede está desativada nesta suíte de notificações.'); });
