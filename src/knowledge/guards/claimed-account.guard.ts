import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { OnboardingsService } from '../../onboardings/onboardings.service';
import { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';

const PRE_CHECKPOINT_STATUSES = [
  'pre_onboarding',
  'email_provisioned',
  'checkpoint_pending',
];

/**
 * Runs after JwtAuthGuard, so req.user is already populated. The "claimed
 * account" half of the check is really JwtAuthGuard's job already — a
 * real access token is only ever issued (AuthService.progressFor) once
 * password reset + TOTP are both done, so holding one already proves
 * the account is claimed. What this guard adds is the "pre-checkpoint"
 * half: the caller's own onboarding must not have reached the
 * checkpoint yet. It attaches the onboarding's department onto the
 * request so the controller/service never has to trust (or even see)
 * a client-supplied department for this route.
 */
@Injectable()
export class ClaimedAccountGuard implements CanActivate {
  constructor(private readonly onboardingsService: OnboardingsService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const user: AuthenticatedUser | undefined = request.user;
    if (!user) {
      throw new ForbiddenException('No claimed account for this request');
    }

    const onboarding = await this.onboardingsService.findByUserId(user.id);
    if (!onboarding || !PRE_CHECKPOINT_STATUSES.includes(onboarding.status)) {
      throw new ForbiddenException(
        'This content is only available before your checkpoint',
      );
    }

    request.onboarding = {
      departmentId: onboarding.department_id,
      status: onboarding.status,
    };
    return true;
  }
}
