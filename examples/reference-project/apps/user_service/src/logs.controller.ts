import { BadRequestException, Controller, Get, Logger, Query } from '@nestjs/common';

/**
 * Manual logging probe (spec 037 extension).
 *
 * Emits NestJS log records at a level chosen by the caller so the structured
 * connector logger can be verified by hand in Cloud Logging:
 *
 *   GET /users/logs?level=warn&message=hello%20cloud&count=3
 *   GET /users/logs?level=all&count=1
 *
 * Every emitted line carries the resolved Cloud Logging severity in the
 * `level` field (the connector maps Nest `verbose→TRACE … fatal→FATAL`) plus
 * the invocation `trace_id`/`awsRequestId`, so the probe doubles as a way to
 * correlate a manual request with its log stream.
 */
const LOG_LEVELS = ['verbose', 'debug', 'log', 'info', 'warn', 'error', 'fatal'] as const;
type ProbeLevel = (typeof LOG_LEVELS)[number];

const DEFAULT_CONTEXT = 'users-manual-probe';
const DEFAULT_MESSAGE = 'manual log probe';
const MAX_COUNT = 100;

@Controller('users/logs')
export class LogsController {
  private readonly logger = new Logger(DEFAULT_CONTEXT);

  @Get()
  emit(
    @Query('level') level = 'log',
    @Query('message') message = DEFAULT_MESSAGE,
    @Query('count') count?: string,
    @Query('context') context?: string,
  ): { emitted: number; level: string; message: string } {
    const requested = level.toLowerCase();
    const emitAll = requested === 'all';
    if (!emitAll && !LOG_LEVELS.includes(requested as ProbeLevel)) {
      throw new BadRequestException(
        `unknown level '${level}'; use one of ${[...LOG_LEVELS, 'all'].join(', ')}`,
      );
    }

    const times = count === undefined ? 1 : Number.parseInt(count, 10);
    if (!Number.isInteger(times) || times < 1 || times > MAX_COUNT) {
      throw new BadRequestException(`count must be an integer between 1 and ${MAX_COUNT}`);
    }

    const text = message === '' ? DEFAULT_MESSAGE : message;
    const ctx = context === undefined || context === '' ? DEFAULT_CONTEXT : context;

    if (emitAll) {
      for (const each of LOG_LEVELS) {
        for (let seq = 1; seq <= times; seq += 1) {
          this.write(each, text, ctx, seq, times);
        }
      }
      return { emitted: LOG_LEVELS.length * times, level: 'all', message: text };
    }

    for (let seq = 1; seq <= times; seq += 1) {
      this.write(requested as ProbeLevel, text, ctx, seq, times);
    }
    return { emitted: times, level: requested.toUpperCase(), message: text };
  }

  private write(level: ProbeLevel, text: string, context: string, seq: number, total: number): void {
    const line = `${text} [level=${level.toUpperCase()} seq=${seq}/${total}]`;
    switch (level) {
      case 'verbose':
        this.logger.verbose(line, context);
        break;
      case 'debug':
        this.logger.debug(line, context);
        break;
      case 'log':
      case 'info':
        this.logger.log(line, context);
        break;
      case 'warn':
        this.logger.warn(line, context);
        break;
      case 'error':
        this.logger.error(line, context);
        break;
      case 'fatal':
        this.logger.fatal(line, context);
        break;
    }
  }
}
