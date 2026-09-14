import { Module } from '@nestjs/common';
import { AnalyticsController } from './analytics.controller.ts';
import { AnalyticsService } from './analytics.service.ts';

@Module({
  imports: [],
  controllers: [AnalyticsController],
  providers: [AnalyticsService],
})
export class AppModule {}