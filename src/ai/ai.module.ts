import { Module } from '@nestjs/common';
import { APP_ENV } from '../config/config.module.js';
import type { AppEnv } from '../config/env.validation.js';
import { AI_SERVICE } from './ai.constants.js';
import { AnthropicAiProvider } from './providers/anthropic-ai.provider.js';
import { GeminiAiProvider } from './providers/gemini-ai.provider.js';
import { MockAiProvider } from './providers/mock-ai.provider.js';
import { OpenRouterAiProvider } from './providers/openrouter-ai.provider.js';

@Module({
  providers: [
    MockAiProvider,
    AnthropicAiProvider,
    GeminiAiProvider,
    OpenRouterAiProvider,
    {
      provide: AI_SERVICE,
      inject: [APP_ENV, MockAiProvider, AnthropicAiProvider, GeminiAiProvider, OpenRouterAiProvider],
      useFactory: (
        env: AppEnv,
        mock: MockAiProvider,
        anthropic: AnthropicAiProvider,
        gemini: GeminiAiProvider,
        openrouter: OpenRouterAiProvider,
      ) => {
        if (env.AI_PROVIDER === 'anthropic') return anthropic;
        if (env.AI_PROVIDER === 'gemini') return gemini;
        if (env.AI_PROVIDER === 'openrouter') return openrouter;
        return mock;
      },
    },
  ],
  exports: [AI_SERVICE],
})
export class AiModule {}
