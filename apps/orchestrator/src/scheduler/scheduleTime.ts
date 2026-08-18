/** Next local time matching HH:MM on one of daysOfWeek (0=Sun..6=Sat). */
export function computeNextRun(
  timeOfDay: string,
  daysOfWeek: number[],
  from: Date
): Date | null {
  if (!daysOfWeek.length) return null;
  const [hours, minutes] = timeOfDay.split(":").map(Number);
  for (let offset = 0; offset < 8; offset++) {
    const candidate = new Date(from);
    candidate.setDate(candidate.getDate() + offset);
    candidate.setHours(hours, minutes, 0, 0);
    if (candidate <= from) continue;
    if (daysOfWeek.includes(candidate.getDay())) return candidate;
  }
  return null;
}
