import { Injectable, NotFoundException } from '@nestjs/common';
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
 * an arbitrary userId, no "admin" variant, no override flag. That's
 * not a runtime check that a future endpoint could forget to call; the
 * method signatures themselves have no shape that would let a caller
 * read or write someone else's notes. Every query is hand-written with
 * `WHERE user_id = $actorId`, matching the same guarantee already
 * documented on the notes table in migrations/0002_core_schema.sql.
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
    const { rows } = await this.db.query<NoteRow>(
      `SELECT * FROM notes WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL`,
      [noteId, actorId],
    );
    const note = rows[0];
    // Same 404 whether the note doesn't exist or belongs to someone
    // else — never confirm another user's note exists, not even via a
    // distinct 403.
    if (!note) {
      throw new NotFoundException('Note not found');
    }
    return note;
  }

  async updateNote(actorId: string, noteId: string, dto: UpdateNoteDto): Promise<NoteRow> {
    const { rows } = await this.db.query<NoteRow>(
      `UPDATE notes SET content = $3
       WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL
       RETURNING *`,
      [noteId, actorId, dto.content],
    );
    const note = rows[0];
    if (!note) {
      throw new NotFoundException('Note not found');
    }
    return note;
  }

  async deleteNote(actorId: string, noteId: string): Promise<void> {
    const { rowCount } = await this.db.query(
      `UPDATE notes SET deleted_at = now()
       WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL`,
      [noteId, actorId],
    );
    if (!rowCount) {
      throw new NotFoundException('Note not found');
    }
  }
}
