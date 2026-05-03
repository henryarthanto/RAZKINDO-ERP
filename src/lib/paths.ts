// =====================================================================
// PATH RESOLVER — Resolves file paths correctly in both development
// and standalone production mode.
//
// In development: process.cwd() → /home/z/my-project (project root)
// In standalone:  process.cwd() → /path/to/.next/standalone
//
// This module searches multiple candidate paths to find files that
// may be located relative to the project root rather than the
// standalone server directory.
// =====================================================================

import { join, resolve } from 'path';
import { existsSync } from 'fs';

/**
 * Resolve a path relative to the project root.
 * In standalone mode, the project root may be different from process.cwd().
 *
 * Search order:
 *   1. process.cwd() + relPath (development mode)
 *   2. process.cwd() + '..' + relPath (standalone mode: cwd/.next/standalone → cwd)
 *   3. process.cwd() + '../..' + relPath (deeper standalone nesting)
 *
 * Returns the first path that exists, or the default (process.cwd() + relPath)
 * if no candidate exists.
 */
export function resolveProjectPath(relPath: string): string {
  const candidates = [
    join(process.cwd(), relPath),
    join(process.cwd(), '..', relPath),
    join(process.cwd(), '..', '..', relPath),
  ];

  for (const candidate of candidates) {
    try {
      if (existsSync(candidate)) {
        return resolve(candidate);
      }
    } catch {
      // Ignore errors, try next
    }
  }

  // Return default even if it doesn't exist (caller will handle the error)
  return resolve(join(process.cwd(), relPath));
}

/**
 * Get the public/uploads directory path.
 * In standalone mode, the public directory may need to be created
 * or may be located outside the standalone directory.
 */
export function getUploadDir(subDir?: string): string {
  const relPath = subDir
    ? join('public', 'uploads', subDir)
    : join('public', 'uploads');
  return resolveProjectPath(relPath);
}

/**
 * Get a file path in the project root (e.g., SQL migration files).
 */
export function getProjectFile(filename: string): string {
  return resolveProjectPath(filename);
}
