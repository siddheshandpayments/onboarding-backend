import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DatabaseService } from '../database/database.service';
import { UsersService } from '../users/users.service';

export interface DocumentRow {
  id: string;
  title: string;
  file_url: string;
  department_id: string | null;
  uploaded_by: string;
  created_at: Date;
}

/**
 * file_url stores the server-generated on-disk filename (a random
 * UUID + original extension, assigned by multer in DocumentsModule's
 * storage config) — never the client-supplied original filename, which
 * would otherwise be a path-traversal / collision risk if used as-is.
 * The human-readable name lives in `title` instead, which is exactly
 * what documents.title is already for.
 *
 * Visibility (list and download both) is company-wide (department_id
 * IS NULL) or the caller's own department — derived from their own
 * user row, never a client-supplied department, same pattern as
 * KnowledgeModule/EntitlementsModule.
 */
@Injectable()
export class DocumentsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly usersService: UsersService,
    private readonly config: ConfigService,
  ) {}

  async createDocument(
    actorId: string,
    title: string,
    departmentId: string | null,
    storedFilename: string,
  ): Promise<DocumentRow> {
    const { rows } = await this.db.query<DocumentRow>(
      `INSERT INTO documents (title, file_url, department_id, uploaded_by)
       VALUES ($1, $2, $3, $4)
       RETURNING id, title, file_url, department_id, uploaded_by, created_at`,
      [title, storedFilename, departmentId, actorId],
    );
    return rows[0];
  }

  async listVisibleForActor(actorId: string): Promise<DocumentRow[]> {
    const user = await this.usersService.findById(actorId);
    const departmentId = user?.department_id ?? null;

    const { rows } = await this.db.query<DocumentRow>(
      `SELECT id, title, file_url, department_id, uploaded_by, created_at
       FROM documents
       WHERE deleted_at IS NULL
         AND (department_id IS NULL OR department_id = $1)
       ORDER BY created_at DESC`,
      [departmentId],
    );
    return rows;
  }

  /** Same visibility rule as listVisibleForActor, applied to one
   *  document. A document outside the caller's department comes back
   *  as 404, not 403 — its existence isn't confirmed to someone who
   *  isn't allowed to see it, same reasoning as OnboardingsService's
   *  active-template lookup. */
  async getDownloadableOrThrow(
    documentId: string,
    actorId: string,
  ): Promise<{ title: string; storedFilename: string }> {
    const user = await this.usersService.findById(actorId);
    const departmentId = user?.department_id ?? null;

    const { rows } = await this.db.query<DocumentRow>(
      `SELECT title, file_url
       FROM documents
       WHERE id = $1 AND deleted_at IS NULL
         AND (department_id IS NULL OR department_id = $2)`,
      [documentId, departmentId],
    );
    const doc = rows[0];
    if (!doc) {
      throw new NotFoundException('Document not found');
    }
    return { title: doc.title, storedFilename: doc.file_url };
  }

  getUploadsDir(): string {
    return this.config.get<string>('UPLOADS_DIR') ?? './uploads';
  }
}
