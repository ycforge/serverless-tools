import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = resolve(ROOT, '../..');
const SPECS = join(REPO, 'specs');

const NON_CANONICAL = ['orders', 'test-app', 'sample_app', 'app-1', 'app_1', 'frontend_service'];
// Неканонические примеры определяются намеренно в backtick-контексте: plain-слово
// "orders" (англ. "порядки"), встречающееся в research-документах, — не пример приложения.
const NON_CANONICAL_RE = new RegExp('`(?:' + NON_CANONICAL.join('|') + ')`');

function docsMarkdown(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...docsMarkdown(p));
    else if (e.name.endsWith('.md')) out.push(p);
  }
  return out;
}

describe('docs-lint', () => {
  it('reference README использует только канонические имена приложений', () => {
    const readme = readFileSync(join(ROOT, 'README.md'), 'utf8');
    expect(readme).not.toMatch(NON_CANONICAL_RE);
    const canonical = ['user_service', 'analytics', 'frontend', 'openapi'];
    for (const app of canonical) {
      expect(readme).toContain(`\`${app}\``);
    }
  });

  it('specs (кроме нарратива 024 о прошлом имени) не содержат неканонических примеров', () => {
    for (const file of docsMarkdown(SPECS)) {
      if (file.includes('/024-e2e-reference/')) continue;
      const text = readFileSync(file, 'utf8');
      expect(text, `${file}`).not.toMatch(NON_CANONICAL_RE);
    }
  });

  it('README актуален: resources.yaml отсутствует, auth none-scheme, известные D-дефекты', () => {
    const readme = readFileSync(join(ROOT, 'README.md'), 'utf8');
    expect(readme).toMatch(/\.ycsf\/resources\.yaml`?\s*в эталоне\s*\*\*отсутствует\*\*/);
    expect(readme).not.toMatch(/^- `resources\.yaml`/m);
    expect(readme).toContain('defaultScheme');
    // D7/D9 — действующие ограничения; D10/D12 сняты (registry-ref, provider-форма)
    // и в README не упоминаются.
    for (const marker of ['D7', 'D9', 'PML_IDENTITY_COLLISION', 'BRG_PACKAGE_NOT_FOUND']) {
      expect(readme).toContain(marker);
    }
    for (const fixed of ['D10', 'D12']) {
      expect(readme).not.toContain(fixed);
    }
  });
});