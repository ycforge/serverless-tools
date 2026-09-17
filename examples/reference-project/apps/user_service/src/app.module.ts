import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { KmsController } from './kms.controller';

@Module({
  controllers: [AppController, KmsController],
})
export class AppModule {}