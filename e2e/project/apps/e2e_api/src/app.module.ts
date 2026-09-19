import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { HealthController } from './health.controller';
import { KmsController } from './kms.controller';
import { LogsController } from './logs.controller';
import { E2eHeaderGuard } from './header.guard';

@Module({
  controllers: [AppController, HealthController, KmsController, LogsController],
  providers: [E2eHeaderGuard],
})
export class AppModule {}
