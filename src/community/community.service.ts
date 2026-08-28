import { Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';

export interface CommunityPostRow {
  id: string;
  body: string;
  created_at: Date;
  // Both null unless the viewer IS the author — see the CASE
  // expressions in every query below. Not filtered out after the
  // fact: the real value never leaves the database for anyone else.
  author_id: string | null;
  author_name: string | null;
  is_mine: boolean;
  upvotes: number;
  downvotes: number;
  score: number;
  comment_count: number;
  my_vote: number | null;
}

export interface CommunityCommentRow {
  id: string;
  post_id: string;
  body: string;
  created_at: Date;
  author_id: string | null;
  author_name: string | null;
  is_mine: boolean;
}

/**
 * Step 29: author_id is stored (comments/posts both have it, both are
 * NOT NULL, both moderation-traceable per Step 30's future soft-delete)
 * but never returned in an API response to anyone except the author
 * themselves. This is enforced in the SELECT itself — every query
 * below projects `CASE WHEN <table>.author_id = $viewerId THEN
 * <table>.author_id ELSE NULL END`, not a real value that gets redacted
 * in application code afterward. There's no code path here that could
 * accidentally leak it by forgetting a redaction step, because there
 * is no redaction step — the value the database sends over the wire
 * already is or isn't there.
 *
 * Vote counts (upvotes/downvotes/score) and comment_count are computed
 * live via COUNT/SUM against community_votes/community_comments, never
 * stored columns — same rule as onboarding progress.
 *
 * Deliberately NOT wired into ActivityLogService: logging author_id
 * against a post/comment/vote would let SuperAdmin/HR deanonymize
 * authorship via the audit trail, which defeats the entire point of
 * hiding it in the API. Community content gets no activity log entries
 * at all.
 */
@Injectable()
export class CommunityService {
  constructor(private readonly db: DatabaseService) {}

  async createPost(actorId: string, body: string): Promise<CommunityPostRow> {
    const { rows } = await this.db.query<{ id: string }>(
      `INSERT INTO community_posts (author_id, body) VALUES ($1, $2) RETURNING id`,
      [actorId, body],
    );
    return this.getPostOrThrow(rows[0].id, actorId);
  }

  async listPosts(viewerId: string): Promise<CommunityPostRow[]> {
    const { rows } = await this.db.query<CommunityPostRow>(
      `SELECT
         cp.id, cp.body, cp.created_at,
         CASE WHEN cp.author_id = $1 THEN cp.author_id ELSE NULL END AS author_id,
         CASE WHEN cp.author_id = $1 THEN u.full_name ELSE NULL END AS author_name,
         (cp.author_id = $1) AS is_mine,
         COUNT(*) FILTER (WHERE cv.value = 1)::int AS upvotes,
         COUNT(*) FILTER (WHERE cv.value = -1)::int AS downvotes,
         COALESCE(SUM(cv.value), 0)::int AS score,
         (SELECT COUNT(*) FROM community_comments cc
            WHERE cc.post_id = cp.id AND cc.deleted_at IS NULL)::int AS comment_count,
         MAX(CASE WHEN cv.user_id = $1 THEN cv.value END) AS my_vote
       FROM community_posts cp
       JOIN users u ON u.id = cp.author_id
       LEFT JOIN community_votes cv ON cv.post_id = cp.id
       WHERE cp.deleted_at IS NULL
       GROUP BY cp.id, cp.body, cp.created_at, cp.author_id, u.full_name
       ORDER BY cp.created_at DESC`,
      [viewerId],
    );
    return rows;
  }

  async getPostWithComments(postId: string, viewerId: string) {
    const post = await this.getPostOrThrow(postId, viewerId);

    const { rows: comments } = await this.db.query<CommunityCommentRow>(
      `SELECT
         cc.id, cc.post_id, cc.body, cc.created_at,
         CASE WHEN cc.author_id = $2 THEN cc.author_id ELSE NULL END AS author_id,
         CASE WHEN cc.author_id = $2 THEN u.full_name ELSE NULL END AS author_name,
         (cc.author_id = $2) AS is_mine
       FROM community_comments cc
       JOIN users u ON u.id = cc.author_id
       WHERE cc.post_id = $1 AND cc.deleted_at IS NULL
       ORDER BY cc.created_at ASC`,
      [postId, viewerId],
    );

    return { ...post, comments };
  }

  async addComment(postId: string, actorId: string, body: string): Promise<CommunityCommentRow> {
    await this.assertPostExists(postId);

    const { rows } = await this.db.query<{ id: string }>(
      `INSERT INTO community_comments (post_id, author_id, body) VALUES ($1, $2, $3) RETURNING id`,
      [postId, actorId, body],
    );

    // Always the commenter viewing their own just-created comment —
    // is_mine is unconditionally true here, no anonymity concern.
    const { rows: commentRows } = await this.db.query<CommunityCommentRow>(
      `SELECT cc.id, cc.post_id, cc.body, cc.created_at,
              cc.author_id, u.full_name AS author_name, true AS is_mine
       FROM community_comments cc
       JOIN users u ON u.id = cc.author_id
       WHERE cc.id = $1`,
      [rows[0].id],
    );
    return commentRows[0];
  }

  /** One vote per user per post, enforced by the UNIQUE(post_id,
   *  user_id) constraint at the DB level — a repeat vote from the same
   *  user is an UPDATE via ON CONFLICT, exactly as the schema comment
   *  on community_votes says, not a second row. */
  async castVote(postId: string, actorId: string, value: 1 | -1): Promise<CommunityPostRow> {
    await this.assertPostExists(postId);

    await this.db.query(
      `INSERT INTO community_votes (post_id, user_id, value)
       VALUES ($1, $2, $3)
       ON CONFLICT (post_id, user_id) DO UPDATE SET value = EXCLUDED.value`,
      [postId, actorId, value],
    );

    return this.getPostOrThrow(postId, actorId);
  }

  private async assertPostExists(postId: string): Promise<void> {
    const { rows } = await this.db.query(
      `SELECT id FROM community_posts WHERE id = $1 AND deleted_at IS NULL`,
      [postId],
    );
    if (!rows[0]) {
      throw new NotFoundException('Post not found');
    }
  }

  private async getPostOrThrow(postId: string, viewerId: string): Promise<CommunityPostRow> {
    const { rows } = await this.db.query<CommunityPostRow>(
      `SELECT
         cp.id, cp.body, cp.created_at,
         CASE WHEN cp.author_id = $2 THEN cp.author_id ELSE NULL END AS author_id,
         CASE WHEN cp.author_id = $2 THEN u.full_name ELSE NULL END AS author_name,
         (cp.author_id = $2) AS is_mine,
         COUNT(*) FILTER (WHERE cv.value = 1)::int AS upvotes,
         COUNT(*) FILTER (WHERE cv.value = -1)::int AS downvotes,
         COALESCE(SUM(cv.value), 0)::int AS score,
         (SELECT COUNT(*) FROM community_comments cc
            WHERE cc.post_id = cp.id AND cc.deleted_at IS NULL)::int AS comment_count,
         MAX(CASE WHEN cv.user_id = $2 THEN cv.value END) AS my_vote
       FROM community_posts cp
       JOIN users u ON u.id = cp.author_id
       LEFT JOIN community_votes cv ON cv.post_id = cp.id
       WHERE cp.id = $1 AND cp.deleted_at IS NULL
       GROUP BY cp.id, cp.body, cp.created_at, cp.author_id, u.full_name`,
      [postId, viewerId],
    );
    const post = rows[0];
    if (!post) {
      throw new NotFoundException('Post not found');
    }
    return post;
  }
}
