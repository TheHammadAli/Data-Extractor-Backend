import { Module } from '@nestjs/common';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { AgentModule } from './agent/agent.module.js';
import { ConfigModule } from './config/config.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { ResultsModule } from './results/results.module.js';

@Module({
  imports: [ConfigModule, PrismaModule, AgentModule, ResultsModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
