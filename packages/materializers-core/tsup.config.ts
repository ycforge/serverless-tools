import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'yandex-function/index': 'src/yandex-function/index.ts',
    'yandex-serverless-container/index': 'src/yandex-serverless-container/index.ts',
    'yandex-api-gateway/index': 'src/yandex-api-gateway/index.ts',
    'yandex-message-queue/index': 'src/yandex-message-queue/index.ts',
    'yandex-storage-bucket/index': 'src/yandex-storage-bucket/index.ts',
  },
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  sourcemap: true,
  minify: false,
});