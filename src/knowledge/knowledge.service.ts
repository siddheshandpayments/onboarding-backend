import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';

export interface KnowledgeArticleRow {
  id: string;
  category_id: string;
  title: string;
  content: string;
  department_id: string | null;
  visibility: string;
  created_at: Date;
  updated_at: Date;
}

const PUBLIC_VISIBILITIES = ['public'];
const PRE_CHECKPOINT_VISIBILITIES = ['public', 'pre_email_auth'];

@Injectable()
export class KnowledgeService {
  constructor(private readonly db: DatabaseService) {}

  /** No auth at all — public landing-page content. departmentId here
   *  comes straight from the query string since there's no identity
   *  to derive it from; it's the same content either way, just
   *  narrowed to one department's public articles on request. */
  listPublicArticles(departmentId?: string) {
    return this.queryArticles(PUBLIC_VISIBILITIES, departmentId ?? null);
  }

  /** Called only with a departmentId already resolved from the
   *  caller's own onboarding (see ClaimedAccountGuard) — never a
   *  client-supplied value, so a claimed-but-pre-checkpoint employee
   *  can't request another department's pre_email_auth content. */
  listPreCheckpointArticles(departmentId: string) {
    return this.queryArticles(PRE_CHECKPOINT_VISIBILITIES, departmentId);
  }

  private async queryArticles(visibilities: string[], departmentId: string | null) {
    const { rows } = await this.db.query<KnowledgeArticleRow>(
      `SELECT id, category_id, title, content, department_id, visibility, created_at, updated_at
       FROM knowledge_articles
       WHERE is_published = true
         AND visibility = ANY($1::text[])
         AND (department_id IS NULL OR department_id = $2)
       ORDER BY created_at DESC`,
      [visibilities, departmentId],
    );
    return rows;
  }
}
