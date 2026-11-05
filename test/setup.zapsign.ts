import { vi } from 'vitest';

// Unit tests execute server modules without a Next.js request runtime.
vi.mock('server-only', () => ({}));
