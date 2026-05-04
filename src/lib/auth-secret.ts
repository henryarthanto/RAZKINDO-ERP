// Centralized AUTH_SECRET - used by all token generation and verification
//
// IMPORTANT FOR STANDALONE MODE:
//   In standalone mode, process.cwd() points to the standalone directory,
//   NOT the original project root. The `db/` directory might not exist there.
//   This module handles that gracefully:
//   1. Check AUTH_SECRET env var first (recommended for production)
//   2. Try to read db/.auth-secret file (relative to cwd)
//   3. Try to read from the parent directory (standalone mode layout)
//   4. Generate crypto-random in-memory as last resort
//
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, resolve } from 'path';
import crypto from 'crypto';

// Cache the resolved secret for this process lifetime
let _cachedSecret: string | null = null;

/**
 * Search for the auth secret file in multiple locations.
 * In standalone mode, the app structure might be:
 *   /DATA/AppData/razkindo2-erp/.next/standalone/server.js  (cwd = standalone dir)
 *   /DATA/AppData/razkindo2-erp/.env                         (env file location)
 *   /DATA/AppData/razkindo2-erp/db/.auth-secret              (secret file location)
 */
function findSecretFile(): string | null {
  const candidates = [
    join(process.cwd(), 'db', '.auth-secret'),           // Normal: cwd/db/.auth-secret
    join(process.cwd(), '..', 'db', '.auth-secret'),     // Standalone: cwd/../db/.auth-secret
    join(process.cwd(), '..', '..', 'db', '.auth-secret'), // Deep standalone
    resolve('/DATA/AppData/razkindo2-erp/db/.auth-secret'), // STB known path
  ];

  for (const filePath of candidates) {
    try {
      if (existsSync(filePath)) {
        const stored = readFileSync(filePath, 'utf-8').trim();
        if (stored.length >= 16) {
          console.log(`[Auth] Found secret file at: ${filePath}`);
          return stored;
        }
      }
    } catch {
      // Ignore read errors, try next candidate
    }
  }
  return null;
}

/**
 * Try to persist the secret to the first writable location.
 */
function persistSecret(secret: string): void {
  const candidates = [
    join(process.cwd(), 'db'),
    join(process.cwd(), '..', 'db'),
    join(process.cwd(), '..', '..', 'db'),
  ];

  for (const dir of candidates) {
    try {
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
      const filePath = join(dir, '.auth-secret');
      writeFileSync(filePath, secret, 'utf-8');
      console.log(`[Auth] Persisted secret to: ${filePath}`);
      return;
    } catch {
      // Try next candidate
    }
  }
  console.warn('[Auth] Could not persist auth secret to any file location. Secret is valid for this process only.');
}

/**
 * Get or create a persistent fallback secret.
 * This ensures the secret stays consistent across:
 * - Hot module reloads (Next.js dev mode)
 * - Server restarts
 * - Multiple concurrent requests
 * 
 * Without AUTH_SECRET env var, the file-based secret is used.
 * For production, always set AUTH_SECRET env var.
 */
function getOrCreateFallbackSecret(): string {
  // 1. Try to find existing secret file
  const existing = findSecretFile();
  if (existing) return existing;

  // 2. Generate a strong random secret
  const secret = crypto.randomBytes(32).toString('hex');
  
  // 3. Try to persist it
  persistSecret(secret);
  
  return secret;
}

export function getAuthSecret(): string {
  if (_cachedSecret) return _cachedSecret;

  const AUTH_SECRET = process.env.AUTH_SECRET;

  if (!AUTH_SECRET) {
    console.warn('[Auth] AUTH_SECRET env var not set. Using file-based fallback secret. Set AUTH_SECRET for production stability.');
  }

  _cachedSecret = AUTH_SECRET || getOrCreateFallbackSecret();
  return _cachedSecret;
}
