import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { stringify } from 'csv-stringify/sync';
import { PrismaService } from '../prisma/prisma.service.js';
import { STORAGE_ADAPTER, type StorageAdapter } from './storage-adapter.interface.js';

const BOM = '﻿';

@Injectable()
export class CsvWriterService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(STORAGE_ADAPTER) private readonly storage: StorageAdapter,
  ) {}

  async generate(runId: string): Promise<{ filename: string; recordCount: number }> {
    const run = await this.prisma.run.findUnique({ where: { id: runId } });
    if (!run) throw new NotFoundException(`Run ${runId} not found`);

    const listings = await this.prisma.extractedListing.findMany({
      where: { runId },
      orderBy: { createdAt: 'asc' },
    });

    const fieldList = (run.fieldList as string[]) ?? [];
    const columns = ['source_url', 'listing_url', ...fieldList];

    const rows = listings.map((listing) => {
      const data = (listing.data as Record<string, string>) ?? {};
      return [run.targetUrl, listing.listingUrl, ...fieldList.map((field) => data[field] ?? '')];
    });

    const csvBody = stringify(rows, { header: true, columns });
    const filename = `run-${runId}.csv`;
    const { sizeBytes } = await this.storage.write(filename, BOM + csvBody);

    await this.prisma.csvFile.upsert({
      where: { runId },
      create: {
        runId,
        filename,
        filePath: filename,
        columns,
        recordCount: listings.length,
        fileSizeBytes: sizeBytes,
      },
      update: {
        filename,
        filePath: filename,
        columns,
        recordCount: listings.length,
        fileSizeBytes: sizeBytes,
      },
    });

    return { filename, recordCount: listings.length };
  }
}
