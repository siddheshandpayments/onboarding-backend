import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { UpsertDiaryEntryDto } from './dto/upsert-diary-entry.dto';

export interface DiaryEntryRow {
  id: string;
  user_id: string;
  entry_date: string;
  content: string;
  created_at: Date;
  updated_at: Date;
}

/**
 * An employee's private daily diary — what they got done today, one
 * entry per calendar day. Same absolute-privacy shape as NotesService:
 * every query here is hand-scoped to `WHERE user_id = $actorId`, there
 * is no admin/report/override variant, and this table is never joined
 * into any other query in the codebase. Unlike notes (many per day,
 * append-only), a diary entry is upserted — writing again on the same
 * day edits that day's entry rather than piling up duplicates.
 */
@Injectable()
export class DiaryService {
  constructor(private readonly db: DatabaseService) {}

  /** Newest day first — today's entry (if any) at the top, working
   *  backward through the employee's onboarding. entry_date is cast to
   *  text so the client gets a plain 'YYYY-MM-DD' string, not whatever
   *  shape node-postgres/JSON would otherwise give a DATE column. */
  async listMine(actorId: string): Promise<DiaryEntryRow[]> {
    const { rows } = await this.db.query<DiaryEntryRow>(
      `SELECT id, user_id, entry_date::text AS entry_date, content, created_at, updated_at
       FROM diary_entries WHERE user_id = $1 ORDER BY entry_date DESC`,
      [actorId],
    );
    return rows;
  }

  async upsertToday(actorId: string, dto: UpsertDiaryEntryDto): Promise<DiaryEntryRow> {
    const { rows } = await this.db.query<DiaryEntryRow>(
      `INSERT INTO diary_entries (user_id, entry_date, content)
       VALUES ($1, CURRENT_DATE, $2)
       ON CONFLICT (user_id, entry_date) DO UPDATE SET content = $2
       RETURNING id, user_id, entry_date::text AS entry_date, content, created_at, updated_at`,
      [actorId, dto.content],
    );
    return rows[0];
  }
}
