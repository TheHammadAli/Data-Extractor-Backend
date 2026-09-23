import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/** Prisma's codes for "could not reach the database" and "server closed the connection". */
const TRANSIENT_CODES = new Set(['P1001', 'P1017']);
const RETRY_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 500;

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }

  /**
   * Retries a write that failed only because the database was briefly unreachable. Pooled/serverless
   * Postgres drops connections routinely, and a blip mid-run used to throw away a run that had
   * already extracted rows.
   */
  async withRetry<T>(operation: () => Promise<T>): Promise<T> {
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await operation();
      } catch (err) {
        const code = (err as { code?: string }).code;
        if (attempt >= RETRY_ATTEMPTS || !code || !TRANSIENT_CODES.has(code)) throw err;
        this.logger.warn(`Database unreachable (${code}), attempt ${attempt}/${RETRY_ATTEMPTS} — retrying.`);
        await new Promise((resolve) => setTimeout(resolve, RETRY_BASE_DELAY_MS * attempt));
      }
    }
  }
}
