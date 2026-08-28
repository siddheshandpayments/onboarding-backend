import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { CreateNoteDto } from './dto/create-note.dto';
import { UpdateNoteDto } from './dto/update-note.dto';

export interface NoteRow {
  id: string;
  user_id: string;
  content: string;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
}

/**
 * Every method here takes the actor's own id and nothing else to
 * identify whose notes it's touching — there is no method that accepts
 * an arbitrary userId, no "admin" variant, no override flag. Writes
 * (create/update/delete) and the list are hard-scoped by
 * `WHERE user_id = $actorId` in SQL, exactly as documented on the
 * notes table in migrations/0002_core_schema.sql.
 *
 * Single-note lookups (get/update/delete) are the one deliberate
 * exception to "always scope the SELECT by user_id": the BRD's own
 * acceptance test requires a SuperAdmin reading another user's note to
 * get 403, not 404 — the two need to be distinguishable, which means
 * looking up the note by id alone and checking ownership in code (see
 * assertOwnedOrThrow). This never returns another user's note CONTENT
 * — it only ever confirms an id refers to a note that exists and
 * belongs to someone else, which is a narrower disclosure than an
 * override path, not an instance of one.
 */
@Injectable()
export class NotesService {
  constructor(private readonly db: DatabaseService) {}

  async createNote(actorId: string, dto: CreateNoteDto): Promise<NoteRow> {
    const { rows } = await this.db.query<NoteRow>(
      `INSERT INTO notes (user_id, content) VALUES ($1, $2) RETURNING *`,
      [actorId, dto.content],
    );
    return rows[0];
  }

  async listNotes(actorId: string): Promise<NoteRow[]> {
    const { rows } = await this.db.query<NoteRow>(
      `SELECT * FROM notes WHERE user_id = $1 AND deleted_at IS NULL ORDER BY created_at DESC`,
      [actorId],
    );
    return rows;
  }

  async getNote(actorId: string, noteId: string): Promise<NoteRow> {
    return this.assertOwnedOrThrow(actorId, noteId);
  }

  async updateNote(actorId: string, noteId: string, dto: UpdateNoteDto): Promise<NoteRow> {
    await this.assertOwnedOrThrow(actorId, noteId);
    const { rows } = await this.db.query<NoteRow>(
      `UPDATE notes SET content = $3 WHERE id = $1 AND user_id = $2 RETURNING *`,
      [noteId, actorId, dto.content],
    );
    const note = rows[0];
    if (!note) {
      throw new NotFoundException('Note not found');
    }
    return note;
  }

  async deleteNote(actorId: string, noteId: string): Promise<void> {
    await this.assertOwnedOrThrow(actorId, noteId);
    const { rowCount } = await this.db.query(
      `UPDATE notes SET deleted_at = now() WHERE id = $1 AND user_id = $2`,
      [noteId, actorId],
    );
    if (!rowCount) {
      throw new NotFoundException('Note not found');
    }
  }

  /** 404 if the id doesn't refer to any (non-deleted) note at all;
   *  403 if it does, but not to one owned by actorId. Never returns a
   *  note that isn't the actor's own. */
  private async assertOwnedOrThrow(actorId: string, noteId: string): Promise<NoteRow> {
    const { rows } = await this.db.query<NoteRow>(
      `SELECT * FROM notes WHERE id = $1 AND deleted_at IS NULL`,
      [noteId],
    );
    const note = rows[0];
    if (!note) {
      throw new NotFoundException('Note not found');
    }
    if (note.user_id !== actorId) {
      throw new ForbiddenException("You cannot access another user's notes");
    }
    return note;
  }
}
