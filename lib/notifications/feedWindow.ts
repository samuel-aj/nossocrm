// A tab can be suspended or offline longer than the regular polling interval.
// Catch up a bounded day of history without replaying old sounds or banners.
export const NOTIFICATION_CATCHUP_MS = 24 * 60 * 60 * 1000;
export const NOTIFICATION_FRESH_MS = 2 * 60 * 1000;
