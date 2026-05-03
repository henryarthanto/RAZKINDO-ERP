// =====================================================================
// ZOD VALIDATION SCHEMAS — Centralized request validation for API routes
//
// Uses Zod v4 syntax. Import with:
//   import { authSchemas, transactionSchemas, validateBody } from '@/lib/validators';
//
// Usage in API route:
//   const validation = validateBody(authSchemas.login, body);
//   if (!validation.success) return NextResponse.json({ error: validation.error }, { status: 400 });
//   const { email, password } = validation.data;
// =====================================================================

import { z } from 'zod';

// =====================================================================
// INPUT SANITIZATION HELPERS
// =====================================================================

/** Sanitize free-text input: trim + remove null bytes and control characters */
const sanitizedString = (maxLen = 1000) =>
  z.string()
    .max(maxLen, `Maksimal ${maxLen} karakter`)
    .transform(s => s.trim())
    .transform(s => s.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, ''));

const sanitizedStringOptional = (maxLen = 1000) =>
  z.string()
    .max(maxLen, `Maksimal ${maxLen} karakter`)
    .nullable()
    .optional()
    .transform(v => v ? v.trim() : v)
    .transform(v => v ? v.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '') : v);

// =====================================================================
// AUTH SCHEMAS
// =====================================================================

export const authSchemas = {
  /** POST /api/auth/login */
  login: z.object({
    email: z.string().email('Format email tidak valid'),
    password: z.string().min(6, 'Password minimal 6 karakter'),
  }),

  /** POST /api/auth/register */
  register: z.object({
    name: sanitizedString(100),
    email: z.string().email('Format email tidak valid'),
    phone: z.string().optional(),
    password: z.string().min(6, 'Password minimal 6 karakter'),
    role: z.enum(['super_admin', 'sales', 'kurir', 'keuangan', 'admin', 'manager', 'gudang', 'ob', 'sopir'], {
      error: 'Role tidak valid',
    }).or(z.string().min(1).max(50)), // Custom roles accepted but NOT super_admin bypass
    unitId: z.string().optional().transform(v => (!v || v.trim() === '') ? undefined : v),
    unitIds: z.array(z.string()).optional().transform(v => (Array.isArray(v) ? v.filter(s => s && s.trim()) : undefined)),
    customRoleId: z.string().optional().transform(v => (!v || v.trim() === '') ? undefined : v),
  }),

  /** POST /api/auth/register — non-ERP employee */
  registerNonErp: z.object({
    name: z.string().min(1, 'Nama wajib diisi'),
    phone: z.string().optional(),
    customRoleId: z.string().min(1, 'Custom role diperlukan'),
    unitId: z.string().optional(),
    unitIds: z.array(z.string()).optional(),
  }),

  /** POST /api/auth/change-password */
  changePassword: z.object({
    currentPassword: z.string().min(1, 'Password lama diperlukan'),
    newPassword: z.string().min(6, 'Password baru minimal 6 karakter'),
  }),

  /** POST /api/auth/forgot-password */
  forgotPassword: z.object({
    phone: z.string().min(1, 'Nomor telepon diperlukan'),
  }),

  /** POST /api/auth/reset-password */
  resetPassword: z.object({
    phone: z.string().min(1, 'Nomor telepon diperlukan'),
    code: z.string().min(1, 'Kode pemulihan diperlukan'),
    newPassword: z.string().min(6, 'Password minimal 6 karakter'),
  }),
} as const;

// =====================================================================
// TRANSACTION SCHEMAS
// =====================================================================

/** Valid transaction types */
const transactionTypeEnum = z.enum(['sale', 'purchase', 'expense', 'salary']);

/** Valid payment methods */
const paymentMethodEnum = z.enum(['cash', 'piutang', 'tempo', 'transfer', 'giro']);

/** Transaction item schema */
const transactionItemSchema = z.object({
  productId: z.string().min(1, 'Produk wajib dipilih'),
  productName: z.string().optional(),
  qty: z.number().positive('Jumlah harus lebih dari 0'),
  qtyInSubUnit: z.number().positive().optional(),
  qtyUnitType: z.enum(['main', 'sub']).optional().default('sub'),
  price: z.number().min(0, 'Harga tidak boleh negatif'),
  hpp: z.number().min(0).optional().default(0),
  subtotal: z.number().optional(),
  profit: z.number().optional(),
});

