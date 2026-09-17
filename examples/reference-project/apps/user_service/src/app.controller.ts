import { Controller, Get } from '@nestjs/common';

@Controller('users')
export class AppController {
  @Get()
  listUsers(): { users: string[] } {
    return { users: ['alice', 'bob'] };
  }
}