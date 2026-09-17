const env = import.meta.env;
const app = document.querySelector('#app');

if (app) {
  app.setAttribute('data-env', String(env.VITE_ENV));
  app.setAttribute('data-api-base', String(env.VITE_API_BASE));
  app.setAttribute('data-run-id', String(env.VITE_RUN_ID));
  app.setAttribute('data-null-resolved', String(env.VITE_NULL_RESOLVED));
  app.textContent = `e2e-web env=${env.VITE_ENV} run=${env.VITE_RUN_ID} null=${env.VITE_NULL_RESOLVED}`;
}
