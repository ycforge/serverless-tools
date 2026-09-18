import { Controller, Get, Inject } from '@nestjs/common';
import { RequireAuth } from '@ycforge/nestjs-connector/auth';
import { YandexLogger } from '@ycforge/nestjs-connector/logger';
import { E2eHeaderGuard } from './header.guard';

@Controller('api')
export class AppController {
  constructor(@Inject(YandexLogger) private readonly logger: YandexLogger) {}

  @Get('users')
  listUsers(): { users: string[] } {
    return { users: ['alice', 'bob'] };
  }

  @Get('public')
  publicRoute(): { route: string; marker: string | null } {
    return { route: 'public', marker: process.env.E2E_EXTENSION_MARKER ?? null };
  }

  @Get('auth/jwt')
  authJwt(): { route: string } {
    return { route: 'jwt' };
  }

  @Get('auth/function')
  authFunction(): { route: string } {
    return { route: 'function' };
  }

  @Get('logged')
  logged(): { logged: boolean } {
    this.logger.info('e2e structured log line', { route: 'logged', check: 'trace_id' });
    return { logged: true };
  }

  @Get('guarded')
  @RequireAuth('public', E2eHeaderGuard)
  guarded(): { route: string } {
    return { route: 'guarded' };
  }
}
