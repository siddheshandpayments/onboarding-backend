import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { AuthenticatedUser } from '../auth/strategies/jwt.strategy';

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
 * Step 16 scope only: the dual-confirmation handover on the checkpoint
 * task specifically (completion_mode 'dual' tasks in general, and the
 * employee-only/owner-only modes for regular tasks, are Step 18).
 *
 * There's no per-task owner assignment mechanism yet (onboarding_tasks
 * .owner_user_id is left NULL at instantiation — see OnboardingsService),
 * so "the owner side" is authorized by role match against the task's
 * owner_role rather than a specific assigned individual. The employee
 * side is unambiguous — there's exactly one employee per onboarding —
 * so that check is a strict identity match, not a role match.
 */
@Injectable()
export class OnboardingTasksService {
  constructor(private readonly db: DatabaseService) {}

  async confirmOwnerIssued(taskId: string, actor: AuthenticatedUser) {
    const task = await this.getCheckpointTaskOrThrow(taskId);

    if (actor.role !== task.owner_role) {
      throw new ForbiddenException(
        `Only a ${task.owner_role} can confirm this side of the handover`,
      );
    }
    if (task.owner_confirmed_at) {
      throw new ConflictException('Already confirmed by the owner side');
    }

    return this.applyConfirmation(taskId, 'owner_confirmed_by', 'owner_confirmed_at', 'employee_confirmed_at', actor.id);
  }

  async confirmEmployeeReceived(taskId: string, actor: AuthenticatedUser) {
    const task = await this.getCheckpointTaskOrThrow(taskId);

    const { rows } = await this.db.query<{ user_id: string }>(
      `SELECT user_id FROM onboardings WHERE id = $1`,
      [task.onboarding_id],
    );
    const onboarding = rows[0];
    if (!onboarding || onboarding.user_id !== actor.id) {
      throw new ForbiddenException(
        'Only the employee on this onboarding can confirm receipt',
      );
    }
    if (task.employee_confirmed_at) {
      throw new ConflictException('Already confirmed by the employee');
    }

    return this.applyConfirmation(taskId, 'employee_confirmed_by', 'employee_confirmed_at', 'owner_confirmed_at', actor.id);
  }

  private async getCheckpointTaskOrThrow(taskId: string): Promise<OnboardingTaskRow> {
    const { rows } = await this.db.query<OnboardingTaskRow>(
      `SELECT * FROM onboarding_tasks WHERE id = $1`,
      [taskId],
    );
    const task = rows[0];
    if (!task) {
      throw new NotFoundException('Task not found');
    }
    if (!task.is_checkpoint || task.completion_mode !== 'dual') {
      throw new BadRequestException(
        'This endpoint only applies to the checkpoint handover task',
      );
    }
    if (task.status === 'cancelled') {
      throw new ConflictException('This task has been cancelled');
    }
    return task;
  }

  /**
   * One atomic UPDATE, not read-then-write: the CASE expressions read
   * the *other* side's confirmation column as of this statement's own
   * row lock, so two confirmations arriving concurrently still
   * serialize correctly — whichever commits second is the one that
   * sees the first's value and flips status to 'completed'. The
   * `<column> IS NULL` guard in WHERE makes a double-confirmation from
   * the same side a no-op (0 rows) rather than silently overwriting
   * who confirmed it.
   */
  private async applyConfirmation(
    taskId: string,
    confirmedByColumn: 'owner_confirmed_by' | 'employee_confirmed_by',
    confirmedAtColumn: 'owner_confirmed_at' | 'employee_confirmed_at',
    otherConfirmedAtColumn: 'owner_confirmed_at' | 'employee_confirmed_at',
    actorId: string,
  ): Promise<OnboardingTaskRow> {
    const { rows } = await this.db.query<OnboardingTaskRow>(
      `UPDATE onboarding_tasks
       SET ${confirmedByColumn} = $2,
           ${confirmedAtColumn} = now(),
           status = CASE WHEN ${otherConfirmedAtColumn} IS NOT NULL THEN 'completed' ELSE status END,
           completed_at = CASE WHEN ${otherConfirmedAtColumn} IS NOT NULL THEN now() ELSE completed_at END
       WHERE id = $1 AND ${confirmedAtColumn} IS NULL AND status <> 'cancelled'
       RETURNING *`,
      [taskId, actorId],
    );

    if (!rows[0]) {
      throw new ConflictException('Already confirmed from this side');
    }
    return rows[0];
  }
}
