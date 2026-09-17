import { Module } from '@nestjs/common';
import { AnalyticsController } from './analytics.controller.ts';
import { AnalyticsService } from './analytics.service.ts';
import { KmsController } from './kms.controller.ts';

@Module({
  imports: [],
  controllers: [AnalyticsController, KmsController],
  providers: [AnalyticsService],
})
export class AppModule {}