import { Injectable, Logger } from '@nestjs/common';

export interface RunCredentials {
  username: string;
  password: string;
}

const ABANDONMENT_TIMEOUT_MS = 30 * 60 * 1000;

/**
 * Process-memory-only credential store. Credentials from the /agent form NEVER touch Prisma —
 * this is the only place they live, and only for as long as a run needs them.
 */
@Injectable()
export class CredentialsService {
  private readonly logger = new Logger(CredentialsService.name);
  private readonly store = new Map<string, RunCredentials>();
  private readonly timers = new Map<string, NodeJS.Timeout>();

  save(runId: string, credentials: RunCredentials): void {
    this.store.set(runId, credentials);
    const timer = setTimeout(() => this.wipe(runId), ABANDONMENT_TIMEOUT_MS);
    this.timers.set(runId, timer);
  }

  /** Returns credentials without clearing them (LoginHandler may need to re-read on retry). */
  peek(runId: string): RunCredentials | undefined {
    return this.store.get(runId);
  }

  wipe(runId: string): void {
    if (this.store.delete(runId)) {
      this.logger.debug(`Wiped credentials for run ${runId}`);
    }
    const timer = this.timers.get(runId);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(runId);
    }
  }
}
