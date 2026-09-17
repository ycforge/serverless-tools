import { Module } from '@nestjs/common';
import { WorkerController } from './worker.controller';

@Module({
  controllers: [WorkerController],
})
export class AppModule {}
