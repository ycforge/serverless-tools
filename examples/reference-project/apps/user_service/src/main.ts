import 'reflect-metadata';
import { AppModule } from './app.module';
import { createYandexHandler } from '@ycforge/nestjs-connector';

export const handler = createYandexHandler(AppModule);