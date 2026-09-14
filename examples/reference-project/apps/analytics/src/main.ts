import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.ts';

const port = Number(process.env.PORT ?? 8080);

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  await app.listen(port);
  console.log(`analytics container listening on :${port}`);
}

void bootstrap();