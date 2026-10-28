/** Local calendar week, Monday 00:00 through Sunday 23:59:59.999. */
export function calendarWeekRange(now: Date, previous = false) {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const daysSinceMonday = (start.getDay() + 6) % 7;
  start.setDate(start.getDate() - daysSinceMonday - (previous ? 7 : 0));
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  end.setHours(23, 59, 59, 999);
  return { start, end };
}
