import { Controller, Get, Logger } from '@nestjs/common';

@Controller('api')
export class LogsController {
  private readonly logger = new Logger('E2eLogsProbe');

  @Get('logs')
  logs(): { logged: number } {
    this.logger.verbose('e2e-nestjs-level-verbose');
    this.logger.debug('e2e-nestjs-level-debug');
    this.logger.log('e2e-nestjs-level-info');
    this.logger.warn('e2e-nestjs-level-warn');
    this.logger.error('e2e-nestjs-level-error');
    this.logger.fatal('e2e-nestjs-level-fatal');
    return { logged: 6 };
  }
}
