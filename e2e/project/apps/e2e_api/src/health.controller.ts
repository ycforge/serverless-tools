import { Controller, Get } from '@nestjs/common';

@Controller()
export class HealthController {
  @Get('_health')
  health(): { status: string } {
    return { status: 'ok' };
  }
}
