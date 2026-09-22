import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module.js';
import { BrowserModule } from '../browser/browser.module.js';
import { CredentialsModule } from '../credentials/credentials.module.js';
import { CsvModule } from '../csv/csv.module.js';
import { EventsModule } from '../events/events.module.js';
import { ExecutionModule } from '../execution/execution.module.js';
import { AgentController } from './agent.controller.js';
import { RunOrchestratorService } from './run-orchestrator.service.js';

@Module({
  imports: [AiModule, BrowserModule, CredentialsModule, CsvModule, EventsModule, ExecutionModule],
  controllers: [AgentController],
  providers: [RunOrchestratorService],
})
export class AgentModule {}
