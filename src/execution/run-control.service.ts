import { Injectable } from '@nestjs/common';

/** Per-run pause/resume/cancel signalling shared between the orchestrator and the plan executor. */
@Injectable()
export class RunControlService {
  private readonly pauseResolvers = new Map<string, () => void>();
  private readonly cancelled = new Set<string>();

  waitForResume(runId: string): Promise<void> {
    return new Promise((resolve) => {
      this.pauseResolvers.set(runId, resolve);
    });
  }

  resume(runId: string): boolean {
    const resolver = this.pauseResolvers.get(runId);
    if (!resolver) return false;
    this.pauseResolvers.delete(runId);
    resolver();
    return true;
  }

  cancel(runId: string): void {
    this.cancelled.add(runId);
    this.resume(runId);
  }

  isCancelled(runId: string): boolean {
    return this.cancelled.has(runId);
  }

  clear(runId: string): void {
    this.cancelled.delete(runId);
    this.pauseResolvers.delete(runId);
  }
}
