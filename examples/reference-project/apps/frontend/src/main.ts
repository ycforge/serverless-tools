const app = document.querySelector<HTMLDivElement>('#app');

if (app !== null) {
  const banner = document.createElement('div');
  banner.dataset.banner = import.meta.env.VITE_ENV ?? 'unknown';
  banner.dataset.apiBase = import.meta.env.VITE_API_BASE ?? '';
  banner.textContent = import.meta.env.VITE_ENV ?? 'reference frontend';
  app.appendChild(banner);
}