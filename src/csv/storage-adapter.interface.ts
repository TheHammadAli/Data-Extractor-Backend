export interface WriteResult {
  absolutePath: string;
  sizeBytes: number;
}

export interface StorageAdapter {
  write(relativePath: string, content: string): Promise<WriteResult>;
  read(relativePath: string): Promise<Buffer>;
  resolveAbsolutePath(relativePath: string): string;
}

export const STORAGE_ADAPTER = Symbol('STORAGE_ADAPTER');
