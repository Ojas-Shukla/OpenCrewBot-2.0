interface CronField {
  values: Set<number>;
  wildcard: boolean;
}

function parseField(raw: string, min: number, max: number, field: string): CronField {
  const values = new Set<number>();
  const wildcard = raw === "*";
  for (const item of raw.split(",")) {
    const [rangePart, stepPart] = item.split("/");
    const step = stepPart === undefined ? 1 : Number(stepPart);
    if (!Number.isInteger(step) || step < 1) throw new Error(`Invalid ${field} step.`);
    let start: number;
    let end: number;
    if (rangePart === "*") {
      start = min;
      end = max;
    } else if (rangePart.includes("-")) {
      const bounds = rangePart.split("-").map(Number);
      if (bounds.length !== 2) throw new Error(`Invalid ${field} range.`);
      [start, end] = bounds;
    } else {
      start = Number(rangePart);
      end = stepPart === undefined ? start : max;
    }
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < min || end > max || start > end) {
      throw new Error(`Invalid ${field} value.`);
    }
    for (let value = start; value <= end; value += step) values.add(value);
  }
  if (!values.size) throw new Error(`Empty ${field} field.`);
  return { values, wildcard };
}

function parseCron(expression: string): [CronField, CronField, CronField, CronField, CronField] {
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5) throw new Error("Cron expression must have five fields.");
  return [
    parseField(fields[0], 0, 59, "minute"),
    parseField(fields[1], 0, 23, "hour"),
    parseField(fields[2], 1, 31, "day of month"),
    parseField(fields[3], 1, 12, "month"),
    parseField(fields[4], 0, 7, "day of week"),
  ];
}

export function validateCron(expression: string): void {
  if (expression === "@hourly" || expression === "@daily") return;
  parseCron(expression);
}

export function nextCronRun(expression: string, from = new Date()): Date {
  if (expression === "@hourly") {
    const next = new Date(from);
    next.setUTCHours(next.getUTCHours() + 1, 0, 0, 0);
    return next;
  }
  if (expression === "@daily") {
    const next = new Date(from);
    next.setUTCDate(next.getUTCDate() + 1);
    next.setUTCHours(0, 0, 0, 0);
    return next;
  }
  const [minute, hour, day, month, weekday] = parseCron(expression);
  const candidate = new Date(from);
  candidate.setUTCSeconds(0, 0);
  candidate.setUTCMinutes(candidate.getUTCMinutes() + 1);
  const maxMinutes = 366 * 24 * 60 * 5;
  for (let index = 0; index < maxMinutes; index++, candidate.setUTCMinutes(candidate.getUTCMinutes() + 1)) {
    const domMatches = day.values.has(candidate.getUTCDate());
    const dow = candidate.getUTCDay();
    const dowMatches = weekday.values.has(dow) || (dow === 0 && weekday.values.has(7));
    const calendarMatches =
      day.wildcard ? dowMatches :
        weekday.wildcard ? domMatches :
          domMatches || dowMatches;
    if (
      minute.values.has(candidate.getUTCMinutes()) &&
      hour.values.has(candidate.getUTCHours()) &&
      calendarMatches &&
      month.values.has(candidate.getUTCMonth() + 1)
    ) return new Date(candidate);
  }
  throw new Error("No matching time found within the next five years.");
}
