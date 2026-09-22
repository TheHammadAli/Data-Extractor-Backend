import { Global, Module } from '@nestjs/common';
import { ConfigModule as NestConfigModule } from '@nestjs/config';
import { loadAppEnv } from './env.validation.js';

export const APP_ENV = Symbol('APP_ENV');

@Global()
@Module({
  imports: [NestConfigModule.forRoot({ isGlobal: true })],
  providers: [
    {
      provide: APP_ENV,
      useFactory: () => loadAppEnv(),
    },
  ],
  exports: [APP_ENV],
})
export class ConfigModule {}
