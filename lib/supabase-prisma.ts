// =====================================================================
// SUPABASE-PRISMA UTILITIES
// Core utilities for the Supabase → Prisma compatibility layer.
// Provides key-case conversion, table→model mapping, and PostgREST
// select-string parsing.
// =====================================================================

// ─────────────────────────────────────────────────────────────────────
// CASE CONVERSION
// ─────────────────────────────────────────────────────────────────────

/**
 * Convert a single identifier from camelCase to snake_case.
 */
export function camelToSnake(str: string): string {
  return str.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

/**
 * Convert a single identifier from snake_case to camelCase.
 */
export function snakeToCamel(str: string): string {
  return str.replace(/_([a-z])/g, (_: string, letter: string) => letter.toUpperCase());
}

/**
 * Recursively convert all keys in an object from camelCase to snake_case.
 * Handles nested objects, arrays, Dates, and nulls.
 */
export function toSnakeCaseDeep(obj: any): any {
  if (obj === null || obj === undefined) return obj;
  if (obj instanceof Date) return obj.toISOString();
  if (Array.isArray(obj)) return obj.map(toSnakeCaseDeep);
  if (typeof obj !== 'object') return obj;

  const result: Record<string, any> = {};
  for (const [key, value] of Object.entries(obj)) {
    const snakeKey = camelToSnake(key);
    result[snakeKey] = toSnakeCaseDeep(value);
  }
  return result;
}

/**
 * Recursively convert all keys in an object from snake_case to camelCase.
 * Handles nested objects, arrays, Dates, and nulls.
 */
export function toCamelCaseDeep(obj: any): any {
  if (obj === null || obj === undefined) return obj;
  if (obj instanceof Date) return obj;
  if (Array.isArray(obj)) return obj.map(toCamelCaseDeep);
  if (typeof obj !== 'object') return obj;

  const result: Record<string, any> = {};
  for (const [key, value] of Object.entries(obj)) {
    const camelKey = snakeToCamel(key);
    result[camelKey] = toCamelCaseDeep(value);
  }
  return result;
}

/**
 * Convert Prisma results back to snake_case for Supabase compatibility.
 * This is critical: existing code calls `toCamelCase(data)` on results,
 * so we must return snake_case so that their `toCamelCase` produces camelCase.
 */
export function prismaToSnakeCase(data: any): any {
  if (data === null || data === undefined) return data;
  if (data instanceof Date) return data.toISOString();
  if (Array.isArray(data)) return data.map(prismaToSnakeCase);
  if (typeof data !== 'object') return data;

  const result: Record<string, any> = {};
  for (const [key, value] of Object.entries(data)) {
    const snakeKey = camelToSnake(key);
    // Convert nested relation objects too
    if (value !== null && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date)) {
      result[snakeKey] = prismaToSnakeCase(value);
    } else if (Array.isArray(value)) {
      result[snakeKey] = prismaToSnakeCase(value);
    } else if (value instanceof Date) {
      result[snakeKey] = value.toISOString();
    } else {
      result[snakeKey] = value;
    }
  }
  return result;
}

// ─────────────────────────────────────────────────────────────────────
// TABLE → MODEL MAPPING
// ─────────────────────────────────────────────────────────────────────

/**
 * Convert a database table name (snake_case) to the Prisma model name (PascalCase).
 * e.g., 'cash_boxes' → 'CashBox', 'transaction_items' → 'TransactionItem'
 */
export function snakeToModelName(table: string): string {
  return table
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
}

/**
 * Convert a Prisma model name (PascalCase) to the database table name (snake_case).
 * e.g., 'CashBox' → 'cash_boxes', 'TransactionItem' → 'transaction_items'
 */
export function modelNameToSnake(modelName: string): string {
  return modelName
    .replace(/([a-z])([A-Z])/g, '$1_$2')
    .toLowerCase();
}

// ─────────────────────────────────────────────────────────────────────
// POSTGREST SELECT PARSER
// ─────────────────────────────────────────────────────────────────────

