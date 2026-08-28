function isWeekend(date: Date): boolean {
  const day = date.getUTCDay();
  return day === 0 || day === 6; // Sunday, Saturday
}

/**
 * due_date = start_date advanced by `offsetDays` business days, Saturday
 * and Sunday never counted and never landed on. offsetDays = 0 is the
 * start date itself (Day 1 tasks are due the day the employee joins);
 * each unit above that walks forward one calendar day at a time,
 * skipping weekend days without consuming an offset unit for them.
 *
 * start_date is assumed to already be a weekday (HR picks it) — this
 * function doesn't push a weekend start date forward, it only skips
 * weekends while walking the offset.
 */
export function computeDueDate(startDate: Date, offsetDays: number): Date {
  const due = new Date(startDate);
  let remaining = offsetDays;
  while (remaining > 0) {
    due.setUTCDate(due.getUTCDate() + 1);
    if (!isWeekend(due)) {
      remaining--;
    }
  }
  return due;
}
