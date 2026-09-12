export function buildYcsfOpenApi() {
  return new Promise(() => {
    // keep the event loop alive: a bare pending promise would let node exit.
    const interval = setInterval(() => {}, 1000);
    void interval;
  });
}