// spec 022 — blob I/O
import { cp, mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { Artifact } from '../contracts/builder.js';
import { CACHE_BLOB_MISSING, CACHE_WRITE_FAILED } from '../cli/errors.js';

function blobDir(cacheDir: string, effectiveFingerprint: string): string {
  return join(cacheDir, 'blobs', effectiveFingerprint);
}

export async function hasValidBlob(cacheDir: string, effectiveFingerprint: string): Promise<boolean> {
  const dir = blobDir(cacheDir, effectiveFingerprint);
  try {
    await stat(join(dir, 'artifact.json'));
    return true;
  } catch {
    return false;
  }
}

export async function saveBlob(
  cacheDir: string,
  effectiveFingerprint: string,
  artifact: Artifact,
  artifactsAppDir: string,
): Promise<void> {
  const dir = blobDir(cacheDir, effectiveFingerprint);
  try {
    await mkdir(dir, { recursive: true });
    // copy files: artifactsAppDir -> blobs/<fp>/files (if artifactsAppDir exists)
    const filesDest = join(dir, 'files');
    try {
      await cp(artifactsAppDir, filesDest, { recursive: true, force: true });
    } catch {
      // if artifactsAppDir doesn't exist, just ensure files dir
      await mkdir(filesDest, { recursive: true });
    }
    await writeFile(join(dir, 'artifact.json'), JSON.stringify({ type: artifact.type, value: artifact.value }, null, 2), 'utf8');
  } catch {
    // best-effort write; ignore stderr failures
    try { process.stderr.write(`! ${CACHE_WRITE_FAILED}: failed to save blob ${effectiveFingerprint.slice(0, 8)}\n`); } catch {
      // ignore stderr failures
    }
  }
}

export async function restoreBlob(
  cacheDir: string,
  effectiveFingerprint: string,
  artifactsAppDir: string,
): Promise<Artifact | null> {
  const dir = blobDir(cacheDir, effectiveFingerprint);
  try {
    const text = await readFile(join(dir, 'artifact.json'), 'utf8');
    const artifact = JSON.parse(text) as Artifact;
    if (!artifact.type || artifact.value === undefined) throw new Error('invalid artifact');
    // copy files back
    const filesSrc = join(dir, 'files');
    try {
      await mkdir(artifactsAppDir, { recursive: true });
      await cp(filesSrc, artifactsAppDir, { recursive: true, force: true });
    } catch {
      // ignore missing files dir
    }
    return artifact;
  } catch {
    // best-effort warning; ignore stderr failures
    try { process.stderr.write(`! ${CACHE_BLOB_MISSING}: blob missing for ${effectiveFingerprint.slice(0, 8)}\n`); } catch {
      // ignore stderr failures
    }
    return null;
  }
}