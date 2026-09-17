import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NestFactory } from '@nestjs/core';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { parse } from 'yaml';
import type { INestApplication } from '@nestjs/common';

import { AppModule } from '../apps/analytics/src/app.module.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const GLOBAL_PREFIX = 'analytics';

// Hermetic route contract for the analytics container (US: единообразные пути
// контроллеров). The app declares a global prefix in main.ts and
// prefix-relative controller paths; the generated OpenAPI document must expose
// exactly the full public paths, with no silent route conflicts (fail-fast).
describe('analytics — маршруты и OpenAPI-извлечение', () => {
  let app: INestApplication;

  async function boot(): Promise<INestApplication> {
    const instance = await NestFactory.create(AppModule, { logger: false });
    instance.setGlobalPrefix(GLOBAL_PREFIX);
    await instance.init();
    return instance;
  }

  it('global prefix + естественные пути контроллеров → /analytics и /analytics/kms', async () => {
    app = await boot();
    try {
      const doc = SwaggerModule.createDocument(
        app,
        new DocumentBuilder().setTitle('analytics').setVersion('0').build(),
      );
      const paths = Object.keys(doc.paths).sort();
      expect(paths).toEqual(['/analytics', '/analytics/kms']);
      // fail-fast на конфликте: один path-item = одна операция на метод,
      // без молчаливого перезаписывания дубликатами
      for (const [path, item] of Object.entries(doc.paths)) {
        const methods = Object.keys(item ?? {}).filter((k) =>
          ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'].includes(k),
        );
        expect(new Set(methods).size, `duplicate operations on ${path}`).toBe(methods.length);
      }
    } finally {
      await app.close();
    }
  });

  it('gateway-спека (apps/openapi/openapi.yaml) ссылается только на существующие маршруты analytics', async () => {
    app = await boot();
    try {
      const doc = SwaggerModule.createDocument(
        app,
        new DocumentBuilder().setTitle('analytics').setVersion('0').build(),
      );
      const appPaths = new Set(Object.keys(doc.paths));
      const gateway = parse(readFileSync(join(ROOT, 'apps/openapi/openapi.yaml'), 'utf8')) as {
        paths: Record<string, Record<string, { 'x-yc-apigateway-integration'?: { type?: string } }>>;
      };
      const containerPaths = Object.entries(gateway.paths)
        .filter(([, ops]) =>
          Object.values(ops).some(
            (op) => op['x-yc-apigateway-integration']?.type === 'serverless_containers',
          ),
        )
        .map(([path]) => path);
      expect(containerPaths.length).toBeGreaterThan(0);
      for (const path of containerPaths) {
        expect(appPaths.has(path), `gateway route ${path} is not served by the analytics app`).toBe(true);
      }
    } finally {
      await app.close();
    }
  });
});
