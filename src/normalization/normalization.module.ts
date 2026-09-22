import { Module } from '@nestjs/common';
import { DedupeService } from './dedupe.service.js';
import { NormalizationService } from './normalization.service.js';

@Module({
  providers: [NormalizationService, DedupeService],
  exports: [NormalizationService, DedupeService],
})
export class NormalizationModule {}
