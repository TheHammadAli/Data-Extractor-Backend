import type { RunEventType } from '@prisma/client';

export interface EmitRunEventInput {
  runId: string;
  type: RunEventType;
  message: string;
  metadata?: Record<string, unknown>;
}

export interface RunEventPayload extends EmitRunEventInput {
  id: string;
  createdAt: Date;
}
