import { Inject, Injectable } from '@nestjs/common';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { APP_ENV } from '../config/config.module.js';
import type { AppEnv } from '../config/env.validation.js';
import type { StorageAdapter, WriteResult } from './storage-adapter.interface.js';

@Injectable()
export class LocalDiskStorageAdapter implements StorageAdapter {
  private readonly baseDir: string;

  constructor(@Inject(APP_ENV) env: AppEnv) {
    this.baseDir = isAbsolute(env.CSV_STORAGE_DIR) ? env.CSV_STORAGE_DIR : resolve(process.cwd(), env.CSV_STORAGE_DIR);
  }

  resolveAbsolutePath(relativePath: string): string {
    return join(this.baseDir, relativePath);
  }

  async write(relativePath: string, content: string): Promise<WriteResult> {
    const absolutePath = this.resolveAbsolutePath(relativePath);
    await mkdir(dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, content, 'utf-8');
    const stats = await stat(absolutePath);
    return { absolutePath, sizeBytes: stats.size };
  }

  async read(relativePath: string): Promise<Buffer> {
    return readFile(this.resolveAbsolutePath(relativePath));
  }
}
