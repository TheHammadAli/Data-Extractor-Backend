import { Injectable } from '@nestjs/common';
import { Subject, Observable, concat, map } from 'rxjs';
import { PrismaService } from '../prisma/prisma.service.js';
import type { EmitRunEventInput, RunEventPayload } from './events.types.js';

interface SseMessage {
  data: { kind: 'snapshot' | 'event'; payload: unknown };
}

@Injectable()
export class RunEventBus {
  private readonly subjects = new Map<string, Subject<RunEventPayload>>();

  constructor(private readonly prisma: PrismaService) {}

  private subjectFor(runId: string): Subject<RunEventPayload> {
    let subject = this.subjects.get(runId);
    if (!subject) {
      subject = new Subject<RunEventPayload>();
      this.subjects.set(runId, subject);
    }
    return subject;
  }

  async emit(input: EmitRunEventInput): Promise<RunEventPayload> {
    const saved = await this.prisma.runEvent.create({
      data: {
        runId: input.runId,
        type: input.type,
        message: input.message,
        metadata: (input.metadata ?? {}) as object,
      },
    });
    const payload: RunEventPayload = {
      id: saved.id,
      runId: saved.runId,
      type: saved.type,
      message: saved.message,
      metadata: (saved.metadata as Record<string, unknown>) ?? {},
      createdAt: saved.createdAt,
    };
    this.subjectFor(input.runId).next(payload);
    return payload;
  }

  /** Closes the live subject for a run once it reaches a terminal state; safe to call multiple times. */
  complete(runId: string): void {
    const subject = this.subjects.get(runId);
    if (subject) {
      subject.complete();
      this.subjects.delete(runId);
    }
  }

  /** Snapshot (current Run + past events) followed by the live event stream, for SSE. */
  streamForSse(runId: string): Observable<SseMessage> {
    const snapshot$ = new Observable<SseMessage>((subscriber) => {
      void this.buildSnapshot(runId).then((snapshot) => {
        subscriber.next({ data: { kind: 'snapshot', payload: snapshot } });
        subscriber.complete();
      });
    });

    const live$ = this.subjectFor(runId).asObservable().pipe(
      map((event): SseMessage => ({ data: { kind: 'event', payload: event } })),
    );

    return concat(snapshot$, live$);
  }

  private async buildSnapshot(runId: string) {
    const run = await this.prisma.run.findUnique({ where: { id: runId } });
    const events = await this.prisma.runEvent.findMany({
      where: { runId },
      orderBy: { createdAt: 'asc' },
    });
    return { run, events };
  }
}
