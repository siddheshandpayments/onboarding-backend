import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

const STATUS_CODE_NAMES: Record<number, string> = {
  [HttpStatus.BAD_REQUEST]: 'BAD_REQUEST',
  [HttpStatus.UNAUTHORIZED]: 'UNAUTHORIZED',
  [HttpStatus.FORBIDDEN]: 'FORBIDDEN',
  [HttpStatus.NOT_FOUND]: 'NOT_FOUND',
  [HttpStatus.CONFLICT]: 'CONFLICT',
  [HttpStatus.UNPROCESSABLE_ENTITY]: 'UNPROCESSABLE_ENTITY',
  [HttpStatus.TOO_MANY_REQUESTS]: 'TOO_MANY_REQUESTS',
  [HttpStatus.INTERNAL_SERVER_ERROR]: 'INTERNAL_SERVER_ERROR',
  [HttpStatus.SERVICE_UNAVAILABLE]: 'SERVICE_UNAVAILABLE',
};

/**
 * Step 34: every error response, from every endpoint, has the exact
 * same shape — {statusCode, code, message} — whether it came from a
 * deliberate `throw new ForbiddenException(...)` deep in a service,
 * NestJS's own ValidationPipe, or a genuinely unexpected bug. "No raw
 * 'Error: forbidden'" means the client never sees a stack trace, an
 * Error object's default toString(), or any other implementation
 * detail — only ever this one clean, explainable shape.
 *
 * `code` is derived from the HTTP status via a fixed lookup, not
 * hand-picked per exception class — so any current or future
 * HttpException subclass (including ones from third-party guards or
 * pipes this codebase didn't write) automatically gets a consistent
 * machine-readable code with no extra wiring required.
 *
 * `@Catch()` with no argument means this catches literally everything,
 * not just HttpException — that's deliberate. Anything that ISN'T an
 * HttpException is a genuine bug (a null dereference, an unexpected
 * driver error, etc.), not a deliberate business rejection. It's
 * logged server-side with its real message/stack for debugging, but
 * the client only ever receives a generic 500 — the real message and
 * stack are exactly the kind of internal detail that must never reach
 * a response body.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    if (exception instanceof HttpException) {
      const statusCode = exception.getStatus();
      const body = exception.getResponse();
      const message =
        typeof body === 'string'
          ? body
          : ((body as { message?: string | string[] }).message ?? exception.message);

      response.status(statusCode).json({
        statusCode,
        code: STATUS_CODE_NAMES[statusCode] ?? `HTTP_${statusCode}`,
        message,
      });
      return;
    }

    this.logger.error(
      exception instanceof Error ? (exception.stack ?? exception.message) : String(exception),
      undefined,
      `${request.method} ${request.url}`,
    );

    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      code: 'INTERNAL_SERVER_ERROR',
      message: 'An unexpected error occurred',
    });
  }
}
