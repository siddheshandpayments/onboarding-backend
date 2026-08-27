import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { UsersService } from '../users/users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { generateLoginEmail, generateTempPassword } from './utils/credential-generator';

const BCRYPT_ROUNDS = 12;

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Creates a new account (HR creating a joiner, or SuperAdmin creating
   * a TaskOwner/HR account). Returns the temp login email + PLAINTEXT
   * temp password exactly once, in this response — nowhere else, ever
   * again. The hash is what actually gets persisted; the plaintext
   * value returned here is not retrievable through any other endpoint.
   * It's on HR to copy it out of this response and deliver it to the
   * person manually (no personal email is stored, so the system has
   * no address to send it to itself).
   */
  async createUser(dto: CreateUserDto) {
    const domain = this.config.get<string>('LOGIN_EMAIL_DOMAIN')!;
    const tempPassword = generateTempPassword();
    const passwordHash = await bcrypt.hash(tempPassword, BCRYPT_ROUNDS);

    // Synthetic email collisions are astronomically unlikely (6-char
    // random suffix) but the DB's UNIQUE constraint is the real
    // guarantee — retry generation a couple of times on the rare clash
    // rather than surfacing a raw constraint-violation error.
    let user;
    let attempts = 0;
    while (!user) {
      const tempLoginEmail = generateLoginEmail(dto.fullName, domain);
      try {
        user = await this.usersService.insertUser({
          fullName: dto.fullName,
          phoneNumber: dto.phoneNumber,
          tempLoginEmail,
          passwordHash,
          role: dto.role,
          departmentId: dto.departmentId ?? null,
        });
      } catch (err) {
        attempts++;
        if (attempts >= 3) throw err;
      }
    }

    return {
      user: this.usersService.toPublicUser(user),
      credentials: {
        loginEmail: user.temp_login_email,
        temporaryPassword: tempPassword,
        note: 'Shown once. Deliver to the employee directly — this will not be shown again.',
      },
    };
  }

  /**
   * SuperAdmin/HR action for a locked-out or lost-credential case.
   * Same reveal-once shape as creation. This is the only "password
   * reset" path that exists pre-company-email, since there is no
   * address to send a reset link to.
   */
  async regenerateCredentials(userId: string) {
    const user = await this.usersService.findById(userId);
    if (!user) throw new NotFoundException('User not found');

    const tempPassword = generateTempPassword();
    const passwordHash = await bcrypt.hash(tempPassword, BCRYPT_ROUNDS);
    await this.usersService.setPasswordHash(userId, passwordHash);

    return {
      credentials: {
        loginEmail: user.company_email_active ? user.company_email : user.temp_login_email,
        temporaryPassword: tempPassword,
        note: 'Shown once. Deliver to the employee directly — this will not be shown again.',
      },
    };
  }
}
