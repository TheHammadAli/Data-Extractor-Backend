import { Module } from '@nestjs/common';
import { CsvWriterService } from './csv-writer.service.js';
import { LocalDiskStorageAdapter } from './local-disk-storage.adapter.js';
import { STORAGE_ADAPTER } from './storage-adapter.interface.js';

@Module({
  providers: [CsvWriterService, { provide: STORAGE_ADAPTER, useClass: LocalDiskStorageAdapter }],
  exports: [CsvWriterService, STORAGE_ADAPTER],
})
export class CsvModule {}
