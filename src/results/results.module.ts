import { Module } from '@nestjs/common';
import { CsvModule } from '../csv/csv.module.js';
import { ResultsController } from './results.controller.js';

@Module({
  imports: [CsvModule],
  controllers: [ResultsController],
})
export class ResultsModule {}
