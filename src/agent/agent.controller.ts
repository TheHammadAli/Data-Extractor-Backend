import { Body, Controller, Get, NotFoundException, Param, Post, ServiceUnavailableException, Sse } from '@nestjs/common';
import type { Observable } from 'rxjs';
import { BrowserSessionManager } from '../browser/browser-session-manager.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { RunEventBus } from '../events/run-event-bus.service.js';
import { OpenBrowserDto } from './dto/open-browser.dto.js';
import { StartRunDto } from './dto/start-run.dto.js';
import { RunOrchestratorService } from './run-orchestrator.service.js';

@Controller('agent')
export class AgentController {
  constructor(
    private readonly orchestrator: RunOrchestratorService,
    private readonly events: RunEventBus,
    private readonly prisma: PrismaService,
    private readonly sessions: BrowserSessionManager,
  ) {}

  @Post('start')
  async start(@Body() dto: StartRunDto) {
    return this.orchestrator.startRun(dto);
  }

  /** Opens a CDP-enabled browser for users who'd rather not add the flags to Chrome themselves. */
  @Post('browser/open')
  async openBrowser(@Body() dto: OpenBrowserDto) {
    try {
      await this.sessions.openManagedBrowser(dto.url);
    } catch (err) {
      // Nest turns a plain Error into a bare "Internal server error", hiding the one thing worth
      // saying — that this machine has no browser to start.
      throw new ServiceUnavailableException(err instanceof Error ? err.message : 'Could not start a browser');
    }
    return { opened: true };
  }

  @Get('browser/status')
  async browserStatus() {
    return { open: await this.sessions.isBrowserAvailable(), mode: this.sessions.mode };
  }

  @Post('browser/close')
  async closeBrowser() {
    await this.sessions.closeManagedBrowser();
    return { closed: true };
  }

  @Get(':runId')
  async getRun(@Param('runId') runId: string) {
    const run = await this.prisma.run.findUnique({ where: { id: runId } });
    if (!run) throw new NotFoundException(`Run ${runId} not found`);
    return run;
  }

  @Sse(':runId/events')
  streamEvents(@Param('runId') runId: string): Observable<{ data: unknown }> {
    return this.events.streamForSse(runId);
  }

  @Post(':runId/continue')
  continue(@Param('runId') runId: string) {
    const resumed = this.orchestrator.resume(runId);
    return { resumed };
  }

  @Post(':runId/cancel')
  async cancel(@Param('runId') runId: string) {
    await this.orchestrator.cancel(runId);
    return { cancelled: true };
  }
}
