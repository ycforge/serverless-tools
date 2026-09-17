import { Controller, Get } from '@nestjs/common';
import { AnalyticsService } from './analytics.service.ts';

// The API Gateway `serverless_containers` integration proxies the request
// path as-is (no prefix stripping), so a gateway route `/analytics` reaches
// the container as `/analytics`. Both the gateway path and the container's
// own `/` health root are served.
@Controller()
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Get()
  getRootHealth() {
    return this.analyticsService.health();
  }

  @Get('analytics')
  getHealth() {
    return this.analyticsService.health();
  }
}