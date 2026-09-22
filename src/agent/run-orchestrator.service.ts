import { Inject, Injectable, Logger } from '@nestjs/common';
import { AI_SERVICE } from '../ai/ai.constants.js';
import type { AiService } from '../ai/ai.service.interface.js';
import { BrowserSessionManager } from '../browser/browser-session-manager.service.js';
import { CredentialsService } from '../credentials/credentials.service.js';
import { CsvWriterService } from '../csv/csv-writer.service.js';
import { RunEventBus } from '../events/run-event-bus.service.js';
import { RunControlService } from '../execution/run-control.service.js';
import { PlanExecutorService } from '../execution/plan-executor.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { StartRunDto } from './dto/start-run.dto.js';

@Injectable()
export class RunOrchestratorService {
  private readonly logger = new Logger(RunOrchestratorService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(AI_SERVICE) private readonly ai: AiService,
    private readonly credentials: CredentialsService,
    private readonly sessions: BrowserSessionManager,
    private readonly planExecutor: PlanExecutorService,
    private readonly csvWriter: CsvWriterService,
    private readonly events: RunEventBus,
    private readonly control: RunControlService,
  ) {}

  async startRun(dto: StartRunDto): Promise<{ runId: string }> {
    const run = await this.prisma.run.create({
      data: {
        targetUrl: dto.url,
        instructionsText: dto.instructions,
        fieldList: [],
        status: 'PENDING',
      },
    });

    if (dto.username || dto.password) {
      this.credentials.save(run.id, { username: dto.username ?? '', password: dto.password ?? '' });
    }

    // Fire-and-forget: the HTTP response returns immediately with the runId; progress streams via SSE.
    void this.executeRun(run.id).catch((err) => this.logger.error(`Unhandled error in run ${run.id}: ${err}`));

    return { runId: run.id };
  }

  resume(runId: string): boolean {
    return this.control.resume(runId);
  }

  /**
   * Only signals cancellation and records the terminal status. Actual cleanup (closing the
   * browser, completing the event stream, clearing control state) stays solely in executeRun's
   * `finally` — doing it here too would race an in-flight run's own cleanup and could flip the
   * status back to FAILED if a Playwright call mid-flight throws against a browser we closed
   * out from under it.
   */
  async cancel(runId: string): Promise<void> {
    this.control.cancel(runId);
    await this.prisma.run
      .update({ where: { id: runId }, data: { status: 'CANCELLED', completedAt: new Date() } })
      .catch(() => undefined);
    await this.events.emit({ runId, type: 'LOG', message: 'Run cancelled.', metadata: { status: 'CANCELLED' } });
  }

  /** Reads an explicit count like "open first 5 listings" / "only 10 ads" out of the instructions. */
  private parseStatedListingLimit(instructions: string): number | undefined {
    const match = /(?:first|only|top)\s+(\d{1,3})\s+(?:listings?|ads?|items?|results?)/i.exec(instructions);
    if (!match) return undefined;
    const limit = Number(match[1]);
    return Number.isFinite(limit) && limit > 0 ? limit : undefined;
  }

  private async executeRun(runId: string): Promise<void> {
    try {
      await this.prisma.run.update({ where: { id: runId }, data: { status: 'PLANNING', startedAt: new Date() } });
      await this.events.emit({ runId, type: 'LOG', message: 'Understanding instructions...' });

      const run = await this.prisma.run.findUniqueOrThrow({ where: { id: runId } });
      const plan = await this.ai.parseInstructionsToPlan(run.instructionsText, run.targetUrl);

      // "first 5 listings" is a hard cap, so read it from the instructions directly rather than
      // trusting the model to have carried it into the plan.
      const statedLimit = this.parseStatedListingLimit(run.instructionsText);
      if (statedLimit !== undefined) plan.listingLimit = statedLimit;

      await this.prisma.run.update({
        where: { id: runId },
        data: { planJson: plan as unknown as object, fieldList: plan.fieldList, status: 'RUNNING' },
      });
      await this.events.emit({ runId, type: 'LOG', message: `Plan ready (${plan.steps.length} steps, fields: ${plan.fieldList.join(', ') || 'none'})` });

      const { page, how } = await this.sessions.attach(runId, run.targetUrl);
      await this.events.emit({
        runId,
        type: 'LOG',
        message:
          how === 'existing-tab'
            ? `Attached to your open tab: ${page.url()}`
            : 'Attached to your browser — opening a tab in that same session.',
      });
      await this.planExecutor.run(runId, page, plan, run.targetUrl);

      if (this.control.isCancelled(runId)) return;

      await this.events.emit({ runId, type: 'LOG', message: 'Generating CSV...' });
      const csv = await this.csvWriter.generate(runId);

      await this.prisma.run.update({
        where: { id: runId },
        data: { status: 'COMPLETED', completedAt: new Date() },
      });
      await this.events.emit({
        runId,
        type: 'LOG',
        message: `Done. ${csv.recordCount} record(s) saved to ${csv.filename}.`,
        metadata: { status: 'COMPLETED' },
      });
    } catch (err) {
      this.logger.error(`Run ${runId} failed: ${err}`);
      await this.prisma.run.update({
        where: { id: runId },
        data: { status: 'FAILED', errorMessage: String(err), completedAt: new Date() },
      }).catch(() => undefined);
      await this.events.emit({
        runId,
        type: 'ERROR',
        message: `Run failed: ${err instanceof Error ? err.message : String(err)}`,
        metadata: { status: 'FAILED' },
      });
    } finally {
      await this.sessions.close(runId);
      this.events.complete(runId);
      this.control.clear(runId);
    }
  }
}
