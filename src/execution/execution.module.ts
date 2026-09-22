import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module.js';
import { BrowserModule } from '../browser/browser.module.js';
import { CredentialsModule } from '../credentials/credentials.module.js';
import { EventsModule } from '../events/events.module.js';
import { NormalizationModule } from '../normalization/normalization.module.js';
import { GroundedActionService } from './grounded-action.service.js';
import { PlanExecutorService } from './plan-executor.service.js';
import { RunControlService } from './run-control.service.js';

@Module({
  imports: [AiModule, BrowserModule, EventsModule, NormalizationModule, CredentialsModule],
  providers: [GroundedActionService, PlanExecutorService, RunControlService],
  exports: [PlanExecutorService, RunControlService],
})
export class ExecutionModule {}
