import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module.js';
import { loadAppEnv } from './config/env.validation.js';
import { RedactLogsInterceptor } from './common/redact-logs.interceptor.js';

async function bootstrap() {
  const env = loadAppEnv();
  const app = await NestFactory.create(AppModule);

  app.enableCors({ origin: env.FRONTEND_ORIGIN, credentials: true });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.useGlobalInterceptors(new RedactLogsInterceptor());

  await app.listen(env.PORT);
}
await bootstrap();
