import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PoolClient } from 'pg';
import { DatabaseService } from '../database/database.service';
import { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { ActivityLogService } from '../activity-log/activity-log.service';
import { isOverdueSql } from './utils/overdue.util';
import {
  assertDateIfPresent,
  assertOneOfIfPresent,
  assertOnlyAllowedKeys,
  parseSort,
  parsePagination,
  paginateRows,
} from '../common/list-query.util';

const TASK_STATUS_VALUES = [
  'locked',
  'pending',
  'in_progress',
  'blocked',
  'completed',
  'cancelled',
] as const;
const PRIORITY_VALUES = ['low', 'normal', 'high'] as const;

/** Bare column names as they appear in listMyTasks' OUTER query (the
 *  wrapping SELECT * FROM (...)) — built from a fixed dictionary keyed
 *  by the already-allow-listed sort field, never the client's raw
 *  sort string. */
const TASK_SORT_EXPRESSIONS: Record<string, string> = {
  dueDate: 'due_date',
  priority: `CASE priority WHEN 'high' THEN 3 WHEN 'normal' THEN 2 WHEN 'low' THEN 1 ELSE 0 END`,
};

export interface OnboardingTaskRow {
  id: string;
  onboarding_id: string;
  source_template_task_id: string | null;
  title: string;
  description: string | null;
  owner_role: string;
  owner_user_id: string | null;
  due_date: Date;
  priority: string;
  is_required: boolean;
  completion_mode: string;
  is_checkpoint: boolean;
  status: string;
  blocked_reason: string | null;
  cancel_reason: string | null;
  employee_confirmed_by: string | null;
  employee_confirmed_at: Date | null;
  owner_confirmed_by: string | null;
  owner_confirmed_at: Date | null;
  completed_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

/**
 * Step 18 generalizes Step 16's checkpoint-only dual confirmation to
 * all three completion_mode values, for any task:
 *   - 'employee': the employee alone closes it, one action.
 *   - 'owner':    a user matching the task's owner_role alone closes
 *                 it, one action.
 *   - 'dual':     both sides must confirm independently — same
 *                 mechanism the checkpoint already used in Step 16/17,
 *                 now available to any task marked 'dual', not just
 *                 is_checkpoint ones.
 *
 * The two endpoints stay "which side is confirming", not "which mode
 * is this" — the caller doesn't need to know a task's completion_mode
 * up front; the service figures out from completion_mode whether their
 * confirmation alone finishes the task (employee/owner) or needs to
 * wait on the other side (dual).
 *
 * Step 20 adds the missing piece: onboarding_tasks.owner_user_id stays
 * NULL at instantiation (see OnboardingsService), and until now nothing
 * ever set it — "the owner side" was authorized by role match against
 * owner_role alone. claimTask() lets any task_owner claim an unclaimed
 * owner/dual task matching their role, which is what makes a "tasks
 * scoped to owner_id = self" dashboard (listMyTasks) mean anything.
 * completeAsOwner() now prefers a specific claim when one exists —
 * once claimed, only that task_owner may complete it — and falls back
 * to the original role-match behavior for never-claimed tasks (e.g. the
 * checkpoint handover, which nothing in this codebase claims). The
 * employee side is unaffected: still a strict identity match against
 * the onboarding's user_id, since there's exactly one employee per
 * onboarding and nothing to claim.
 */
@Injectable()
export class OnboardingTasksService {
  constructor(
    private readonly db: DatabaseService,
    private readonly activityLog: ActivityLogService,
  ) {}

  async completeAsOwner(taskId: string, actor: AuthenticatedUser) {
    const task = await this.getActionableTaskOrThrow(taskId);

    if (task.completion_mode === 'employee') {
      throw new BadRequestException('This task does not take an owner confirmation');
    }
    if (task.owner_user_id) {
      if (task.owner_user_id !== actor.id) {
        throw new ForbiddenException(
          'This task has been claimed by a different task owner',
        );
      }
    } else if (actor.role !== task.owner_role) {
      throw new ForbiddenException(`Only a ${task.owner_role} can complete this task`);
    }
    if (task.owner_confirmed_at) {
      throw new ConflictException('Already confirmed by the owner side');
    }

    if (task.completion_mode === 'owner') {
      return this.completeSingleSided(
        taskId,
        'owner_confirmed_by',
        'owner_confirmed_at',
        actor.id,
        'onboarding_task.owner_completed',
      );
    }
    return this.applyDualConfirmation(
      taskId,
      'owner_confirmed_by',
      'owner_confirmed_at',
      'employee_confirmed_at',
      actor.id,
      'onboarding_task.owner_confirmed',
    );
  }

  async completeAsEmployee(taskId: string, actor: AuthenticatedUser) {
    const task = await this.getActionableTaskOrThrow(taskId);

    if (task.completion_mode === 'owner') {
      throw new BadRequestException('This task does not take an employee confirmation');
    }

    const onboarding = await this.getOnboardingOrThrow(task.onboarding_id);
    if (onboarding.user_id !== actor.id) {
      throw new ForbiddenException(
        'Only the employee on this onboarding can complete this task',
      );
    }
    if (task.employee_confirmed_at) {
      throw new ConflictException('Already confirmed by the employee');
    }

    if (task.completion_mode === 'employee') {
      return this.completeSingleSided(
        taskId,
        'employee_confirmed_by',
        'employee_confirmed_at',
        actor.id,
        'onboarding_task.employee_completed',
      );
    }
    return this.applyDualConfirmation(
      taskId,
      'employee_confirmed_by',
      'employee_confirmed_at',
      'owner_confirmed_at',
      actor.id,
      'onboarding_task.employee_confirmed',
    );
  }

  /**
   * Self-service claim: a task_owner takes ownership of a specific
   * owner/dual task matching their role, as long as nobody's claimed
   * it yet. This is a different "claim" than KnowledgeModule's
   * ClaimedAccountGuard (which is about a claimed login account) —
   * unrelated concepts that happen to share the word.
   *
   * Employee-mode tasks have no owner side at all — owner_role is set
   * on them too (e.g. "read the onboarding guide" has owner_role
   * 'employee'), but there's nothing for a task_owner to claim there.
   */
  async claimTask(taskId: string, actor: AuthenticatedUser): Promise<OnboardingTaskRow> {
    const task = await this.getActionableTaskOrThrow(taskId);

    if (task.completion_mode === 'employee') {
      throw new BadRequestException('This task has no owner side to claim');
    }
    if (actor.role !== task.owner_role) {
      throw new ForbiddenException(`Only a ${task.owner_role} can claim this task`);
    }
    if (task.owner_user_id) {
      throw new ConflictException('This task has already been claimed');
    }

    const { rows } = await this.db.query<OnboardingTaskRow>(
      `UPDATE onboarding_tasks SET owner_user_id = $2
       WHERE id = $1 AND owner_user_id IS NULL
       RETURNING *`,
      [taskId, actor.id],
    );
    if (!rows[0]) {
      throw new ConflictException('This task has already been claimed');
    }

    await this.activityLog.log({
      actorId: actor.id,
      action: 'onboarding_task.claimed',
      entityType: 'onboarding_task',
      entityId: taskId,
    });

    return rows[0];
  }

  /**
   * Step 20: the TaskOwner dashboard. Scoped server-side to
   * owner_user_id = actor.id — not a role filter, not a client-
   * supplied id — so a task_owner only ever sees tasks they've
   * personally claimed, across every onboarding. is_overdue (Step 25)
   * uses the same shared definition as the HR and Employee dashboards.
   *
   * Step 32: allow-listed status/priority/dateFrom/dateTo filters on
   * top of that base scope, plus dueDate/priority sort. `query` is the
   * full raw query object so assertOnlyAllowedKeys can reject any key
   * outside that list rather than silently ignore it.
   */
  async listMyTasks(actor: AuthenticatedUser, query: Record<string, string | undefined>) {
    assertOnlyAllowedKeys(query, [
      'status',
      'priority',
      'dateFrom',
      'dateTo',
      'sort',
      'limit',
      'offset',
    ]);
    assertOneOfIfPresent(query.status, 'status', TASK_STATUS_VALUES);
    assertOneOfIfPresent(query.priority, 'priority', PRIORITY_VALUES);
    assertDateIfPresent(query.dateFrom, 'dateFrom');
    assertDateIfPresent(query.dateTo, 'dateTo');
    const { field, direction } = parseSort(query.sort, Object.keys(TASK_SORT_EXPRESSIONS), 'dueDate');
    const pagination = parsePagination(query);

    const { rows } = await this.db.query(
      `SELECT *, COUNT(*) OVER()::int AS total_count FROM (
         SELECT
           ot.id, ot.onboarding_id, ot.title, ot.description, ot.due_date,
           ot.priority, ot.status, ot.completion_mode, ot.is_checkpoint,
           ot.blocked_reason,
           ${isOverdueSql('ot.')} AS is_overdue,
           u.full_name AS employee_name,
           d.name AS department_name
         FROM onboarding_tasks ot
         JOIN onboardings o ON o.id = ot.onboarding_id
         JOIN users u ON u.id = o.user_id
         JOIN departments d ON d.id = o.department_id
         WHERE ot.owner_user_id = $1
           AND ($2::text IS NULL OR ot.status = $2)
           AND ($3::text IS NULL OR ot.priority = $3)
           AND ($4::date IS NULL OR ot.due_date >= $4)
           AND ($5::date IS NULL OR ot.due_date <= $5)
       ) AS task_rows
       ORDER BY ${TASK_SORT_EXPRESSIONS[field]} ${direction}
       LIMIT $6 OFFSET $7`,
      [
        actor.id,
        query.status ?? null,
        query.priority ?? null,
        query.dateFrom ?? null,
        query.dateTo ?? null,
        pagination.limit,
        pagination.offset,
      ],
    );
    return paginateRows(rows, pagination);
  }

  /** The other half of claimTask(): what a task_owner can see to claim
   *  in the first place. Same actionability rules as claimTask itself
   *  (not locked/cancelled/completed, has an owner side, unclaimed,
   *  role matches) so nothing shown here would fail if claimed. */
  async listClaimableTasks(actor: AuthenticatedUser) {
    const { rows } = await this.db.query(
      `SELECT
         ot.id, ot.onboarding_id, ot.title, ot.description, ot.due_date,
         ot.priority, ot.status, ot.completion_mode, ot.is_checkpoint,
         u.full_name AS employee_name,
         d.name AS department_name
       FROM onboarding_tasks ot
       JOIN onboardings o ON o.id = ot.onboarding_id
       JOIN users u ON u.id = o.user_id
       JOIN departments d ON d.id = o.department_id
       WHERE ot.owner_role = $1
         AND ot.owner_user_id IS NULL
         AND ot.completion_mode != 'employee'
         AND ot.status NOT IN ('locked', 'cancelled', 'completed')
       ORDER BY ot.due_date ASC`,
      [actor.role],
    );
    return rows;
  }

  private async getActionableTaskOrThrow(taskId: string): Promise<OnboardingTaskRow> {
    const { rows } = await this.db.query<OnboardingTaskRow>(
      `SELECT * FROM onboarding_tasks WHERE id = $1`,
      [taskId],
    );
    const task = rows[0];
    if (!task) {
      throw new NotFoundException('Task not found');
    }
    if (task.status === 'locked') {
      throw new ForbiddenException(
        'This task is locked until the checkpoint is completed',
      );
    }
    if (task.status === 'cancelled') {
      throw new ConflictException('This task has been cancelled');
    }
    if (task.status === 'completed') {
      throw new ConflictException('This task is already completed');
    }
    return task;
  }

  private async getOnboardingOrThrow(onboardingId: string): Promise<{ user_id: string }> {
    const { rows } = await this.db.query<{ user_id: string }>(
      `SELECT user_id FROM onboardings WHERE id = $1`,
      [onboardingId],
    );
    const onboarding = rows[0];
    if (!onboarding) {
      throw new NotFoundException('Onboarding not found');
    }
    return onboarding;
  }

  /** employee-only / owner-only: one action closes the task outright —
   *  no other side to wait on. The confirmation column is still
   *  recorded (who/when), it just isn't gating anything. */
  private async completeSingleSided(
    taskId: string,
    confirmedByColumn: 'owner_confirmed_by' | 'employee_confirmed_by',
    confirmedAtColumn: 'owner_confirmed_at' | 'employee_confirmed_at',
    actorId: string,
    action: string,
  ): Promise<OnboardingTaskRow> {
    const { rows } = await this.db.query<OnboardingTaskRow>(
      `UPDATE onboarding_tasks
       SET ${confirmedByColumn} = $2,
           ${confirmedAtColumn} = now(),
           status = 'completed',
           completed_at = now()
       WHERE id = $1 AND ${confirmedAtColumn} IS NULL AND status NOT IN ('cancelled', 'completed')
       RETURNING *`,
      [taskId, actorId],
    );

    if (!rows[0]) {
      throw new ConflictException('Already completed');
    }

    await this.activityLog.log({
      actorId,
      action,
      entityType: 'onboarding_task',
      entityId: taskId,
    });

    return rows[0];
  }

  /**
   * dual: one atomic UPDATE, not read-then-write — the CASE expressions
   * read the *other* side's confirmation column as of this statement's
   * own row lock, so two confirmations arriving concurrently still
   * serialize correctly (whichever commits second is the one that sees
   * the first's value and flips status to 'completed'). The
   * `<column> IS NULL` guard in WHERE makes a double-confirmation from
   * the same side a no-op (0 rows) rather than silently overwriting
   * who confirmed it.
   *
   * When this confirmation is the one that completes the CHECKPOINT
   * specifically (is_checkpoint, not just any dual task — Step 17),
   * two more things happen in the same transaction: every other
   * 'locked' task on this onboarding flips to 'pending', and the
   * onboarding itself advances to 'active'. A regular dual-mode task
   * (is_checkpoint = false) completing does neither — it's just a task.
   */
  private async applyDualConfirmation(
    taskId: string,
    confirmedByColumn: 'owner_confirmed_by' | 'employee_confirmed_by',
    confirmedAtColumn: 'owner_confirmed_at' | 'employee_confirmed_at',
    otherConfirmedAtColumn: 'owner_confirmed_at' | 'employee_confirmed_at',
    actorId: string,
    action: string,
  ): Promise<OnboardingTaskRow> {
    return this.db.transaction(async (client) => {
      const { rows } = await client.query<OnboardingTaskRow>(
        `UPDATE onboarding_tasks
         SET ${confirmedByColumn} = $2,
             ${confirmedAtColumn} = now(),
             status = CASE WHEN ${otherConfirmedAtColumn} IS NOT NULL THEN 'completed' ELSE status END,
             completed_at = CASE WHEN ${otherConfirmedAtColumn} IS NOT NULL THEN now() ELSE completed_at END
         WHERE id = $1 AND ${confirmedAtColumn} IS NULL AND status NOT IN ('cancelled', 'completed')
         RETURNING *`,
        [taskId, actorId],
      );

      const task = rows[0];
      if (!task) {
        throw new ConflictException('Already confirmed from this side');
      }

      await this.activityLog.log(
        {
          actorId,
          action,
          entityType: 'onboarding_task',
          entityId: taskId,
          metadata: { completedThisConfirmation: task.status === 'completed' },
        },
        client,
      );

      if (task.status === 'completed' && task.is_checkpoint) {
        await this.unlockPhaseTwoTasks(client, task.onboarding_id);
        await this.activateOnboarding(client, task.onboarding_id);
      }

      return task;
    });
  }

  /** The phase-2 gate itself: everything that started 'locked' at
   *  instantiation (see OnboardingsService.insertOnboardingTask)
   *  becomes actionable the moment the checkpoint is done. Tasks in
   *  any other status (already 'pending'/'completed'/'cancelled') are
   *  untouched. */
  private async unlockPhaseTwoTasks(client: PoolClient, onboardingId: string) {
    await client.query(
      `UPDATE onboarding_tasks SET status = 'pending'
       WHERE onboarding_id = $1 AND status = 'locked'`,
      [onboardingId],
    );
  }

  /** Third and final onboarding.status transition (Step 17). Guarded
   *  on an IN-list of every pre-active status rather than exactly
   *  'checkpoint_pending' — HR/IT/the employee are independent actors,
   *  so the checkpoint can realistically be confirmed before the
   *  company email dance is finished. This only ever moves status
   *  forward, and is a no-op if the onboarding is already active or
   *  beyond. */
  private async activateOnboarding(client: PoolClient, onboardingId: string) {
    await client.query(
      `UPDATE onboardings SET status = 'active'
       WHERE id = $1 AND status IN ('pre_onboarding', 'email_provisioned', 'checkpoint_pending')`,
      [onboardingId],
    );
  }
}
