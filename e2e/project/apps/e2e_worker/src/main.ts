import 'reflect-metadata';
import { createYandexHandler } from '@ycforge/nestjs-connector';
import { AppModule } from './app.module';

export const handler = createYandexHandler(AppModule);
