const POLL_INTERVAL_MS = 60_000;
const REFRESH_COOLDOWN_MS = 15_000;
const MAX_RETRY_DELAY_MS = 300_000;

/** One poll at a time, including while the CRM is in a background tab. */
export function startNotificationPolling(task: (signal: AbortSignal) => Promise<void>): {
  refresh(): void;
  stop(): void;
} {
  let stopped = false;
  let online = navigator.onLine !== false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let scheduledAt = Infinity;
  let lastStartedAt = -Infinity;
  let retryNotBefore = 0;
  let failures = 0;
  type ActiveRequest = {
    controller: AbortController;
    interruptedOffline: boolean;
  };
  let current: ActiveRequest | undefined;

  const canRun = () => !stopped && online && navigator.onLine !== false;
  function clearScheduled() {
    clearTimeout(timer);
    timer = undefined;
    scheduledAt = Infinity;
  }

  function schedule(at: number) {
    if (!canRun()) return;
    clearScheduled();
    scheduledAt = at;
    timer = setTimeout(() => {
      timer = undefined;
      scheduledAt = Infinity;
      void run();
    }, Math.max(0, at - Date.now()));
  }

  async function run() {
    if (!canRun() || current) return;
    lastStartedAt = Date.now();
    const request: ActiveRequest = { controller: new AbortController(), interruptedOffline: false };
    current = request;
    let failed = false;
    try {
      await task(request.controller.signal);
    } catch {
      failed = true;
    } finally {
      current = undefined;
      if (!stopped) {
        if (request.interruptedOffline) {
          // The online event may arrive before the aborted request settles.
          // Keep its existing retry deadline, but do not count going offline as a failure.
          schedule(Math.max(Date.now(), lastStartedAt + REFRESH_COOLDOWN_MS, retryNotBefore));
        } else if (failed) {
          failures = Math.min(failures + 1, 4);
          const delay = Math.min(POLL_INTERVAL_MS * 2 ** (failures - 1), MAX_RETRY_DELAY_MS);
          retryNotBefore = Date.now() + delay;
          schedule(retryNotBefore);
        } else {
          failures = 0;
          retryNotBefore = 0;
          schedule(Date.now() + POLL_INTERVAL_MS);
        }
      }
    }
  }

  function refresh() {
    // A running request already serves focus/open bursts. Do not queue another one.
    if (!canRun() || current) return;
    const now = Date.now();
    const at = Math.max(now, lastStartedAt + REFRESH_COOLDOWN_MS, retryNotBefore);
    // A suspended tab may resume before its overdue timer callback is dispatched.
    if (at < scheduledAt || scheduledAt <= now) schedule(at);
  }

  function becameVisible() {
    if (document.visibilityState === 'visible') refresh();
  }
  function becameOnline() {
    online = true;
    refresh();
  }
  function becameOffline() {
    online = false;
    clearScheduled();
    if (current) {
      current.interruptedOffline = true;
      current.controller.abort();
    }
  }

  window.addEventListener('focus', refresh);
  window.addEventListener('online', becameOnline);
  window.addEventListener('offline', becameOffline);
  document.addEventListener('visibilitychange', becameVisible);
  void run();

  return {
    refresh,
    stop() {
      if (stopped) return;
      stopped = true;
      clearScheduled();
      current?.controller.abort();
      window.removeEventListener('focus', refresh);
      window.removeEventListener('online', becameOnline);
      window.removeEventListener('offline', becameOffline);
      document.removeEventListener('visibilitychange', becameVisible);
    },
  };
}