/**
 * Parse a PostgREST select string into a Prisma-compatible structure.
 *
 * Handles:
 *   - `'*'` → all fields (no specific select needed)
 *   - `'id, name, email'` → specific field selection
 *   - `'*, relation:table(*)'` → include a relation
 *   - `'*, relation:table!fkey(*)'` → include with explicit FK hint
 *   - `'*, items:table(*, nested:table2(field1, field2))'` → nested includes
 *
 * Returns: { type: 'all' } | { type: 'fields', fields: string[] } | { type: 'include', include: PrismaInclude, select?: string[] }
 */
export function parseSelectToInclude(
  selectStr: string
): { type: 'all' } | { type: 'fields'; fields: string[] } | { type: 'include'; include: Record<string, any>; select?: string[] } {
  if (!selectStr || selectStr.trim() === '*' || selectStr.trim() === '') {
    return { type: 'all' };
  }

  // Parse the top-level select string
  const segments = splitTopLevel(selectStr);
  const includes: Record<string, any> = {};
  const fields: string[] = [];

  for (const segment of segments) {
    const trimmed = segment.trim();
    if (trimmed === '*') {
      // wildcard for own fields — don't add to explicit fields list
      continue;
    }

    // Check for alias:relation(...) pattern
    const aliasMatch = trimmed.match(/^([\s\S]+):([\w]+)(?:!([\w]+))?\(([\s\S]+)\)$/);
    if (aliasMatch) {
      const [, alias, table, _fkey, innerSelect] = aliasMatch;
      const parsed = parseSelectToInclude(innerSelect);
      const modelName = snakeToModelName(table);

      const camelAlias = snakeToCamel(alias);
      if (parsed.type === 'all') {
        includes[camelAlias] = true;
      } else if (parsed.type === 'fields') {
        includes[camelAlias] = { select: parsed.fields.reduce((acc, f) => { acc[snakeToCamel(f)] = true; return acc; }, {} as Record<string, boolean>) };
      } else if (parsed.type === 'include') {
        const obj: any = {};
        if (parsed.select && parsed.select.length > 0) {
          obj.select = parsed.select.reduce((acc, f) => { acc[snakeToCamel(f)] = true; return acc; }, {} as Record<string, boolean>);
        }
        if (Object.keys(parsed.include).length > 0) {
          if (obj.select) {
            // Merge includes into select
            for (const [k, v] of Object.entries(parsed.include)) {
              obj.select[k] = v;
            }
          } else {
            obj.include = parsed.include;
          }
        }
        // If there are both select fields and includes, we need select: { ...fields, ...includes }
        if (!obj.select && Object.keys(parsed.include).length > 0) {
          obj.include = parsed.include;
        }
        includes[camelAlias] = Object.keys(obj).length > 0 ? obj : true;
      }
      continue;
    }

    // Simple field name (no parentheses)
    if (!trimmed.includes('(') && !trimmed.includes(':')) {
      fields.push(trimmed);
    }
  }

  // If we only have fields and no includes, return field selection
  if (Object.keys(includes).length === 0 && fields.length > 0) {
    return { type: 'fields', fields };
  }

  // If we have includes, return include structure
  if (Object.keys(includes).length > 0) {
    const result: { type: 'include'; include: Record<string, any>; select?: string[] } = {
      type: 'include',
      include: includes,
    };
    if (fields.length > 0) {
      result.select = fields;
    }
    return result;
  }

  // Only '*' was found
  return { type: 'all' };
}

/**
 * Split a PostgREST select string by commas, respecting nested parentheses.
 * e.g., "*, items:transaction_items(*, product:products(unit))"
 *   → ['*', 'items:transaction_items(*, product:products(unit))']
 */
