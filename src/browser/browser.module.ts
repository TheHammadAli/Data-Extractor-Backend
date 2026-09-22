import { Module } from '@nestjs/common';
import { BrowserSessionManager } from './browser-session-manager.service.js';
import { CaptchaDetectorService } from './captcha-detector.service.js';
import { ListingCardDetectorService } from './listing-card-detector.service.js';
import { PageActionsService } from './page-actions.service.js';
import { PaginationDetectorService } from './pagination-detector.service.js';
import { SnapshotSerializerService } from './snapshot-serializer.service.js';

@Module({
  providers: [
    BrowserSessionManager,
    SnapshotSerializerService,
    PageActionsService,
    CaptchaDetectorService,
    ListingCardDetectorService,
    PaginationDetectorService,
  ],
  exports: [
    BrowserSessionManager,
    SnapshotSerializerService,
    PageActionsService,
    CaptchaDetectorService,
    ListingCardDetectorService,
    PaginationDetectorService,
  ],
})
export class BrowserModule {}
