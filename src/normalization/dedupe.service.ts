import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';

export interface DedupeInput {
  listingUrl?: string;
  listingId?: string;
  title?: string;
  seller?: string;
  price?: string;
  address?: string;
}

function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.origin}${u.pathname}`.toLowerCase().replace(/\/$/, '');
  } catch {
    return url.trim().toLowerCase();
  }
}

@Injectable()
export class DedupeService {
  /** Prefers listing URL, then listing ID, then a composite hash — never a raw guess. */
  computeKey(input: DedupeInput): string {
    if (input.listingUrl) return `url:${normalizeUrl(input.listingUrl)}`;
    if (input.listingId) return `id:${input.listingId}`;

    const composite = [input.title, input.seller, input.price, input.address]
      .map((v) => (v ?? '').trim().toLowerCase())
      .join('|');
    return `composite:${createHash('sha1').update(composite).digest('hex')}`;
  }
}