function splitTopLevel(str: string): string[] {
  const result: string[] = [];
  let depth = 0;
  let current = '';

  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    if (ch === '(') {
      depth++;
      current += ch;
    } else if (ch === ')') {
      depth--;
      current += ch;
    } else if (ch === ',' && depth === 0) {
      result.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim()) {
    result.push(current.trim());
  }
  return result;
}

// ─────────────────────────────────────────────────────────────────────
// POSTGREST .or() PARSER
// ─────────────────────────────────────────────────────────────────────

interface OrClause {
  field: string;
  operator: string;
  value: any;
}

/**
 * Parse a PostgREST `.or()` filter string into individual clauses.
 *
 * Supports:
 *   - 'status.eq.active,total.gt.0'
 *   - 'and(status.eq.active,last_transaction_date.is.null)'
 *   - 'status.eq.active,status.eq.pending'
 *
 * Returns an array of OR clause groups (each group is an array of AND clauses).
 */
export function parseOrFilter(orString: string): OrClause[][] {
  // Split by comma (top-level only, not inside parentheses)
  const segments = splitTopLevel(orString);
  const groups: OrClause[][] = [];

  for (const segment of segments) {
    const trimmed = segment.trim();

    // Handle `and(...)` groups
    if (trimmed.startsWith('and(') && trimmed.endsWith(')')) {
      const inner = trimmed.slice(4, -1);
      const innerSegments = splitTopLevel(inner);
      const andGroup: OrClause[] = [];
      for (const innerSeg of innerSegments) {
        const clause = parseSingleOrClause(innerSeg.trim());
        if (clause) andGroup.push(clause);
      }
      if (andGroup.length > 0) groups.push(andGroup);
      continue;
    }

    const clause = parseSingleOrClause(trimmed);
    if (clause) groups.push([clause]);
  }

  return groups;
}

/**
 * Parse a single PostgREST filter clause like 'status.eq.active' or 'total.gt.0'
 */
function parseSingleOrClause(clause: string): OrClause | null {
  const parts = clause.split('.');
  if (parts.length < 3) return null;

  const field = parts[0];
  const operator = parts[1];
  const value = parts.slice(2).join('.');

  return { field: snakeToCamel(field), operator, value };
}

// ─────────────────────────────────────────────────────────────────────
// ERROR TYPE
// ─────────────────────────────────────────────────────────────────────

export interface PostgrestError {
  message: string;
  code: string;
}

/**
 * Create a PostgrestError-like object from an error.
 */
export function toPostgrestError(error: unknown): PostgrestError {
  if (error && typeof error === 'object' && 'message' in error && 'code' in error) {
    return error as PostgrestError;
  }
  if (error instanceof Error) {
    // Map Prisma error codes to PostgREST-like codes
    const msg = error.message;
    let code = 'PGRST116'; // generic error

    if (msg.includes('Unique constraint') || msg.includes('unique constraint')) {
      code = '23505';
    } else if (msg.includes('Record to update not found') || msg.includes('Record to delete not found')) {
      code = 'PGRST116';
    } else if (msg.includes('Foreign key constraint')) {
      code = '23503';
    } else if (msg.includes('Not enough')) {
      code = 'PGRST116';
    }

    return { message: msg, code };
  }
  return { message: String(error), code: 'UNKNOWN' };
}

// ─────────────────────────────────────────────────────────────────────
// POSTGREST RESULT FORMAT
// ─────────────────────────────────────────────────────────────────────

export interface PostgrestResult<T = any> {
  data: T | null;
  error: PostgrestError | null;
  count?: number;
  status?: number;
  statusText?: string;
}

/**
 * Create a successful PostgrestResult.
 */
export function successResult<T>(data: T, count?: number): PostgrestResult<T> {
  const result: PostgrestResult<T> = { data, error: null };
  if (count !== undefined) result.count = count;
  return result;
}

/**
 * Create an error PostgrestResult.
 */
export function errorResult(error: unknown, status = 400): PostgrestResult<null> {
  return {
    data: null,
    error: toPostgrestError(error),
    status,
    statusText: 'Bad Request',
  };
}
