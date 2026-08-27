import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export interface PreAuthContext {
  userId: string;
  totpVerified: boolean;
}

/** Use on any endpoint behind PreAuthGuard: @PreAuthUser() ctx: PreAuthContext
 *  This is the direct fix for the gap flagged at the end of Step 5 —
 *  identity now comes from a verified token, never a request body field. */
export const PreAuthUser = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): PreAuthContext => {
    const request = ctx.switchToHttp().getRequest();
    return request.preAuth;
  },
);
