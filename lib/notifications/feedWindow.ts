// A tab can be suspended or offline longer than the regular polling interval.
// Catch up a bounded day of history without replaying old sounds or banners.
export const NOTIFICATION_CATCHUP_MS = 24 * 60 * 60 * 1000;
export const NOTIFICATION_FRESH_MS = 2 * 60 * 1000;

// Ongoing incidents belong in the bell until resolved, but their original
// timestamp must not become a new interruption whenever the CRM is reopened.
export function isFreshNotice(createdAt: string, serverTime: string): boolean {
  const age = Date.parse(serverTime) - Date.parse(createdAt);
  return Number.isFinite(age) && age >= 0 && age <= NOTIFICATION_FRESH_MS;
}
