import 'reflect-metadata';
import { Controller, Get, Header, HttpCode, Module, Res } from '@nestjs/common';

const PNG_BYTES = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01, 0x02, 0x03, 0xff,
]);

// YandexHttpResponseFacade is deliberately not part of the public connector API
// (spec A-13: raw context is emulated rather than surface-injected), so the US4
// fixtures type the @Res() handle structurally through its supported calls.
interface ResponseHandle {
  appendHeader(name: string, value: string): unknown;
}

@Controller()
export class AppController {
  @Get('/api/users')
  users(): object {
    return { users: [] };
  }

  @Get('/respond/error')
  boom(): never {
    throw new Error('boom');
  }

  @Get('/respond/201')
  @HttpCode(201)
  @Header('X-Custom', 'v')
  created(): object {
    return { ok: true };
  }

  @Get('/respond/multicookie')
  multicookie(@Res({ passthrough: true }) res: ResponseHandle): object {
    res.appendHeader('Set-Cookie', 'a=1');
    res.appendHeader('Set-Cookie', 'b=2');
    return { ok: true };
  }

  @Get('/respond/binary')
  binary(): Buffer {
    return PNG_BYTES;
  }

  @Get('/slow')
  async slow(): Promise<object> {
    await new Promise((resolve) => setTimeout(resolve, 300));
    return { ok: true };
  }
}

@Module({ controllers: [AppController] })
export class AppModule {}