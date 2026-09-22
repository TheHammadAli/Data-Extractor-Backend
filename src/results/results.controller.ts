import { Controller, Get, Inject, NotFoundException, Param, Query, Res, StreamableFile } from '@nestjs/common';
import type { Response } from 'express';
import { createReadStream } from 'node:fs';
import { PrismaService } from '../prisma/prisma.service.js';
import { STORAGE_ADAPTER, type StorageAdapter } from '../csv/storage-adapter.interface.js';

const TRUNCATE_LENGTH = 200;
const DEFAULT_PAGE_SIZE = 20;

@Controller('results')
export class ResultsController {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(STORAGE_ADAPTER) private readonly storage: StorageAdapter,
  ) {}

  @Get()
  async list() {
    const runs = await this.prisma.run.findMany({
      where: { csvFile: { isNot: null } },
      include: { csvFile: true },
      orderBy: { createdAt: 'desc' },
    });
    return runs.map((run) => ({
      runId: run.id,
      filename: run.csvFile?.filename,
      recordCount: run.csvFile?.recordCount ?? 0,
      createdAt: run.csvFile?.createdAt ?? run.createdAt,
      status: run.status,
      targetUrl: run.targetUrl,
    }));
  }

  @Get(':runId/preview')
  async preview(@Param('runId') runId: string, @Query('page') pageRaw?: string, @Query('pageSize') pageSizeRaw?: string) {
    const run = await this.prisma.run.findUnique({ where: { id: runId } });
    if (!run) throw new NotFoundException(`Run ${runId} not found`);

    const page = Math.max(1, Number(pageRaw) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(pageSizeRaw) || DEFAULT_PAGE_SIZE));

    const [listings, total] = await Promise.all([
      this.prisma.extractedListing.findMany({
        where: { runId },
        orderBy: { createdAt: 'asc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.extractedListing.count({ where: { runId } }),
    ]);

    const columns = ['listing_url', ...((run.fieldList as string[]) ?? [])];
    const rows = listings.map((listing) => {
      const raw = (listing.data as Record<string, string>) ?? {};
      const data: Record<string, string> = {};
      const truncatedFields: string[] = [];
      for (const field of (run.fieldList as string[]) ?? []) {
        const value = raw[field] ?? '';
        if (value.length > TRUNCATE_LENGTH) {
          data[field] = `${value.slice(0, TRUNCATE_LENGTH)}…`;
          truncatedFields.push(field);
        } else {
          data[field] = value;
        }
      }
      return { id: listing.id, listingUrl: listing.listingUrl, data, truncatedFields };
    });

    return { columns, rows, total, page, pageSize };
  }

  @Get(':runId/listing/:listingId')
  async listingDetail(@Param('runId') runId: string, @Param('listingId') listingId: string) {
    const listing = await this.prisma.extractedListing.findFirst({ where: { id: listingId, runId } });
    if (!listing) throw new NotFoundException(`Listing ${listingId} not found`);
    return { id: listing.id, listingUrl: listing.listingUrl, data: listing.data };
  }

  @Get(':runId/download')
  async download(@Param('runId') runId: string, @Res({ passthrough: true }) res: Response): Promise<StreamableFile> {
    const csvFile = await this.prisma.csvFile.findUnique({ where: { runId } });
    if (!csvFile) throw new NotFoundException(`No CSV file for run ${runId}`);

    const absolutePath = this.storage.resolveAbsolutePath(csvFile.filePath);
    res.set({
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${csvFile.filename}"`,
    });
    return new StreamableFile(createReadStream(absolutePath));
  }
}
