import { Controller, Get, Inject } from '@nestjs/common';
import { AnalyticsService } from './analytics.service.ts';

// Health root of the analytics API. The public path `/analytics` is the
// global prefix (see main.ts) + this controller's root route.
// `@Inject` is explicit so the module also boots under transpilers without
// `emitDecoratorMetadata` (hermetic route tests, esbuild/tsx).
@Controller()
export class AnalyticsController {
  constructor(@Inject(AnalyticsService) private readonly analyticsService: AnalyticsService) {}

  @Get()
  getRootHealth() {
    return this.analyticsService.health();
  }
}