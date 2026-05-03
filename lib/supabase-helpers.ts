// =====================================================================
// SUPABASE HELPERS - Common utilities for API routes
// =====================================================================

/**
 * Convert camelCase to snake_case
 */
export function camelToSnake(str: string): string {
  return str.replace(/([A-Z])/g, (letter, index) =>
    index === 0 ? letter.toLowerCase() : `_${letter.toLowerCase()}`
  );
}

/**
 * Convert snake_case to camelCase
 */
export function snakeToCamel(str: string): string {
  return str.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
}

/**
 * Convert all keys in an object from snake_case to camelCase
 * Recursively handles nested objects and arrays
 *
 * Returns null when input is null (instead of empty object).
 * For non-null input, returns the camelCase-mapped object.
 */
export function toCamelCase<T = Record<string, any>>(row: Record<string, any>): T;
export function toCamelCase<T = Record<string, any>>(row: Record<string, any> | null): T | null;
export function toCamelCase<T = Record<string, any>>(row: Record<string, any> | null): T | null {
  if (!row) return null;
  const result: Record<string, any> = {};
  for (const [key, value] of Object.entries(row)) {
    const camelKey = snakeToCamel(key);
    if (value !== null && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date)) {
      result[camelKey] = toCamelCase(value);
    } else if (Array.isArray(value)) {
      result[camelKey] = value.map(item =>
        item !== null && typeof item === 'object' ? toCamelCase(item) : item
      );
    } else {
      result[camelKey] = value;
    }
  }
  return result as T;
}

/**
 * Convert all keys in an object from camelCase to snake_case
 * Recursively handles nested objects and arrays
 */
export function toSnakeCase(obj: Record<string, any>): Record<string, any> {
  if (!obj) return obj as any;
  const result: Record<string, any> = {};
  for (const [key, value] of Object.entries(obj)) {
    const snakeKey = camelToSnake(key);
    if (value !== null && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date)) {
      result[snakeKey] = toSnakeCase(value);
    } else if (Array.isArray(value)) {
      result[snakeKey] = value.map(item =>
        item !== null && typeof item === 'object' ? toSnakeCase(item) : item
      );
    } else {
      result[snakeKey] = value;
    }
  }
  return result;
}

/**
 * Convert an array of rows from snake_case to camelCase
 */
export function rowsToCamelCase<T = Record<string, any>>(rows: Record<string, any>[]): T[] {
  return rows.map(row => toCamelCase(row)) as T[];
}

/**
 * Map Prisma-style camelCase select to Supabase comma-separated string
 */
export function mapSelect(select: Record<string, boolean>): string {
  return Object.keys(select)
    .filter((key) => select[key])
    .map(camelToSnake)
    .join(', ');
}

/**
 * Generate a CUID-like ID (for compatibility with existing data)
 */
export function generateId(): string {
  // Use crypto.randomUUID() which is available in Node.js 19+
  return crypto.randomUUID();
}

/**
 * Generate a short, URL-safe customer code for member links (e.g., /c/ABC123).
 * 6 characters: uppercase alphanumeric (A-Z, 0-9) = 36^6 = ~2.2 billion combos.
 * Excludes ambiguous chars (O/0, I/1) for readability.
 */
export function generateCustomerCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 30 chars, no O/0/I/1
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return Array.from(bytes, b => chars[b % chars.length]).join('');
}

/**
 * Helper to create a log entry (fire-and-forget)
 */
export async function createLog(
  db: any,
  data: {
    type: string;
    userId?: string;
    action: string;
    entity?: string;
    entityId?: string;
    payload?: any;
    message?: string;
  }
) {
  try {
    await db.from('logs').insert({
      id: generateId(),
      type: data.type,
      user_id: data.userId || null,
      action: data.action,
      entity: data.entity || null,
      entity_id: data.entityId || null,
      payload: data.payload ? (typeof data.payload === 'string' ? data.payload : JSON.stringify(data.payload)) : null,
      message: data.message || null,
      created_at: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[Log] Failed to create log:', err);
  }
}

/**
 * Helper to create an event entry (fire-and-forget)
 */
export async function createEvent(
  db: any,
  type: string,
  payload: any
) {
  try {
    await db.from('events').insert({
      id: generateId(),
      type,
      is_read: false,
      created_at: new Date().toISOString(),
      payload: typeof payload === 'string' ? payload : JSON.stringify(payload),
    });
  } catch (err) {
    console.error('[Event] Failed to create event:', err);
  }
}

/**
 * Build Supabase filter from a Prisma-style where clause
 * Supports: eq, neq, gt, gte, lt, lte, in, contains, ilike
 */
export function buildFilters(query: any, where: Record<string, any>): any {
  for (const [key, value] of Object.entries(where)) {
    const snakeKey = camelToSnake(key);
    
    if (value === undefined || value === null) continue;
    
    if (typeof value === 'object' && !Array.isArray(value)) {
      // Handle operators like { gte: date, lte: date }
      if (value.gte !== undefined) {
        query = query.gte(snakeKey, value.gte instanceof Date ? value.gte.toISOString() : value.gte);
      }
      if (value.gt !== undefined) {
        query = query.gt(snakeKey, value.gt instanceof Date ? value.gt.toISOString() : value.gt);
      }
      if (value.lte !== undefined) {
        query = query.lte(snakeKey, value.lte instanceof Date ? value.lte.toISOString() : value.lte);
      }
      if (value.lt !== undefined) {
        query = query.lt(snakeKey, value.lt instanceof Date ? value.lt.toISOString() : value.lt);
      }
      if (value.in !== undefined) {
        query = query.in(snakeKey, value.in);
      }
      if (value.contains !== undefined) {
        query = query.ilike(snakeKey, `%${value.contains}%`);
      }
    } else {
      query = query.eq(snakeKey, value);
    }
  }
  return query;
}

/**
 * Generate invoice number
 */
export function generateInvoiceNo(type: string, count: number): string {
  const now = new Date();
  const prefix = type === 'sale' ? 'INV' : type === 'purchase' ? 'PO' : type === 'expense' ? 'EXP' : 'TRX';
  const month = String(now.getMonth() + 1).padStart(2, '0');
  return `${prefix}-${now.getFullYear()}${month}${String(count + 1).padStart(4, '0')}`;
}
