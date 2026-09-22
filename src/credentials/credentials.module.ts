import { Module } from '@nestjs/common';
import { CredentialsService } from './credentials.service.js';

@Module({
  providers: [CredentialsService],
  exports: [CredentialsService],
})
export class CredentialsModule {}
