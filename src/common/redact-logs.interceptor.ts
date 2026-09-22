import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from '@nestjs/common';
import type { Request } from 'express';
import { tap } from 'rxjs';

const SENSITIVE_KEYS = new Set(['password', 'username', 'pass', 'pwd']);

function redact(body: unknown): unknown {
  if (!body || typeof body !== 'object') return body;
  const clone: Record<string, unknown> = { ...(body as Record<string, unknown>) };
  for (const key of Object.keys(clone)) {
    if (SENSITIVE_KEYS.has(key.toLowerCase())) clone[key] = '[redacted]';
  }
  return clone;
}

/** Defense-in-depth: ensures request logging never accidentally prints raw credentials. */
@Injectable()
export class RedactLogsInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  intercept(context: ExecutionContext, next: CallHandler) {
    const req = context.switchToHttp().getRequest<Request>();
    this.logger.debug(`${req.method} ${req.url} ${JSON.stringify(redact(req.body))}`);
    return next.handle().pipe(tap());
  }
}
