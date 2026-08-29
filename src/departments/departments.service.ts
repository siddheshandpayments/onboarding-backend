import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';

export interface DepartmentRow {
  id: string;
  name: string;
}

/**
 * Departments are referenced by id everywhere (users, templates,
 * entitlements, documents...) but nothing exposed a way to actually
 * list them — a real gap that only became obvious once the frontend
 * (Step 38) needed to populate a department dropdown. Read-only,
 * available to any authenticated role: knowing department names isn't
 * sensitive, and every role needs it somewhere (HR's Add Joiner form,
 * an employee's own filters, etc.).
 */
@Injectable()
export class DepartmentsService {
  constructor(private readonly db: DatabaseService) {}

  async listAll(): Promise<DepartmentRow[]> {
    const { rows } = await this.db.query<DepartmentRow>(
      `SELECT id, name FROM departments ORDER BY name`,
    );
    return rows;
  }
}