export const transactionSchemas = {
  /** POST /api/transactions — create transaction */
  create: z.object({
    type: transactionTypeEnum,
    customerId: z.string().min(1).nullable().optional(),
    supplierId: z.string().min(1).nullable().optional(),
    unitId: z.string().min(1, 'Unit/Cabang wajib diisi'),
    courierId: z.string().min(1).nullable().optional(),
    items: z.array(transactionItemSchema).min(1, 'Item transaksi wajib diisi'),
    paymentMethod: paymentMethodEnum.default('cash'),
    paidAmount: z.number().min(0).optional().default(0),
    dueDate: z.string().nullable().optional(),
    notes: sanitizedStringOptional(2000),
    deliveryAddress: sanitizedStringOptional(500),
    transactionDate: z.string().optional(),
  }),

  /** POST /api/transactions/[id]/approve — approve transaction */
  approve: z.object({
    // Transaction ID comes from URL params, not body — body can be empty
  }).passthrough(),

  /** POST /api/transactions/[id]/cancel — cancel transaction */
  cancel: z.object({
    reason: z.string().optional(),
  }),

  /** POST /api/transactions/mark-lunas — mark as fully paid */
  markLunas: z.object({
    transactionId: z.string().min(1, 'ID transaksi diperlukan'),
  }),

  /** GET /api/transactions — query params */
  query: z.object({
    unitId: z.string().min(1).optional(),
    customerId: z.string().min(1).optional(),
    type: transactionTypeEnum.optional(),
    status: z.string().optional(),
    startDate: z.string().optional(),
    endDate: z.string().optional(),
    limit: z.coerce.number().int().positive().max(500).optional(),
    createdById: z.string().min(1).optional(),
  }),
} as const;

// =====================================================================
// FINANCE REQUEST SCHEMAS
// =====================================================================

/** Valid finance request types */
const financeRequestTypeEnum = z.enum([
  'purchase',
  'salary',
  'expense',
  'courier_deposit',
  'cash_to_bank',
]);

/** Valid finance request statuses */
const financeRequestStatusEnum = z.enum([
  'pending',
  'approved',
  'rejected',
  'processed',
]);

/** Valid process types */
const processTypeEnum = z.enum(['debt', 'pay_now', 'approve']);

/** Valid fund sources for payment processing */
const fundSourceEnum = z.enum(['hpp_paid', 'profit_paid', 'profit_unpaid', 'lain_lain']);

/** Valid source types */
const sourceTypeEnum = z.enum(['bank', 'cashbox']);

export const financeRequestSchemas = {
  /** POST /api/finance/requests — create request */
  create: z.object({
    type: financeRequestTypeEnum,
    amount: z.number().positive('Jumlah harus lebih dari 0'),
    description: z.string().default(''),
    unitId: z.string().min(1).optional(),
    supplierId: z.string().min(1).nullable().optional(),
    transactionId: z.string().min(1).nullable().optional(),
    courierId: z.string().min(1).nullable().optional(),
    notes: z.string().nullable().optional(),
    purchaseItems: z.any().optional(), // JSON string or object
  }),

  /** PUT /api/finance/requests/[id] — process request (approve/reject/process/goods-status-update) */
  process: z.object({
    status: financeRequestStatusEnum.optional(),
    processType: processTypeEnum.optional(),
    fundSource: fundSourceEnum.nullable().optional(),
    bankAccountId: z.string().min(1).nullable().optional(),
    cashBoxId: z.string().min(1).nullable().optional(),
    sourceType: sourceTypeEnum.nullable().optional(),
    notes: z.string().nullable().optional(),
    rejectionReason: z.string().nullable().optional(),
    goodsStatus: z.enum(['pending', 'shipped', 'received', 'partial']).optional(),
  }),

  /** GET /api/finance/requests — query params */
  query: z.object({
    type: financeRequestTypeEnum.optional(),
    status: financeRequestStatusEnum.optional(),
  }),
} as const;

// =====================================================================
// PRODUCT SCHEMAS
// =====================================================================

export const productSchemas = {
  /** POST /api/products — create product */
  create: z.object({
    name: z.string().min(1, 'Nama produk wajib diisi'),
    sku: z.string().optional(),
    description: z.string().optional(),
    category: z.string().optional(),
    unit: z.string().optional(),
    subUnit: z.string().nullable().optional(),
    conversionRate: z.number().positive().optional().default(1),
    globalStock: z.number().min(0).optional().default(0),
    avgHpp: z.number().min(0).optional().default(0),
    sellingPrice: z.number().min(0).optional().default(0),
    sellPricePerSubUnit: z.number().min(0).optional().default(0),
    purchasePrice: z.number().min(0).optional().default(0),
    minStock: z.number().min(0).optional().default(0),
    stockType: z.enum(['centralized', 'per_unit']).optional().default('centralized'),
    imageUrl: z.string().nullable().optional(),
    initialStock: z.number().min(0).optional().default(0),
    trackStock: z.boolean().optional().default(true),
    assignedUnits: z.array(z.string().min(1)).optional(),
  }),
} as const;

