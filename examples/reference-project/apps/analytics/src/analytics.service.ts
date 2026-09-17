import { Injectable } from '@nestjs/common';

@Injectable()
export class AnalyticsService {
  health() {
    return { service: 'analytics', uptime: process.uptime() };
  }
}