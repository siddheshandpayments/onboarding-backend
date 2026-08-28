import { Injectable } from '@nestjs/common';
import { QueryResult, QueryResultRow } from 'pg';
import { DatabaseService } from '../database/database.service';

/** Same structural-typing trick as every other *Service in this
 *  codebase — lets log() run inside a caller's own transaction (so the
 *  log entry commits or rolls back atomically with the change it
 *  describes) or standalone. */
interface Queryable {
  query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    params?: unknown[],
  ): Promise<QueryResult<T>>;
}

export interface ActivityLogRow {
  id: string;
  actor_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  metadata: Record<string, unknown>;
  created_at: Date;
}

export interface LogEntry {
  actorId: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  metadata?: Record<string, unknown>;
}

/**
 * This service's log() method is the only place in the codebase that
 * ever writes to activity_logs, and it only ever INSERTs — there is no
 * update()/delete() here, on purpose. That's discipline, not
 * enforcement; the real enforcement is migrations/0007's app_runtime
 * DB role, which has no UPDATE/DELETE grant on this table at the
 * database level, so even a bug or a compromised app process couldn't
 * violate append-only.
 *
 * Never pass note content, password hashes, or TOTP secrets in
 * metadata. In practice this is easy to keep true: NotesService never
 * calls this at all (notes must never appear in any admin-facing
 * query, logs included), and nothing in AuthService/UsersService ever
 * holds a plaintext password or TOTP secret in scope at the same time
 * as a log call — hashes and secrets live only in the users table.
 */
@Injectable()
export class ActivityLogService {
  constructor(private readonly db: DatabaseService) {}

  async log(entry: LogEntry, queryable: Queryable = this.db): Promise<void> {
    await queryable.query(
      `INSERT INTO activity_logs (actor_id, action, entity_type, entity_id, metadata)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        entry.actorId,
        entry.action,
        entry.entityType,
        entry.entityId ?? null,
        JSON.stringify(entry.metadata ?? {}),
      ],
    );
  }

  /** HR/SuperAdmin audit trail read. Optional equality filters only —
   *  Step 32 generalizes allow-listed filtering/pagination across list
   *  endpoints; this doesn't try to anticipate that, and caps at 200
   *  rows in the meantime rather than returning an unbounded log. */
  async listLogs(filters: { entityType?: string; entityId?: string }): Promise<ActivityLogRow[]> {
    const { rows } = await this.db.query<ActivityLogRow>(
      `SELECT * FROM activity_logs
       WHERE ($1::text IS NULL OR entity_type = $1)
         AND ($2::uuid IS NULL OR entity_id = $2)
       ORDER BY created_at DESC
       LIMIT 200`,
      [filters.entityType ?? null, filters.entityId ?? null],
    );
    return rows;
  }
}
