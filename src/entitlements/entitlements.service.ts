import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { UsersService } from '../users/users.service';
import { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { ActivityLogService } from '../activity-log/activity-log.service';
import { CreateEntitlementDto } from './dto/create-entitlement.dto';
import { Pagination, paginateRows } from '../common/list-query.util';

export interface EntitlementRow {
  id: string;
  name: string;
  scope: 'company_wide' | 'department';
  department_id: string | null;
  total_quantity: number | null;
  available_quantity: number | null;
  status: 'active' | 'retired';
  created_at: Date;
}

export interface EntitlementAssignmentRow {
  id: string;
  entitlement_id: string;
  user_id: string;
  status: 'claimed' | 'revoked';
  claimed_at: Date;
  revoked_at: Date | null;
  revoke_reason: string | null;
}

const UNIQUE_VIOLATION = '23505';

@Injectable()
export class EntitlementsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly usersService: UsersService,
    private readonly activityLog: ActivityLogService,
  ) {}

  async createEntitlement(dto: CreateEntitlementDto, actorId: string) {
    if (dto.scope === 'department' && !dto.departmentId) {
      throw new BadRequestException(
        'departmentId is required when scope is "department"',
      );
    }
    if (dto.scope === 'company_wide' && dto.departmentId) {
      throw new BadRequestException(
        'departmentId must not be set when scope is "company_wide"',
      );
    }

    // available_quantity starts equal to total_quantity; both NULL
    // means unlimited (e.g. a learning budget nobody needs to ration).
    const { rows } = await this.db.query<EntitlementRow>(
      `INSERT INTO entitlements (name, scope, department_id, total_quantity, available_quantity)
       VALUES ($1, $2, $3, $4, $4)
       RETURNING *`,
      [dto.name, dto.scope, dto.departmentId ?? null, dto.totalQuantity ?? null],
    );
    const entitlement = rows[0];

    await this.activityLog.log({
      actorId,
      action: 'entitlement.created',
      entityType: 'entitlement',
      entityId: entitlement.id,
      metadata: { name: dto.name, scope: dto.scope, totalQuantity: dto.totalQuantity ?? null },
    });

    return entitlement;
  }

  /** What the caller could claim: active entitlements that are either
   *  company-wide or scoped to the caller's own department — derived
   *  from their own user record, never a client-supplied department. */
  /** Step 33: LIMIT/OFFSET pagination via the shared
   *  COUNT(*) OVER()/paginateRows() pattern. */
  async listVisibleForActor(actor: AuthenticatedUser, pagination: Pagination) {
    const user = await this.usersService.findById(actor.id);
    const departmentId = user?.department_id ?? null;

    const { rows } = await this.db.query<EntitlementRow & { total_count: number }>(
      `SELECT *, COUNT(*) OVER()::int AS total_count FROM entitlements
       WHERE status = 'active'
         AND (scope = 'company_wide' OR department_id = $1)
       ORDER BY name
       LIMIT $2 OFFSET $3`,
      [departmentId, pagination.limit, pagination.offset],
    );
    return paginateRows(rows, pagination);
  }

  /**
   * The claim, inside one transaction with SELECT ... FOR UPDATE on the
   * entitlement row — this row lock is the whole mechanism. Two
   * concurrent claims on the last unit serialize on it: whichever
   * transaction acquires the lock second has to wait for the first to
   * commit its decrement, then re-reads available_quantity itself and
   * correctly sees zero remaining. Without the lock, both requests
   * could read "1 available" before either writes, and both would
   * succeed — exactly the double-issue the BRD calls out by name.
   *
   * The entitlement_assignments UNIQUE(entitlement_id, user_id)
   * constraint is a second, independent backstop against the same user
   * claiming twice, caught here as a friendly 409 rather than a raw
   * constraint error.
   */
  async claimEntitlement(entitlementId: string, actor: AuthenticatedUser) {
    const user = await this.usersService.findById(actor.id);
    if (!user) {
      throw new NotFoundException('User not found');
    }

    return this.db.transaction(async (client) => {
      const { rows } = await client.query<EntitlementRow>(
        `SELECT * FROM entitlements WHERE id = $1 FOR UPDATE`,
        [entitlementId],
      );
      const entitlement = rows[0];
      if (!entitlement) {
        throw new NotFoundException('Entitlement not found');
      }
      if (entitlement.status !== 'active') {
        throw new ConflictException('This entitlement is no longer active');
      }
      if (
        entitlement.scope === 'department' &&
        entitlement.department_id !== user.department_id
      ) {
        throw new ForbiddenException(
          'This entitlement is not available to your department',
        );
      }
      if (entitlement.available_quantity !== null && entitlement.available_quantity <= 0) {
        throw new ConflictException('This entitlement has no remaining quantity');
      }

      if (entitlement.available_quantity !== null) {
        await client.query(
          `UPDATE entitlements SET available_quantity = available_quantity - 1 WHERE id = $1`,
          [entitlementId],
        );
      }

      try {
        const { rows: assignmentRows } = await client.query<EntitlementAssignmentRow>(
          `INSERT INTO entitlement_assignments (entitlement_id, user_id, status)
           VALUES ($1, $2, 'claimed')
           RETURNING *`,
          [entitlementId, actor.id],
        );

        await this.activityLog.log(
          {
            actorId: actor.id,
            action: 'entitlement.claimed',
            entityType: 'entitlement',
            entityId: entitlementId,
          },
          client,
        );

        return assignmentRows[0];
      } catch (err: any) {
        if (err?.code === UNIQUE_VIOLATION) {
          throw new ConflictException('You have already claimed this entitlement');
        }
        throw err;
      }
    });
  }
}
