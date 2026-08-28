import { Injectable, NotFoundException } from '@nestjs/common';
import { PoolClient, QueryResult, QueryResultRow } from 'pg';
import { DatabaseService } from '../database/database.service';
import { ActivityLogService } from '../activity-log/activity-log.service';
import { CreateTemplateDto } from './dto/create-template.dto';
import { NewTemplateVersionDto } from './dto/new-template-version.dto';
import { TemplateTaskInputDto } from './dto/template-task-input.dto';

/** Structural type both DatabaseService and pg's PoolClient satisfy.
 *  Typing against `DatabaseService | PoolClient` directly doesn't work —
 *  PoolClient.query is overloaded several different ways and TS can't
 *  safely call through the merged union of two different overload
 *  sets. A single-signature interface sidesteps that: TS just checks
 *  each concrete type is structurally assignable to it, which both are. */
interface Queryable {
  query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    params?: unknown[],
  ): Promise<QueryResult<T>>;
}

export interface TemplateRow {
  id: string;
  department_id: string;
  name: string;
  version: number;
  is_active: boolean;
  created_at: Date;
}

export interface TemplateTaskRow {
  id: string;
  template_id: string;
  title: string;
  description: string | null;
  owner_role: string;
  due_offset_days: number;
  priority: string;
  is_required: boolean;
  completion_mode: string;
  is_checkpoint: boolean;
  milestone: string | null;
  created_at: Date;
}

@Injectable()
export class TemplatesService {
  constructor(
    private readonly db: DatabaseService,
    private readonly activityLog: ActivityLogService,
  ) {}

  /** Inserts the template_tasks rows for a given template id. Shared by
   *  both "create brand new template" and "publish new version", since
   *  both are really the same operation: a template id + a task list. */
  private async insertTasks(
    client: PoolClient,
    templateId: string,
    tasks: TemplateTaskInputDto[],
  ) {
    for (const task of tasks) {
      await client.query(
        `INSERT INTO template_tasks
           (template_id, title, description, owner_role, due_offset_days,
            priority, is_required, completion_mode, is_checkpoint, milestone)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          templateId,
          task.title,
          task.description ?? null,
          task.ownerRole,
          task.dueOffsetDays,
          task.priority ?? 'normal',
          task.isRequired ?? true,
          task.completionMode,
          task.isCheckpoint ?? false,
          task.milestone ?? null,
        ],
      );
    }
  }

  async createTemplate(dto: CreateTemplateDto, actorId: string) {
    return this.db.transaction(async (client) => {
      const { rows } = await client.query<TemplateRow>(
        `INSERT INTO onboarding_templates (department_id, name, version, is_active)
         VALUES ($1, $2, 1, true)
         RETURNING *`,
        [dto.departmentId, dto.name],
      );
      const template = rows[0];
      await this.insertTasks(client, template.id, dto.tasks);
      await this.activityLog.log(
        {
          actorId,
          action: 'template.created',
          entityType: 'onboarding_template',
          entityId: template.id,
          metadata: { name: dto.name, departmentId: dto.departmentId, version: 1 },
        },
        client,
      );
      return this.toTemplateWithTasks(client, template.id);
    });
  }

  /** Publishes a new version: deactivates the current active version for
   *  this department+name, inserts a fresh template row + fresh tasks.
   *  The old version's rows are never touched — this is what makes an
   *  in-flight onboarding immune to the edit (it snapshot from the old
   *  version's rows and never looks at them again anyway). */
  async createNewVersion(templateId: string, dto: NewTemplateVersionDto, actorId: string) {
    return this.db.transaction(async (client) => {
      const { rows: currentRows } = await client.query<TemplateRow>(
        `SELECT * FROM onboarding_templates WHERE id = $1`,
        [templateId],
      );
      const current = currentRows[0];
      if (!current) {
        throw new NotFoundException('Template not found');
      }

      await client.query(
        `UPDATE onboarding_templates SET is_active = false WHERE id = $1`,
        [current.id],
      );

      const { rows: newRows } = await client.query<TemplateRow>(
        `INSERT INTO onboarding_templates (department_id, name, version, is_active)
         VALUES ($1, $2, $3, true)
         RETURNING *`,
        [current.department_id, current.name, current.version + 1],
      );
      const newTemplate = newRows[0];
      await this.insertTasks(client, newTemplate.id, dto.tasks);
      await this.activityLog.log(
        {
          actorId,
          action: 'template.version_created',
          entityType: 'onboarding_template',
          entityId: newTemplate.id,
          metadata: {
            name: current.name,
            departmentId: current.department_id,
            version: newTemplate.version,
            previousTemplateId: current.id,
          },
        },
        client,
      );
      return this.toTemplateWithTasks(client, newTemplate.id);
    });
  }

  /** The version new joiners get instantiated from — always the
   *  currently-active one for a department. (Step 12 will call this.) */
  async getActiveTemplateForDepartment(departmentId: string) {
    const { rows } = await this.db.query<TemplateRow>(
      `SELECT * FROM onboarding_templates
       WHERE department_id = $1 AND is_active = true
       ORDER BY version DESC
       LIMIT 1`,
      [departmentId],
    );
    const template = rows[0];
    if (!template) {
      throw new NotFoundException('No active template for this department');
    }
    return this.toTemplateWithTasks(this.db, template.id);
  }

  async getTemplateById(id: string) {
    const template = await this.toTemplateWithTasks(this.db, id);
    if (!template) {
      throw new NotFoundException('Template not found');
    }
    return template;
  }

  async listTemplates(departmentId?: string) {
    const { rows } = await this.db.query<TemplateRow>(
      departmentId
        ? `SELECT * FROM onboarding_templates WHERE department_id = $1 ORDER BY name, version DESC`
        : `SELECT * FROM onboarding_templates ORDER BY name, version DESC`,
      departmentId ? [departmentId] : [],
    );
    return rows;
  }

  /** Accepts either the pooled DatabaseService or a transaction's
   *  PoolClient — both structurally satisfy Queryable, so the same read
   *  logic works whether called mid-transaction or standalone. */
  private async toTemplateWithTasks(
    queryable: Queryable,
    templateId: string,
  ) {
    const { rows: templateRows } = await queryable.query<TemplateRow>(
      `SELECT * FROM onboarding_templates WHERE id = $1`,
      [templateId],
    );
    const template = templateRows[0];
    if (!template) return null;

    const { rows: taskRows } = await queryable.query<TemplateTaskRow>(
      `SELECT * FROM template_tasks WHERE template_id = $1 ORDER BY created_at`,
      [templateId],
    );

    return { ...template, tasks: taskRows };
  }
}
