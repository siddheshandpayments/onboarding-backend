/**
 * Naive placeholder: due_date = start_date + offsetDays, plain calendar
 * days, no weekend skipping. Step 13 replaces the body of this one
 * function with weekend-aware logic — every caller (OnboardingsService)
 * stays untouched, since the offset-to-date contract doesn't change.
 */
export function computeDueDate(startDate: Date, offsetDays: number): Date {
  const due = new Date(startDate);
  due.setUTCDate(due.getUTCDate() + offsetDays);
  return due;
}
