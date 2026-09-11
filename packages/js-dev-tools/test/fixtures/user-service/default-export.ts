import { Module } from '@nestjs/common';
import { AppController } from './app.module';

@Module({ controllers: [AppController] })
export default class DefaultAppModule {}