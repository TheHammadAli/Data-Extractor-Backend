import { Module } from '@nestjs/common';
import { RunEventBus } from './run-event-bus.service.js';

@Module({
  providers: [RunEventBus],
  exports: [RunEventBus],
})
export class EventsModule {}
