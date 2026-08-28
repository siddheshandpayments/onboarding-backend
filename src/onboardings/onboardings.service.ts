import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PoolClient, QueryResult, QueryResultRow } from 'pg';
import { DatabaseService } from '../database/database.service';
import { UsersService } from '../users/users.service';
import { TemplatesService } from '../templates/templates.service';
import { ActivityLogService } from '../activity-log/activity-log.service';
import { CreateOnboardingDto } from './dto/create-onboarding.dto';
import { ProvisionCompanyEmailDto } from './dto/provision-company-email.dto';
import { computeDueDate } from './utils/due-date.util';
import { isOverdueSql } from './utils/overdue.util';
import { AuthenticatedUser } from '../auth/strategies/jwt.strategy';

/** Same structural-typing trick as TemplatesService — lets the read
 *  helper below run against either the pooled DatabaseService or a
 *  transaction's PoolClient. */
interface Queryable {
  query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    params?: unknown[],
  ): Promise<QueryResult<T>>;
}

export interface OnboardingRow {
  id: string;
  user_id: string;
  department_id: string;
  template_id: string;
  template_version: number;
  start_date: Date;
  status: string;
  cancel_reason: string | null;
  created_at: Date;
  updated_at: Date;
}

const UNIQUE_VIOLATION = '23505';

