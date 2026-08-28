/**
 * The single definition of "overdue," used everywhere an
 * onboarding_tasks list needs it: the HR "what's stuck" view (Step
 * 19), the Employee dashboard (Step 21), and the TaskOwner dashboard
 * (Step 20). Always computed against CURRENT_DATE at query time, never
 * written to a stored column — same "computed live, no drift" rule as
 * onboarding progress. A task already 'completed' or 'cancelled' is
 * never overdue regardless of its due_date.
 *
 * There's no shared query builder in this codebase to reuse a SQL
 * fragment through (every query is plain, hand-written SQL by design —
 * see DatabaseService), so this function is the actual source of
 * truth: every call site asks it for the expression instead of
 * re-typing the condition, so the definition can't quietly drift
 * between endpoints. Pass the table alias prefix used in that query's
 * FROM/JOIN clause (e.g. 'ot.'), or omit it for an unaliased,
 * single-table query.
 */
export function isOverdueSql(prefix = ''): string {
  return `(${prefix}due_date < CURRENT_DATE AND ${prefix}status NOT IN ('completed', 'cancelled'))`;
}
