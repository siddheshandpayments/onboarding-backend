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
import { toCsv } from './utils/csv.util';
import { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import {
  assertDateIfPresent,
  assertOneOfIfPresent,
  assertOnlyAllowedKeys,
  assertUuidIfPresent,
  parseSort,
} from '../common/list-query.util';

const ONBOARDING_STATUS_VALUES = [
  'pre_onboarding',
  'email_provisioned',
  'checkpoint_pending',
  'active',
  'completed',
  'cancelled',
] as const;
const HEALTH_VALUES = ['stuck', 'on_track'] as const;
const PRIORITY_VALUES = ['low', 'normal', 'high'] as const;

/** Column names as they appear in listAllOnboardings' OUTER query (the
 *  wrapping SELECT * FROM (...) — bare column/alias names, not
 *  table-prefixed), so ORDER BY can reference them directly. Built
 *  from a fixed dictionary keyed by the already-allow-listed sort
 *  field name — never the client's raw sort string. */
const ONBOARDING_SORT_EXPRESSIONS: Record<string, string> = {
  name: 'employee_name',
  startDate: 'start_date',
  progress: `CASE WHEN required_task_count = 0 THEN 0
               ELSE ROUND(100.0 * required_task_completed_count / required_task_count) END`,
};

const STUCK_SORT_EXPRESSIONS: Record<string, string> = {
  dueDate: 'ot.due_date',
  priority: `CASE ot.priority WHEN 'high' THEN 3 WHEN 'normal' THEN 2 WHEN 'low' THEN 1 ELSE 0 END`,
};

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
   * Step 32: SuperAdmin/HR dashboard, now with an allow-listed filter
   * and sort surface instead of the two ad-hoc equality params this
   * had through Step 28. `query` is the FULL, raw query object —
   * assertOnlyAllowedKeys rejects (400) any key outside
   * ['department','status','health','dateFrom','dateTo','sort']
   * rather than silently ignoring a typo'd or probing one.
   *
   * `health` is derived, not stored: 'stuck' means at least one
   * required task on the onboarding is blocked or overdue (the exact
   * Step 25/26 definition, via EXISTS/isOverdueSql), 'on_track' means
   * none are. Progress is still two plain COUNT subqueries, never a
   * stored column — same rule as everywhere else — and 'progress' as a
   * sort field is computed from those same two counts via a fixed
   * (never client-supplied) SQL expression, applied only after the
   * allow-list check has already validated the requested sort field.
   */
  async listAllOnboardings(query: Record<string, string | undefined>) {
    assertOnlyAllowedKeys(query, ['department', 'status', 'health', 'dateFrom', 'dateTo', 'sort']);
    assertUuidIfPresent(query.department, 'department');
    assertOneOfIfPresent(query.status, 'status', ONBOARDING_STATUS_VALUES);
    assertOneOfIfPresent(query.health, 'health', HEALTH_VALUES);
    assertDateIfPresent(query.dateFrom, 'dateFrom');
    assertDateIfPresent(query.dateTo, 'dateTo');
    const { field, direction } = parseSort(
      query.sort,
      Object.keys(ONBOARDING_SORT_EXPRESSIONS),
      'startDate',
    );

    const stuckExists = `EXISTS (
      SELECT 1 FROM onboarding_tasks ot2
      WHERE ot2.onboarding_id = o.id AND ot2.is_required = true
        AND (ot2.status = 'blocked' OR ${isOverdueSql('ot2.')})
    )`;
    // Resolved from the already-validated `health` value above, one of
    // exactly three fixed literal strings — never client-interpolated.
    const healthCondition =
      query.health === 'stuck' ? stuckExists : query.health === 'on_track' ? `NOT ${stuckExists}` : 'true';

    const { rows } = await this.db.query(
      `SELECT * FROM (
         SELECT
           o.id, o.user_id, o.department_id, o.template_id, o.template_version,
           o.start_date, o.status, o.created_at, o.updated_at,
           u.full_name AS employee_name,
           d.name AS department_name,
           t.name AS template_name,
           (SELECT COUNT(*) FROM onboarding_tasks ot
              WHERE ot.onboarding_id = o.id AND ot.is_required = true)::int AS required_task_count,
           (SELECT COUNT(*) FROM onboarding_tasks ot
              WHERE ot.onboarding_id = o.id AND ot.is_required = true
                AND ot.status = 'completed')::int AS required_task_completed_count
         FROM onboardings o
         JOIN users u ON u.id = o.user_id
         JOIN departments d ON d.id = o.department_id
         JOIN onboarding_templates t ON t.id = o.template_id
         WHERE ($1::uuid IS NULL OR o.department_id = $1)
           AND ($2::text IS NULL OR o.status = $2)
           AND ($3::date IS NULL OR o.start_date >= $3)
           AND ($4::date IS NULL OR o.start_date <= $4)
           AND ${healthCondition}
       ) AS onboarding_rows
       ORDER BY ${ONBOARDING_SORT_EXPRESSIONS[field]} ${direction}`,
      [query.department ?? null, query.status ?? null, query.dateFrom ?? null, query.dateTo ?? null],
    );
    return rows;
  }

  /**
   * Step 28's CSV export, now sharing Step 32's same allow-listed
   * filters as listAllOnboardings (department/status/dateFrom/dateTo —
   * no health/sort here, an export doesn't need ordering the way a UI
   * list does). This query never joins or selects from the notes
   * table, anywhere — not filtered out, structurally absent. "Notes
   * never appear in export, log, search, or any admin-facing query" is
   * a non-negotiable precisely because a filter is something a future
   * edit could accidentally loosen; a table that was never joined in
   * the first place can't leak through one.
   */
  async exportOnboardingsCsv(query: Record<string, string | undefined>): Promise<string> {
    assertOnlyAllowedKeys(query, ['department', 'status', 'dateFrom', 'dateTo']);
    assertUuidIfPresent(query.department, 'department');
    assertOneOfIfPresent(query.status, 'status', ONBOARDING_STATUS_VALUES);
    assertDateIfPresent(query.dateFrom, 'dateFrom');
    assertDateIfPresent(query.dateTo, 'dateTo');

    const { rows } = await this.db.query(
      `SELECT
         u.full_name AS employee_name,
         d.name AS department_name,
         t.name AS template_name,
         o.status AS onboarding_status,
         o.start_date,
         ot.title AS task_title,
         ot.status AS task_status,
         ot.priority,
         ot.completion_mode,
         ot.is_checkpoint,
         ot.is_required,
         ot.due_date,
         ot.completed_at
       FROM onboarding_tasks ot
       JOIN onboardings o ON o.id = ot.onboarding_id
       JOIN users u ON u.id = o.user_id
       JOIN departments d ON d.id = o.department_id
       JOIN onboarding_templates t ON t.id = o.template_id
       WHERE ($1::uuid IS NULL OR o.department_id = $1)
         AND ($2::text IS NULL OR o.status = $2)
         AND ($3::date IS NULL OR o.start_date >= $3)
         AND ($4::date IS NULL OR o.start_date <= $4)
       ORDER BY d.name, u.full_name, ot.due_date`,
      [query.department ?? null, query.status ?? null, query.dateFrom ?? null, query.dateTo ?? null],
    );

    const columns = [
      'employee_name',
      'department_name',
      'template_name',
      'onboarding_status',
      'start_date',
      'task_title',
      'task_status',
      'priority',
      'completion_mode',
      'is_checkpoint',
      'is_required',
      'due_date',
      'completed_at',
    ];
    return toCsv(rows, columns);
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
   *
   * Step 32 adds an allow-listed filter/sort surface: `department`,
   * `owner` (the claimed task_owner's user id, Step 20), and `priority`
   * as filters; `dueDate`/`priority` as sort fields. `owner` belongs
   * here rather than on listAllOnboardings — there's no single "owner"
   * of an onboarding, but every stuck row IS one specific task, which
   * does have one.
   */
  async listStuckTasks(query: Record<string, string | undefined>) {
    assertOnlyAllowedKeys(query, ['department', 'owner', 'priority', 'sort']);
    assertUuidIfPresent(query.department, 'department');
    assertUuidIfPresent(query.owner, 'owner');
    assertOneOfIfPresent(query.priority, 'priority', PRIORITY_VALUES);
    const { field, direction } = parseSort(query.sort, Object.keys(STUCK_SORT_EXPRESSIONS), 'dueDate');

    const { rows } = await this.db.query(
      `SELECT
         o.id AS onboarding_id,
         o.status AS onboarding_status,
         u.full_name AS employee_name,
         d.name AS department_name,
         ot.id AS task_id,
         ot.title AS task_title,
         ot.is_checkpoint,
         ot.priority,
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
         AND ($1::uuid IS NULL OR o.department_id = $1)
         AND ($2::uuid IS NULL OR ot.owner_user_id = $2)
         AND ($3::text IS NULL OR ot.priority = $3)
       ORDER BY ${STUCK_SORT_EXPRESSIONS[field]} ${direction}`,
      [query.department ?? null, query.owner ?? null, query.priority ?? null],
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
