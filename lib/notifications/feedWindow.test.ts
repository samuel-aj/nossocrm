import { expect, it, vi } from 'vitest';
import { isFreshNotice } from './feedWindow';

it('presents only events within the server two-minute window, including its boundary', () => {
  const now = '2026-11-27T14:00:00.000Z';
  expect(isFreshNotice(now, now)).toBe(true);
  expect(isFreshNotice('2026-11-27T13:58:00.000Z', now)).toBe(true);
  expect(isFreshNotice('2026-11-27T13:57:59.999Z', now)).toBe(false);
  expect(isFreshNotice('2026-10-24T13:58:00.000Z', now)).toBe(false);
});

it('does not treat invalid or future timestamps as new alerts', () => {
  const now = '2026-11-27T14:00:00.000Z';
  expect(isFreshNotice('invalid', now)).toBe(false);
  expect(isFreshNotice(now, 'invalid')).toBe(false);
  expect(isFreshNotice('2026-11-27T14:00:00.001Z', now)).toBe(false);
});

it('does not depend on the device clock', () => {
  const clock = vi.spyOn(Date, 'now').mockReturnValue(0);
  try {
    expect(isFreshNotice('2026-11-27T13:59:00Z', '2026-11-27T14:00:00Z')).toBe(true);
  } finally { clock.mockRestore(); }
});
