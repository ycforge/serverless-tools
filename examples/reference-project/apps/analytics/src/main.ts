import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.ts';

const port = Number(process.env.PORT ?? 8080);

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  // The API Gateway `serverless_containers` integration proxies the request
  // path as-is (no prefix stripping), so the app serves its routes under the
  // same prefix the gateway routes on. Controllers declare prefix-relative
  // paths only; the full public path is prefix + controller path.
  app.setGlobalPrefix('analytics');
  await app.listen(port);
  console.log(`analytics container listening on :${port}`);
}

void bootstrap();