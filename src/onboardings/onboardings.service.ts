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
import { CreateOnboardingDto } from './dto/create-onboarding.dto';
import { computeDueDate } from './utils/due-date.util';

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
  ) {}

  /**
   * Create-joiner: snapshots the employee's department's active
   * template into a fresh, dated checklist. Every field copied onto
   * onboarding_tasks below is frozen at this moment — Step 10's
   * template versioning is what makes that safe; a later template
   * edit publishes a new version and never touches these rows.
   */
  async createOnboarding(dto: CreateOnboardingDto) {
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
