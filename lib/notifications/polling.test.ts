import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { startNotificationPolling } from './polling';

let online: boolean;
let visibility: DocumentVisibilityState;
let polling: ReturnType<typeof startNotificationPolling> | undefined;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-27T12:00:00Z'));
  online = true;
  visibility = 'visible';
  vi.spyOn(navigator, 'onLine', 'get').mockImplementation(() => online);
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility);
});
afterEach(() => {
  polling?.stop();
  polling = undefined;
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const tick = (ms = 0) => vi.advanceTimersByTimeAsync(ms);
function setOnline(value: boolean) {
  online = value;
  window.dispatchEvent(new Event(value ? 'online' : 'offline'));
}
function setVisible(value: DocumentVisibilityState) {
  visibility = value;
  document.dispatchEvent(new Event('visibilitychange'));
}

it('polls once on entry and once a minute instead of every four seconds', async () => {
  const task = vi.fn().mockResolvedValue(undefined);
  polling = startNotificationPolling(task);
  await tick();
  expect(task).toHaveBeenCalledTimes(1);
  await tick(59_999);
  expect(task).toHaveBeenCalledTimes(1);
  await tick(1);
  expect(task).toHaveBeenCalledTimes(2);
  await tick(60_000);
  expect(task).toHaveBeenCalledTimes(3);
});

it('keeps the one-minute background cycle for desktop and sound notifications', async () => {
  visibility = 'hidden';
  const task = vi.fn().mockResolvedValue(undefined);
  polling = startNotificationPolling(task);
  await tick(60_000);
  expect(task).toHaveBeenCalledTimes(2);
  setVisible('visible');
  await tick(10_000);
  expect(task).toHaveBeenCalledTimes(2);
  setVisible('hidden');
  await tick(5_000);
  expect(task).toHaveBeenCalledTimes(3);
});

it('coalesces focus, visibility, online and manual refresh bursts behind a 15-second cooldown', async () => {
  const task = vi.fn().mockResolvedValue(undefined);
  polling = startNotificationPolling(task);
  await tick(5_000);
  for (let i = 0; i < 10; i++) {
    window.dispatchEvent(new Event('focus'));
    setVisible('visible');
    setOnline(true);
    polling.refresh();
  }
  await tick(9_999);
  expect(task).toHaveBeenCalledTimes(1);
  await tick(1);
  expect(task).toHaveBeenCalledTimes(2);
  await tick(59_999);
  expect(task).toHaveBeenCalledTimes(2);
  await tick(1);
  expect(task).toHaveBeenCalledTimes(3);
});

it('does not add an immediate request when the tab becomes hidden', async () => {
  const task = vi.fn().mockResolvedValue(undefined);
  polling = startNotificationPolling(task);
  await tick(20_000);
  setVisible('hidden');
  await tick(39_999);
  expect(task).toHaveBeenCalledTimes(1);
  await tick(1);
  expect(task).toHaveBeenCalledTimes(2);
});

it('refreshes immediately on focus after suspension instead of waiting for an overdue timer', async () => {
  const task = vi.fn().mockResolvedValue(undefined);
  polling = startNotificationPolling(task);
  await tick();
  vi.setSystemTime(Date.now() + 600_000);
  window.dispatchEvent(new Event('focus'));
  setVisible('visible');
  polling.refresh();
  await tick();
  expect(task).toHaveBeenCalledTimes(2);
  await tick(59_999);
  expect(task).toHaveBeenCalledTimes(2);
  await tick(1);
  expect(task).toHaveBeenCalledTimes(3);
});

it('waits for connectivity on entry and cancels future polls when the network goes offline', async () => {
  online = false;
  const task = vi.fn().mockResolvedValue(undefined);
  polling = startNotificationPolling(task);
  polling.refresh();
  await tick(600_000);
  expect(task).not.toHaveBeenCalled();
  setOnline(true);
  await tick();
  expect(task).toHaveBeenCalledTimes(1);
  setOnline(false);
  await tick(600_000);
  expect(task).toHaveBeenCalledTimes(1);
  setOnline(true);
  await tick();
  expect(task).toHaveBeenCalledTimes(2);
});

it('aborts offline work and resumes once, without an overlapping request or a failure penalty', async () => {
  let settle!: () => void;
  const signals: AbortSignal[] = [];
  const task = vi.fn((signal: AbortSignal) => {
    signals.push(signal);
    return signals.length === 1 ? new Promise<void>(resolve => { settle = resolve; }) : Promise.resolve();
  });
  polling = startNotificationPolling(task);
  await tick(5_000);
  setOnline(false);
  expect(signals[0].aborted).toBe(true);
  setOnline(true);
  polling.refresh();
  await tick(1_000);
  expect(task).toHaveBeenCalledTimes(1);
  settle();
  await tick(8_999);
  expect(task).toHaveBeenCalledTimes(1);
  await tick(1);
  expect(task).toHaveBeenCalledTimes(2);
  expect(signals[1].aborted).toBe(false);
  await tick(60_000);
  expect(task).toHaveBeenCalledTimes(3);
});

it('starts the regular interval after completion and absorbs refreshes during a request', async () => {
  let settle!: () => void;
  const task = vi.fn().mockImplementationOnce(() => new Promise<void>(resolve => { settle = resolve; }))
    .mockResolvedValue(undefined);
  polling = startNotificationPolling(task);
  await tick(10_000);
  window.dispatchEvent(new Event('focus'));
  polling.refresh();
  settle();
  await tick(59_999);
  expect(task).toHaveBeenCalledTimes(1);
  await tick(1);
  expect(task).toHaveBeenCalledTimes(2);
});

it('lets a long delivery batch finish without aborting it or overlapping the next poll', async () => {
  let settle!: () => void;
  let signal!: AbortSignal;
  const task = vi.fn().mockImplementationOnce((received: AbortSignal) => {
    signal = received;
    return new Promise<void>(resolve => { settle = resolve; });
  }).mockResolvedValue(undefined);
  polling = startNotificationPolling(task);
  await tick(20_000);
  expect(signal.aborted).toBe(false);
  polling.refresh();
  window.dispatchEvent(new Event('focus'));
  await tick(600_000);
  expect(task).toHaveBeenCalledTimes(1);
  expect(signal.aborted).toBe(false);
  settle();
  await tick(59_999);
  expect(task).toHaveBeenCalledTimes(1);
  await tick(1);
  expect(task).toHaveBeenCalledTimes(2);
});

it('backs off failures for 60, 120, 240 and at most 300 seconds without a focus bypass', async () => {
  const task = vi.fn().mockRejectedValue(new Error('unavailable'));
  polling = startNotificationPolling(task);
  await tick();
  for (const [index, delay] of [60_000, 120_000, 240_000, 300_000, 300_000].entries()) {
    await tick(delay - 1);
    window.dispatchEvent(new Event('focus'));
    polling.refresh();
    setVisible('visible');
    expect(task).toHaveBeenCalledTimes(index + 1);
    await tick(1);
    expect(task).toHaveBeenCalledTimes(index + 2);
  }
});

it('preserves a failure deadline across an offline/online transition', async () => {
  const task = vi.fn().mockRejectedValue(new Error('unavailable'));
  polling = startNotificationPolling(task);
  await tick(20_000);
  setOnline(false);
  await tick(5_000);
  setOnline(true);
  polling.refresh();
  await tick(34_999);
  expect(task).toHaveBeenCalledTimes(1);
  await tick(1);
  expect(task).toHaveBeenCalledTimes(2);
});

it('resets backoff after a successful request', async () => {
  const task = vi.fn().mockRejectedValueOnce(new Error('one')).mockRejectedValueOnce(new Error('two'))
    .mockResolvedValueOnce(undefined).mockRejectedValue(new Error('three'));
  polling = startNotificationPolling(task);
  await tick(180_000);
  expect(task).toHaveBeenCalledTimes(3);
  await tick(60_000);
  expect(task).toHaveBeenCalledTimes(4);
  await tick(60_000);
  expect(task).toHaveBeenCalledTimes(5);
});

it('stop aborts in-flight work and removes all wake-up paths', async () => {
  let signal!: AbortSignal;
  const task = vi.fn((received: AbortSignal) => {
    signal = received;
    return new Promise<void>((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    });
  });
  polling = startNotificationPolling(task);
  polling.stop();
  polling.stop();
  expect(signal.aborted).toBe(true);
  polling.refresh();
  window.dispatchEvent(new Event('focus'));
  setVisible('visible');
  setOnline(false);
  setOnline(true);
  await tick(600_000);
  expect(task).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
});

it('stop cancels a scheduled refresh and the next periodic request', async () => {
  const task = vi.fn().mockResolvedValue(undefined);
  polling = startNotificationPolling(task);
  await tick(5_000);
  polling.refresh();
  polling.stop();
  await tick(600_000);
  expect(task).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
});

it('does not schedule more work after stop even when the task ignores abort and settles later', async () => {
  let settle!: () => void;
  let signal!: AbortSignal;
  const task = vi.fn((received: AbortSignal) => {
    signal = received;
    return new Promise<void>(resolve => { settle = resolve; });
  });
  polling = startNotificationPolling(task);
  polling.stop();
  expect(signal.aborted).toBe(true);
  expect(vi.getTimerCount()).toBe(0);
  settle();
  await tick();
  expect(vi.getTimerCount()).toBe(0);
});
