import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export interface ClaimedOnboardingContext {
  departmentId: string;
  status: string;
}

/** Use on any endpoint behind ClaimedAccountGuard:
 *  @ClaimedOnboarding() ctx: ClaimedOnboardingContext */
export const ClaimedOnboarding = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): ClaimedOnboardingContext => {
    const request = ctx.switchToHttp().getRequest();
    return request.onboarding;
  },
);