@Injectable()
export class OnboardingsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly usersService: UsersService,
    private readonly templatesService: TemplatesService,
    private readonly activityLog: ActivityLogService,
  ) {}

  /**
   * Create-joiner: snapshots the employee's department's active
   * template into a fresh, dated checklist. Every field copied onto
   * onboarding_tasks below is frozen at this moment — Step 10's
   * template versioning is what makes that safe; a later template
   * edit publishes a new version and never touches these rows.
   */
  async createOnboarding(dto: CreateOnboardingDto, actorId: string) {
    const user = await this.usersService.findById(dto.userId);
    if (!user) {
      throw new NotFoundException('User not found');
    }
    if (user.role !== 'employee') {
      throw new BadRequestException('Only employee accounts can be onboarded');
    }
    if (!user.department_id) {
      throw new BadRequestException('Employee has no department set');
    }

    const template = await this.templatesService.getActiveTemplateForDepartment(
      user.department_id,
    );
    if (!template) {
      throw new NotFoundException('No active template for this department');
    }

    const startDate = new Date(dto.startDate);

    try {
      return await this.db.transaction(async (client) => {
        const { rows } = await client.query<OnboardingRow>(
          `INSERT INTO onboardings (user_id, department_id, template_id, template_version, start_date, status)
           VALUES ($1, $2, $3, $4, $5, 'pre_onboarding')
           RETURNING *`,
          [user.id, user.department_id, template.id, template.version, dto.startDate],
        );
        const onboarding = rows[0];

        for (const task of template.tasks) {
          await this.insertOnboardingTask(client, onboarding.id, task, startDate);
        }

        await this.activityLog.log(
          {
            actorId,
            action: 'onboarding.created',
            entityType: 'onboarding',
            entityId: onboarding.id,
            metadata: { userId: user.id, departmentId: user.department_id, templateId: template.id },
          },
          client,
        );

        return this.toOnboardingWithTasks(client, onboarding.id);
      });
    } catch (err: any) {
      if (err?.code === UNIQUE_VIOLATION) {
        throw new ConflictException('This user already has an onboarding');
      }
      throw err;
    }
  }

  /**
   * Every task starts 'locked' except the checkpoint itself, which
   * starts 'pending' so it's immediately actionable — it's what
   * unlocks everything else. Step 17 (Day 3) adds the transition that
   * flips the remaining phase-2 tasks to 'pending' once the checkpoint
   * reaches dual confirmation; nothing here needs to change for that.
   */
  private async insertOnboardingTask(
    client: PoolClient,
    onboardingId: string,
    task: {
      id: string;
      title: string;
      description: string | null;
      owner_role: string;
      due_offset_days: number;
      priority: string;
      is_required: boolean;
      completion_mode: string;
      is_checkpoint: boolean;
    },
    startDate: Date,
  ) {
    const dueDate = computeDueDate(startDate, task.due_offset_days);
    const status = task.is_checkpoint ? 'pending' : 'locked';

    await client.query(
      `INSERT INTO onboarding_tasks (
         onboarding_id, source_template_task_id, title, description,
         owner_role, due_date, priority, is_required, completion_mode,
         is_checkpoint, status
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        onboardingId,
        task.id,
        task.title,
        task.description,
        task.owner_role,
        dueDate.toISOString().slice(0, 10),
        task.priority,
        task.is_required,
        task.completion_mode,
        task.is_checkpoint,
        status,
      ],
    );
  }

  /**
   * Step 17, first of the two status transitions this module owns: HR
   * recording the company email moves the onboarding from
   * 'pre_onboarding' to 'email_provisioned'. Recording the email and
   * flipping onboarding status happen in one transaction — see
   * UsersService.recordCompanyEmail's optional queryable param.
   *
   * The guard is `status = 'pre_onboarding'` specifically (not a wider
   * IN-list): unlike the checkpoint-completion transition below, there's
   * exactly one legitimate prior state here, and re-provisioning a
   * company email for an onboarding that's already past this point
   * would be a mistake worth surfacing, not silently absorbing.
   */
  async provisionCompanyEmail(
    onboardingId: string,
    dto: ProvisionCompanyEmailDto,
    actorId: string,
  ) {
    const { rows } = await this.db.query<OnboardingRow>(
      `SELECT * FROM onboardings WHERE id = $1`,
      [onboardingId],
    );
    const onboarding = rows[0];
    if (!onboarding) {
      throw new NotFoundException('Onboarding not found');
    }
    if (onboarding.status !== 'pre_onboarding') {
      throw new ConflictException(
        `Cannot provision a company email from status '${onboarding.status}'`,
      );
    }

    return this.db.transaction(async (client) => {
      await this.usersService.recordCompanyEmail(
        onboarding.user_id,
        dto.companyEmail,
        client,
      );

      const { rows: updatedRows } = await client.query<OnboardingRow>(
        `UPDATE onboardings SET status = 'email_provisioned'
         WHERE id = $1 AND status = 'pre_onboarding'
         RETURNING *`,
        [onboardingId],
      );
      const updated = updatedRows[0];
      if (!updated) {
        throw new ConflictException(
          'Onboarding status changed concurrently — company email not provisioned',
        );
      }

      // Never the email address itself in metadata — not a secret like
      // a password or TOTP secret, but there's no audit need for it
      // either; entity_id (the onboarding) is enough to find it.
      await this.activityLog.log(
        {
          actorId,
          action: 'onboarding.email_provisioned',
          entityType: 'onboarding',
          entityId: onboardingId,
        },
        client,
      );

      return updated;
    });
  }

  /**
   * SuperAdmin/HR dashboard: every onboarding, company-wide, with
   * enough joined context (employee/department/template names, a live
   * required-task progress count) to actually be a dashboard row
   * rather than a bare foreign-key dump. Progress is two plain COUNT
   * subqueries against onboarding_tasks, never a stored column — same
   * "computed live, no drift possible" rule as everywhere else.
   *
   * Filters are optional equality only (`$n::type IS NULL OR ...`),
   * bound as query parameters rather than string-built — no dynamic
   * SQL. Neither departmentId nor status is validated against an
   * allow-list yet; an unknown status just yields zero rows. Step 32
   * generalizes this properly across every list endpoint.
   */
  async listAllOnboardings(filters: { departmentId?: string; status?: string }) {
    const { rows } = await this.db.query(
      `SELECT
         o.id, o.user_id, o.department_id, o.template_id, o.template_version,
         o.start_date, o.status, o.created_at, o.updated_at,
         u.full_name AS employee_name,
         d.name AS department_name,
         t.name AS template_name,
         (SELECT COUNT(*) FROM onboarding_tasks ot
            WHERE ot.onboarding_id = o.id AND ot.is_required = true) AS required_task_count,
         (SELECT COUNT(*) FROM onboarding_tasks ot
            WHERE ot.onboarding_id = o.id AND ot.is_required = true
              AND ot.status = 'completed') AS required_task_completed_count
       FROM onboardings o
       JOIN users u ON u.id = o.user_id
       JOIN departments d ON d.id = o.department_id
       JOIN onboarding_templates t ON t.id = o.template_id
       WHERE ($1::uuid IS NULL OR o.department_id = $1)
         AND ($2::text IS NULL OR o.status = $2)
       ORDER BY o.created_at DESC`,
      [filters.departmentId ?? null, filters.status ?? null],
    );
    return rows;
  }

  /**
   * Step 26: the single-screen "what's stuck" view — one row per
   * required, not-yet-done task that is either explicitly blocked or
   * overdue, on an onboarding that hasn't finished. isOverdueSql
   * (Step 25) now excludes 'locked' tasks, so a phase-2 task sitting
   * behind an unconfirmed checkpoint no longer floods this view with
   * false positives — if an onboarding is stuck because the checkpoint
   * itself hasn't been confirmed, THAT task is what shows up here
   * (is_checkpoint = true on the row makes it obvious at a glance which
   * kind of "stuck" it is), not every locked task behind it.
   *
   * onboarding_status is included so HR can immediately see whether a
   * stuck onboarding is still pre-checkpoint or already active but
   * lagging — the two call for different follow-up.
   */
  async listStuckTasks() {
    const { rows } = await this.db.query(
      `SELECT
         o.id AS onboarding_id,
         o.status AS onboarding_status,
         u.full_name AS employee_name,
         d.name AS department_name,
         ot.id AS task_id,
         ot.title AS task_title,
         ot.is_checkpoint,
         ot.due_date,
         ot.status AS task_status,
         ot.blocked_reason,
         (ot.status = 'blocked') AS is_blocked,
         ${isOverdueSql('ot.')} AS is_overdue
       FROM onboarding_tasks ot
       JOIN onboardings o ON o.id = ot.onboarding_id
       JOIN users u ON u.id = o.user_id
       JOIN departments d ON d.id = o.department_id
       WHERE o.status NOT IN ('completed', 'cancelled')
         AND ot.is_required = true
         AND ot.status NOT IN ('completed', 'cancelled')
         AND (ot.status = 'blocked' OR ${isOverdueSql('ot.')})
       ORDER BY ot.due_date`,
    );
    return rows;
  }

  /**
   * Step 21: Employee dashboard — the caller's own onboarding, bucketed
   * into today/upcoming/overdue, plus progress computed live from
   * required tasks only (never a stored/editable field — same rule as
   * everywhere else in this codebase).
   *
   * 'locked' tasks are excluded from all three time buckets: their
   * due_date was computed from start_date + offset regardless of when
   * the checkpoint actually completes, so a locked phase-2 task can
   * easily show a due_date in the past through no fault of the
   * employee's — surfacing that as "overdue" would be actively
   * misleading. They still count toward the progress denominator,
   * since progress means "of everything in my plan," not "of
   * everything I can currently act on."
   */
  async getMyDashboard(actor: AuthenticatedUser) {
    const onboarding = await this.findByUserId(actor.id);
    if (!onboarding) {
      throw new NotFoundException('No onboarding found for this account');
    }

    const { rows: bucketedTasks } = await this.db.query<{
      id: string;
      title: string;
      description: string | null;
      owner_role: string;
      due_date: Date;
      priority: string;
      is_required: boolean;
      completion_mode: string;
      is_checkpoint: boolean;
      status: string;
      blocked_reason: string | null;
      bucket: 'overdue' | 'today' | 'upcoming';
      is_overdue: boolean;
    }>(
      `SELECT
         id, title, description, owner_role, due_date, priority, is_required,
         completion_mode, is_checkpoint, status, blocked_reason,
         CASE
           WHEN due_date < CURRENT_DATE THEN 'overdue'
           WHEN due_date = CURRENT_DATE THEN 'today'
           ELSE 'upcoming'
         END AS bucket,
         ${isOverdueSql()} AS is_overdue
       FROM onboarding_tasks
       WHERE onboarding_id = $1
         AND status NOT IN ('locked', 'completed', 'cancelled')
       ORDER BY due_date`,
      [onboarding.id],
    );

    const { rows: progressRows } = await this.db.query<{
      required_total: string;
      required_completed: string;
    }>(
      `SELECT
         COUNT(*) FILTER (WHERE is_required) AS required_total,
         COUNT(*) FILTER (WHERE is_required AND status = 'completed') AS required_completed
       FROM onboarding_tasks
       WHERE onboarding_id = $1`,
      [onboarding.id],
    );
    const requiredTotal = Number(progressRows[0].required_total);
    const requiredCompleted = Number(progressRows[0].required_completed);

    return {
      onboarding,
      today: bucketedTasks.filter((t) => t.bucket === 'today'),
      upcoming: bucketedTasks.filter((t) => t.bucket === 'upcoming'),
      overdue: bucketedTasks.filter((t) => t.bucket === 'overdue'),
      progress: {
        requiredTotal,
        requiredCompleted,
        percent:
          requiredTotal === 0 ? 0 : Math.round((requiredCompleted / requiredTotal) * 100),
      },
    };
  }

  /** Used by ClaimedAccountGuard (KnowledgeModule) to check the caller's
   *  own checkpoint status and department — never a client-supplied
   *  value. Returns null for accounts with no onboarding at all
   *  (task_owner/superadmin_hr), which callers should treat as
   *  ineligible for anything onboarding-status-gated. */
  async findByUserId(userId: string): Promise<OnboardingRow | null> {
    const { rows } = await this.db.query<OnboardingRow>(
      `SELECT * FROM onboardings WHERE user_id = $1`,
      [userId],
    );
    return rows[0] ?? null;
  }

  private async toOnboardingWithTasks(queryable: Queryable, onboardingId: string) {
    const { rows: onboardingRows } = await queryable.query<OnboardingRow>(
      `SELECT * FROM onboardings WHERE id = $1`,
      [onboardingId],
    );
    const onboarding = onboardingRows[0];

    const { rows: taskRows } = await queryable.query(
      `SELECT * FROM onboarding_tasks WHERE onboarding_id = $1 ORDER BY due_date, created_at`,
      [onboardingId],
    );

    return { ...onboarding, tasks: taskRows };
  }
}
