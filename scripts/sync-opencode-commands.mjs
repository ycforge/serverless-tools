#!/usr/bin/env node
/**
 * Generates opencode custom commands (.opencode/commands/speckit-*.md)
 * from the spec-kit skills installed under .kimi-code/skills/.
 *
 * Source of truth: .kimi-code/skills/<name>/SKILL.md (spec-kit integration
 * "kimi"). The skill frontmatter is replaced with an opencode command
 * frontmatter (description only); the body is copied verbatim except that
 * Kimi-style skill invocations `/skill:speckit-x` are rewritten to opencode
 * command invocations `/speckit-x`.
 *
 * Usage: node scripts/sync-opencode-commands.mjs
 */
import { readdirSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const SKILLS_DIR = ".kimi-code/skills";
const OUT_DIR = ".opencode/commands";

const parseFrontmatter = (text) => {
  const match = text.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) return { attrs: {}, body: text };
  const attrs = {};
  for (const line of match[1].split("\n")) {
    const kv = line.match(/^(\w+):\s*"?([^"]*)"?\s*$/);
    if (kv) attrs[kv[1]] = kv[2];
  }
  return { attrs, body: match[2] };
};

mkdirSync(OUT_DIR, { recursive: true });

const skills = readdirSync(SKILLS_DIR, { withFileTypes: true })
  .filter((d) => d.isDirectory() && d.name.startsWith("speckit-"))
  .map((d) => d.name)
  .sort();

for (const name of skills) {
  const raw = readFileSync(join(SKILLS_DIR, name, "SKILL.md"), "utf8");
  const { attrs, body } = parseFrontmatter(raw);
  const out = `---
description: ${JSON.stringify(attrs.description ?? name)}
---
${body.replaceAll("/skill:speckit-", "/speckit-")}`;
  writeFileSync(join(OUT_DIR, `${name}.md`), out);
  console.log(`synced ${name}`);
}

console.log(`\n${skills.length} opencode commands written to ${OUT_DIR}/`);
