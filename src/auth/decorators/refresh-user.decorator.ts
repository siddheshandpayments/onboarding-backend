import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/** Use on the endpoint behind RefreshGuard: @RefreshUser() userId: string */
export const RefreshUser = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): string => {
    const request = ctx.switchToHttp().getRequest();
    return request.refreshUserId;
  },
);