// =====================================================================
// CUSTOMER SCHEMAS
// =====================================================================

export const customerSchemas = {
  /** POST /api/customers — create customer */
  create: z.object({
    name: sanitizedString(100),
    phone: z.string().max(20, 'Maksimal 20 karakter').nullable().optional()
      .transform(v => (!v || typeof v === 'string' && v.trim() === '') ? null : v.trim()),
    email: z.string().max(100, 'Maksimal 100 karakter').nullable().optional()
      .transform(v => (!v || typeof v === 'string' && v.trim() === '') ? null : v.trim()),
    address: sanitizedStringOptional(500),
    unitId: z.string().min(1, 'Unit/Cabang wajib diisi'),
    notes: sanitizedStringOptional(1000),
    distance: z.enum(['near', 'far']).optional().default('near'),
    assignedToId: z.string().min(1).nullable().optional(),
    cashbackType: z.enum(['percentage', 'fixed', 'nominal']).optional().default('percentage'),
    cashbackValue: z.number().min(0).optional().default(0),
  }),
} as const;

// =====================================================================
// SUPPLIER SCHEMAS
// =====================================================================

export const supplierSchemas = {
  /** POST /api/suppliers — create supplier */
  create: z.object({
    name: sanitizedString(100),
    phone: z.string().max(20, 'Maksimal 20 karakter').nullable().optional()
      .transform(v => (!v || typeof v === 'string' && v.trim() === '') ? null : v.trim()),
    email: z.string().max(100, 'Maksimal 100 karakter').nullable().optional()
      .transform(v => (!v || typeof v === 'string' && v.trim() === '') ? null : v.trim()),
    address: sanitizedStringOptional(500),
    bankName: z.string().nullable().optional(),
    bankAccount: z.string().nullable().optional(),
    notes: sanitizedStringOptional(1000),
  }),
} as const;

// =====================================================================
// COMMON SCHEMAS
// =====================================================================

export const commonSchemas = {
  /** Pagination query parameters */
  pagination: z.object({
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    search: z.string().optional(),
    sortBy: z.string().optional(),
    sortOrder: z.enum(['asc', 'desc']).optional().default('desc'),
  }),

  /** Valid ID string (CUID or UUID) */
  id: z.string().min(1, 'ID diperlukan'),

  /** Generic ID parameter */
  idParam: z.object({
    id: z.string().min(1, 'ID diperlukan'),
  }),
} as const;

// =====================================================================
// VALIDATE BODY HELPER
// =====================================================================

/**
 * Validate a request body against a Zod schema.
 *
 * Returns a discriminated union:
 *   - { success: true, data: T } — validated and typed data
 *   - { success: false, error: string } — first validation error message
 *
 * Usage in API routes:
 * ```ts
 * const body = await request.json();
 * const validation = validateBody(authSchemas.login, body);
 * if (!validation.success) {
 *   return NextResponse.json({ error: validation.error }, { status: 400 });
 * }
 * const { email, password } = validation.data;
 * ```
 */
export function validateBody<T>(
  schema: z.ZodType<T>,
  body: unknown
): { success: true; data: T } | { success: false; error: string } {
  const result = schema.safeParse(body);

  if (!result.success) {
    const firstError = result.error.issues[0];
    return {
      success: false,
      error: firstError
        ? `${firstError.path.join('.')}: ${firstError.message}`
        : 'Data tidak valid',
    };
  }

  return { success: true, data: result.data };
}

/**
 * Validate URL search params (query string) against a Zod schema.
 * Automatically coerces string values where possible.
 *
 * Usage:
 * ```ts
 * const { searchParams } = new URL(request.url);
 * const query = validateQuery(commonSchemas.pagination, searchParams);
 * if (!query.success) {
 *   return NextResponse.json({ error: query.error }, { status: 400 });
 * }
 * ```
 */
export function validateQuery<T>(
  schema: z.ZodType<T>,
  searchParams: URLSearchParams
): { success: true; data: T } | { success: false; error: string } {
  // Convert URLSearchParams to a plain object
  const obj: Record<string, string | string[] | undefined> = {};
  for (const [key, value] of searchParams.entries()) {
    // If key already exists, convert to array
    if (obj[key] !== undefined) {
      const existing = obj[key];
      if (Array.isArray(existing)) {
        existing.push(value);
      } else {
        obj[key] = [existing, value];
      }
    } else {
      obj[key] = value;
    }
  }

  const result = schema.safeParse(obj);

  if (!result.success) {
    const firstError = result.error.issues[0];
    return {
      success: false,
      error: firstError
        ? `${firstError.path.join('.')}: ${firstError.message}`
        : 'Parameter tidak valid',
    };
  }

  return { success: true, data: result.data };
}
