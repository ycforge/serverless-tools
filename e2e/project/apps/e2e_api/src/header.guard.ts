import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';

@Injectable()
export class E2eHeaderGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<{ headers: Record<string, unknown> }>();
    const header = request.headers['x-e2e-guard'];
    if (header !== 'ok') {
      throw new ForbiddenException('missing x-e2e-guard header');
    }
    return true;
  }
}
