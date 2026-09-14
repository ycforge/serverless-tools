import { Controller, Get } from '@nestjs/common';
import { AnalyticsService } from './analytics.service.ts';

@Controller()
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Get()
  getHealth() {
    return this.analyticsService.health();
  }
}