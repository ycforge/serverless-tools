import { setInterval as keepAlive } from 'node:timers';

export function buildYcsfOpenApi() {
  keepAlive(() => {}, 60000);
  return new Promise(() => {
    // never settles — an interval above keeps the process alive until the
    // parent kills it; used to exercise the runner timeout kill
  });
}