import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { KmsController } from './kms.controller';
import { LogsController } from './logs.controller';

@Module({
  controllers: [AppController, KmsController, LogsController],
})
export class AppModule {}