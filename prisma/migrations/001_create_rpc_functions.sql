-- =============================================================================
-- 001_create_rpc_functions.sql
-- Comprehensive SQL migration for ALL PostgreSQL RPC functions used by Razkindo ERP.
--
-- These functions are called via `db.rpc('function_name', { params })` throughout
-- the codebase. They handle atomic balance updates, stock management, courier cash,
-- cashback, finance reconciliation, and search index setup.
--
-- IMPORTANT: Run this migration after `prisma db push` has created all tables.
-- Each function has DROP IF EXISTS before CREATE for idempotent re-runs.
-- =============================================================================

BEGIN;

-- =============================================================================
-- 1. ensure_pg_trgm
-- Enables pg_trgm extension for full-text search with GIN indexes.
-- Called from: src/lib/ensure-search.ts:10
-- Params: none
-- Returns: void
-- =============================================================================
DROP FUNCTION IF EXISTS ensure_pg_trgm();
CREATE OR REPLACE FUNCTION ensure_pg_trgm()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_trgm;

  CREATE INDEX IF NOT EXISTS idx_products_name_trgm
    ON products USING gin (name gin_trgm_ops);
  CREATE INDEX IF NOT EXISTS idx_customers_name_trgm
    ON customers USING gin (name gin_trgm_ops);
  CREATE INDEX IF NOT EXISTS idx_customers_phone_trgm
    ON customers USING gin (phone gin_trgm_ops);
END;
$$;

-- =============================================================================
-- 2. atomic_increment_customer_stats
-- Atomically updates customer total_orders, total_spent, and last_transaction_date.
-- Called from: transactions/route.ts:540,583, cancel/route.ts:253,324,
--              pwa-orders/approve/route.ts:426
-- Params: p_customer_id text, p_order_delta int DEFAULT 1, p_spent_delta numeric DEFAULT 0
-- Returns: void
-- =============================================================================
DROP FUNCTION IF EXISTS atomic_increment_customer_stats(text, integer, numeric);
CREATE OR REPLACE FUNCTION atomic_increment_customer_stats(
  p_customer_id text,
  p_order_delta integer DEFAULT 1,
  p_spent_delta numeric DEFAULT 0
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE customers
  SET total_orders = COALESCE(total_orders, 0) + p_order_delta,
      total_spent  = COALESCE(total_spent, 0) + p_spent_delta,
      last_transaction_date = GREATEST(
        COALESCE(last_transaction_date, '1970-01-01'::timestamptz),
        NOW()
      )
  WHERE id = p_customer_id;
END;
$$;

-- =============================================================================
-- 3. decrement_stock
-- Atomically decrements global_stock on a product. Raises if insufficient stock.
-- Called from: transactions/[id]/approve/route.ts:111, cancel/route.ts:104,117,
--              products/[id]/stock/route.ts:109, pwa-orders/approve/route.ts:353
-- Params: p_product_id text, p_qty numeric
-- Returns: void
-- =============================================================================
DROP FUNCTION IF EXISTS decrement_stock(text, numeric);
CREATE OR REPLACE FUNCTION decrement_stock(p_product_id text, p_qty numeric)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_new_stock numeric;
BEGIN
  UPDATE products
  SET global_stock = global_stock - p_qty
  WHERE id = p_product_id AND global_stock >= p_qty
  RETURNING global_stock INTO v_new_stock;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Stok tidak cukup untuk produk %', p_product_id;
  END IF;
END;
$$;

-- =============================================================================
-- 4. increment_stock
-- Atomically increments global_stock on a product.
-- Called from: transactions/route.ts:705, cancel/route.ts:104,117,
--              pwa-orders/approve/route.ts:388
-- Params: p_product_id text, p_qty numeric
-- Returns: void
-- =============================================================================
DROP FUNCTION IF EXISTS increment_stock(text, numeric);
CREATE OR REPLACE FUNCTION increment_stock(p_product_id text, p_qty numeric)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  UPDATE products SET global_stock = global_stock + p_qty WHERE id = p_product_id;
END;
$$;

-- =============================================================================
-- 5. decrement_unit_stock
-- Atomically decrements stock on a unit_product. Raises if insufficient stock.
-- Called from: transactions/[id]/approve/route.ts:98, cancel/route.ts:91,
--              products/[id]/stock/route.ts:197, pwa-orders/approve/route.ts:369
-- Params: p_unit_product_id text, p_qty numeric
-- Returns: void
-- =============================================================================
DROP FUNCTION IF EXISTS decrement_unit_stock(text, numeric);
CREATE OR REPLACE FUNCTION decrement_unit_stock(p_unit_product_id text, p_qty numeric)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_new_stock numeric;
BEGIN
  UPDATE unit_products
  SET stock = stock - p_qty
  WHERE id = p_unit_product_id AND stock >= p_qty
  RETURNING stock INTO v_new_stock;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Stok unit tidak cukup (unit_product_id: %)', p_unit_product_id;
  END IF;
END;
$$;

-- =============================================================================
-- 6. increment_unit_stock
-- Atomically increments stock on a unit_product.
-- Called from: transactions/route.ts:711, cancel/route.ts:91,
--              products/[id]/stock/route.ts:170, pwa-orders/approve/route.ts:386
-- Params: p_unit_product_id text, p_qty numeric
-- Returns: void
-- =============================================================================
DROP FUNCTION IF EXISTS increment_unit_stock(text, numeric);
CREATE OR REPLACE FUNCTION increment_unit_stock(p_unit_product_id text, p_qty numeric)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  UPDATE unit_products SET stock = stock + p_qty WHERE id = p_unit_product_id;
END;
$$;

-- =============================================================================
-- 7. recalc_global_stock
-- Recalculates product.global_stock from SUM of unit_products.stock.
-- Called from: transactions/[id]/approve/route.ts:107,162, cancel/route.ts:161,
--              transactions/route.ts:654,716, products/[id]/stock/route.ts:176,203
-- Params: p_product_id text
-- Returns: void
-- =============================================================================
DROP FUNCTION IF EXISTS recalc_global_stock(text);
CREATE OR REPLACE FUNCTION recalc_global_stock(p_product_id text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_total numeric;
BEGIN
  SELECT COALESCE(SUM(stock), 0) INTO v_total
  FROM unit_products WHERE product_id = p_product_id;
  UPDATE products SET global_stock = v_total WHERE id = p_product_id;
END;
$$;

-- =============================================================================
-- 8. increment_stock_with_hpp
-- Atomically increments global_stock and recalculates weighted average HPP.
-- Called from: finance/requests/[id]/route.ts:408, products/[id]/stock/route.ts:82
-- Params: p_product_id text, p_qty numeric, p_new_hpp numeric DEFAULT 0
-- Returns: void
-- =============================================================================
DROP FUNCTION IF EXISTS increment_stock_with_hpp(text, numeric, numeric);
CREATE OR REPLACE FUNCTION increment_stock_with_hpp(
  p_product_id text,
  p_qty numeric,
  p_new_hpp numeric DEFAULT 0
)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  v_current_stock numeric;
  v_current_hpp numeric;
  v_new_global_stock numeric;
  v_new_avg_hpp numeric;
BEGIN
  SELECT global_stock, avg_hpp
  INTO v_current_stock, v_current_hpp
  FROM products WHERE id = p_product_id;

  v_new_global_stock := COALESCE(v_current_stock, 0) + p_qty;

  IF p_qty > 0 AND p_new_hpp > 0 THEN
    v_new_avg_hpp := (
      COALESCE(v_current_stock, 0) * COALESCE(v_current_hpp, 0)
      + p_qty * p_new_hpp
    ) / v_new_global_stock;
  ELSE
    v_new_avg_hpp := COALESCE(v_current_hpp, 0);
  END IF;

  UPDATE products
  SET global_stock = v_new_global_stock, avg_hpp = v_new_avg_hpp
  WHERE id = p_product_id;
END;
$$;

-- =============================================================================
-- 9. decrement_unit_stock_recalc
-- Combined atomic operation: decrement unit stock + recalculate global stock.
-- Called from: transactions/route.ts:640
-- Params: p_unit_product_id text, p_qty numeric
-- Returns: json { new_unit_stock, new_global_stock, product_id }
-- =============================================================================
DROP FUNCTION IF EXISTS decrement_unit_stock_recalc(text, numeric);
CREATE OR REPLACE FUNCTION decrement_unit_stock_recalc(
  p_unit_product_id text,
  p_qty numeric
)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_new_unit_stock numeric;
  v_new_global_stock numeric;
  v_product_id text;
BEGIN
  UPDATE unit_products
  SET stock = stock - p_qty
  WHERE id = p_unit_product_id AND stock >= p_qty
  RETURNING stock, product_id INTO v_new_unit_stock, v_product_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Stok unit tidak cukup (unit_product_id: %)', p_unit_product_id;
  END IF;

  SELECT COALESCE(SUM(stock), 0) INTO v_new_global_stock
  FROM unit_products WHERE product_id = v_product_id;

  UPDATE products SET global_stock = v_new_global_stock WHERE id = v_product_id;

  RETURN json_build_object(
    'new_unit_stock', v_new_unit_stock,
    'new_global_stock', v_new_global_stock,
    'product_id', v_product_id
  );
END;
$$;

-- =============================================================================
-- 10. batch_decrement_centralized_stock
-- All-or-nothing batch stock decrement for centralized products.
-- Validates all first, then deducts all. Prevents partial failures.
-- Called from: transactions/route.ts:679
-- Params: p_product_ids jsonb, p_quantities jsonb
-- Returns: json array of { product_id, new_stock }
-- =============================================================================
DROP FUNCTION IF EXISTS batch_decrement_centralized_stock(jsonb, jsonb);
CREATE OR REPLACE FUNCTION batch_decrement_centralized_stock(
  p_product_ids jsonb,
  p_quantities jsonb
)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_results jsonb := '[]'::jsonb;
  v_pid text;
  v_qty numeric;
  v_new_stock numeric;
  v_idx integer;
BEGIN
  IF jsonb_array_length(p_product_ids) != jsonb_array_length(p_quantities) THEN
    RAISE EXCEPTION 'product_ids and quantities arrays must have the same length';
  END IF;

  -- Validation pass: check all products exist and have sufficient stock
  FOR v_idx IN 0 .. jsonb_array_length(p_product_ids) - 1 LOOP
    v_pid := p_product_ids->>v_idx;
    v_qty := (p_quantities->>v_idx)::numeric;
    SELECT global_stock INTO v_new_stock FROM products WHERE id = v_pid;
    IF v_new_stock IS NULL THEN
      RAISE EXCEPTION 'Produk tidak ditemukan: %', v_pid;
    END IF;
    IF v_new_stock < v_qty THEN
      RAISE EXCEPTION 'Stok tidak cukup untuk produk %. Tersedia: %, Dibutuhkan: %',
        v_pid, v_new_stock, v_qty;
    END IF;
  END LOOP;

  -- Deduction pass: all validated, now deduct atomically
  FOR v_idx IN 0 .. jsonb_array_length(p_product_ids) - 1 LOOP
    v_pid := p_product_ids->>v_idx;
    v_qty := (p_quantities->>v_idx)::numeric;
    UPDATE products
    SET global_stock = global_stock - v_qty
    WHERE id = v_pid
    RETURNING global_stock INTO v_new_stock;
    v_results := v_results || jsonb_build_object('product_id', v_pid, 'new_stock', v_new_stock);
  END LOOP;

  RETURN v_results;
END;
$$;

-- =============================================================================
-- 11. reverse_purchase_stock_with_hpp
-- Reverses a purchase stock addition when cancelling a purchase transaction.
-- Handles both centralized and per_unit stock types with HPP reversal.
-- Called from: transactions/[id]/cancel/route.ts:136
-- Params: p_product_id text, p_qty numeric, p_original_hpp numeric,
--         p_unit_product_id text DEFAULT NULL
-- Returns: json { new_stock, new_avg_hpp }
-- =============================================================================
DROP FUNCTION IF EXISTS reverse_purchase_stock_with_hpp(text, numeric, numeric, text);
CREATE OR REPLACE FUNCTION reverse_purchase_stock_with_hpp(
  p_product_id text,
  p_qty numeric,
  p_original_hpp numeric,
  p_unit_product_id text DEFAULT NULL
)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_old_stock numeric;
  v_old_avg_hpp numeric;
  v_new_stock numeric;
  v_new_avg_hpp numeric;
  v_total_value numeric;
  v_removed_value numeric;
BEGIN
  -- Step 1: Decrement unit_product stock if per_unit (before locking products)
  IF p_unit_product_id IS NOT NULL THEN
    UPDATE unit_products
    SET stock = GREATEST(0, stock - p_qty)
    WHERE id = p_unit_product_id;
  END IF;

  -- Step 2: Lock the product row FOR UPDATE and read current values atomically
  SELECT global_stock, avg_hpp INTO v_old_stock, v_old_avg_hpp
  FROM products WHERE id = p_product_id FOR UPDATE;

  v_old_stock  := COALESCE(v_old_stock, 0);
  v_old_avg_hpp := COALESCE(v_old_avg_hpp, 0);

  -- Step 3: Calculate new stock
  IF p_unit_product_id IS NOT NULL THEN
    -- Recalculate from all unit_products for per_unit products
    SELECT COALESCE(SUM(stock), 0) INTO v_new_stock
    FROM unit_products WHERE product_id = p_product_id;
  ELSE
    v_new_stock := GREATEST(0, v_old_stock - p_qty);
  END IF;

  -- Step 4: Reverse weighted average HPP
  IF v_new_stock > 0 AND v_old_stock > 0 THEN
    v_total_value   := v_old_stock * v_old_avg_hpp;
    v_removed_value := p_qty * COALESCE(p_original_hpp, 0);
    v_new_avg_hpp   := GREATEST(0, ROUND((v_total_value - v_removed_value) / v_new_stock));
  ELSIF v_new_stock <= 0 THEN
    v_new_avg_hpp := 0;
  ELSE
    v_new_avg_hpp := v_old_avg_hpp;
  END IF;

  -- Step 5: Update product atomically
  UPDATE products
  SET global_stock = v_new_stock, avg_hpp = v_new_avg_hpp
  WHERE id = p_product_id;

  RETURN json_build_object('new_stock', v_new_stock, 'new_avg_hpp', v_new_avg_hpp);
END;
$$;

-- =============================================================================
-- 12. atomic_add_courier_cash
-- Atomically adds to courier cash balance (and creates record if missing).
-- Tracks total_collected for positive deltas.
-- Called from: courier/deliver/route.ts:174, transactions/mark-lunas/route.ts:270
-- Params: p_courier_id text, p_unit_id text, p_delta numeric
-- Returns: numeric (new balance)
-- =============================================================================
DROP FUNCTION IF EXISTS atomic_add_courier_cash(text, text, numeric);
CREATE OR REPLACE FUNCTION atomic_add_courier_cash(
  p_courier_id text,
  p_unit_id text,
  p_delta numeric
)
RETURNS numeric LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_id text;
  v_new_balance numeric;
BEGIN
  SELECT id INTO v_id FROM courier_cash
  WHERE courier_id = p_courier_id AND unit_id = p_unit_id;

  IF v_id IS NULL THEN
    INSERT INTO courier_cash (id, courier_id, unit_id, balance, total_collected, total_handover, created_at, updated_at)
    VALUES (gen_random_uuid()::text, p_courier_id, p_unit_id, p_delta, p_delta, 0, now(), now())
    RETURNING balance INTO v_new_balance;
  ELSE
    UPDATE courier_cash
    SET balance = balance + p_delta,
        total_collected = total_collected + CASE WHEN p_delta > 0 THEN p_delta ELSE 0 END,
        total_handover = total_handover + CASE WHEN p_delta < 0 THEN ABS(p_delta) ELSE 0 END,
        updated_at = now()
    WHERE id = v_id
    RETURNING balance INTO v_new_balance;
  END IF;

  RETURN v_new_balance;
END;
$$;

-- =============================================================================
-- 13. atomic_add_cashback
-- Atomically adds to customer cashback_balance. Validates minimum balance.
-- Called from: transactions/mark-lunas/route.ts:416, referrals/[id]/route.ts:98,
--              cashback/withdrawals/[id]/route.ts:65,
--              pwa/[code]/cashback/withdraw/route.ts:123, lib/processors.ts:240
-- Params: p_customer_id text, p_delta numeric, p_min numeric DEFAULT 0
-- Returns: numeric (new balance)
-- =============================================================================
DROP FUNCTION IF EXISTS atomic_add_cashback(text, numeric, numeric);
CREATE OR REPLACE FUNCTION atomic_add_cashback(
  p_customer_id text,
  p_delta numeric,
  p_min numeric DEFAULT 0
)
RETURNS numeric LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_new_balance numeric;
BEGIN
  UPDATE customers
  SET cashback_balance = COALESCE(cashback_balance, 0) + p_delta
  WHERE id = p_customer_id
    AND COALESCE(cashback_balance, 0) + p_delta >= p_min
  RETURNING cashback_balance INTO v_new_balance;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Saldo cashback tidak cukup atau customer tidak ditemukan';
  END IF;
  RETURN v_new_balance;
END;
$$;

-- =============================================================================
-- 14. atomic_deduct_cashback
-- Atomically deducts from customer cashback_balance. Raises if insufficient.
-- Called from: transactions/[id]/cancel/route.ts:274,
--              pwa/[code]/cashback/withdraw/route.ts:79
-- Params: p_customer_id text, p_delta numeric
-- Returns: numeric (new balance)
-- =============================================================================
DROP FUNCTION IF EXISTS atomic_deduct_cashback(text, numeric);
CREATE OR REPLACE FUNCTION atomic_deduct_cashback(
  p_customer_id text,
  p_delta numeric
)
RETURNS numeric LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_new_balance numeric;
BEGIN
  UPDATE customers
  SET cashback_balance = COALESCE(cashback_balance, 0) - p_delta
  WHERE id = p_customer_id
    AND COALESCE(cashback_balance, 0) >= p_delta
  RETURNING cashback_balance INTO v_new_balance;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Saldo cashback tidak cukup atau customer tidak ditemukan';
  END IF;
  RETURN v_new_balance;
END;
$$;

-- =============================================================================
-- 15. get_sale_totals_aggregate
-- Returns aggregated sale totals: hpp_paid, profit_paid, total.
-- Called from: finance/pools/route.ts:28,235
-- Params: none
-- Returns: json { hpp_paid, profit_paid, total }
-- =============================================================================
DROP FUNCTION IF EXISTS get_sale_totals_aggregate();
CREATE OR REPLACE FUNCTION get_sale_totals_aggregate()
RETURNS json LANGUAGE plpgsql STABLE SECURITY DEFINER AS $$
DECLARE
  v_hpp_paid numeric;
  v_profit_paid numeric;
  v_total numeric;
BEGIN
  SELECT
    COALESCE(SUM(hpp_paid), 0),
    COALESCE(SUM(profit_paid), 0),
    COALESCE(SUM(total), 0)
  INTO v_hpp_paid, v_profit_paid, v_total
  FROM transactions WHERE type = 'sale';

  RETURN json_build_object(
    'hpp_paid', v_hpp_paid,
    'profit_paid', v_profit_paid,
    'total', v_total
  );
END;
$$;

-- =============================================================================
-- 16. get_physical_balance_totals
-- Returns total balances from all active cash_boxes and bank_accounts.
-- Called from: finance/pools/route.ts:44,125,252
-- Params: none
-- Returns: json { total_brankas, total_rekening, total_physical }
-- =============================================================================
DROP FUNCTION IF EXISTS get_physical_balance_totals();
CREATE OR REPLACE FUNCTION get_physical_balance_totals()
RETURNS json LANGUAGE plpgsql STABLE SECURITY DEFINER AS $$
DECLARE
  v_brankas numeric;
  v_rekening numeric;
BEGIN
  SELECT COALESCE(SUM(balance), 0) INTO v_brankas
  FROM cash_boxes WHERE is_active IS NOT FALSE;
  SELECT COALESCE(SUM(balance), 0) INTO v_rekening
  FROM bank_accounts WHERE is_active IS NOT FALSE;

  RETURN json_build_object(
    'total_brankas', v_brankas,
    'total_rekening', v_rekening,
    'total_physical', v_brankas + v_rekening
  );
END;
$$;

-- =============================================================================
-- 17. finance_reconcile
-- Reconciles stored pool balances with derived values from transactions.
-- Optionally auto-fixes discrepancies.
-- Called from: finance/pools/route.ts:292
-- Params: p_auto_fix boolean DEFAULT false
-- Returns: json { stored_hpp, stored_profit, stored_lain_lain, derived_hpp,
--           derived_profit, physical, brankas, rekening, pool_total,
--           issues_count, issues, auto_fixed, is_healthy }
-- =============================================================================
DROP FUNCTION IF EXISTS finance_reconcile(boolean);
CREATE OR REPLACE FUNCTION finance_reconcile(p_auto_fix boolean DEFAULT false)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_stored_hpp numeric;
  v_stored_profit numeric;
  v_stored_lain numeric;
  v_raw text;
  v_derived_hpp numeric;
  v_derived_profit numeric;
  v_brankas numeric;
  v_rekening numeric;
  v_physical numeric;
  v_hpp_diff numeric;
  v_profit_diff numeric;
  v_pool_total numeric;
  v_issues jsonb := '[]'::jsonb;
BEGIN
  -- Read stored pool values
  SELECT value INTO v_raw FROM settings WHERE key = 'pool_hpp_paid_balance';
  BEGIN v_stored_hpp := v_raw::numeric; EXCEPTION WHEN OTHERS THEN v_stored_hpp := 0; END;

  SELECT value INTO v_raw FROM settings WHERE key = 'pool_profit_paid_balance';
  BEGIN v_stored_profit := v_raw::numeric; EXCEPTION WHEN OTHERS THEN v_stored_profit := 0; END;

  SELECT value INTO v_raw FROM settings WHERE key = 'pool_investor_fund';
  BEGIN v_stored_lain := v_raw::numeric; EXCEPTION WHEN OTHERS THEN v_stored_lain := 0; END;

  -- Calculate derived from transactions
  SELECT COALESCE(SUM(hpp_paid), 0), COALESCE(SUM(profit_paid), 0)
  INTO v_derived_hpp, v_derived_profit
  FROM transactions WHERE type = 'sale';

  -- Get physical balances
  SELECT COALESCE(SUM(balance), 0) INTO v_brankas
  FROM cash_boxes WHERE is_active IS NOT FALSE;
  SELECT COALESCE(SUM(balance), 0) INTO v_rekening
  FROM bank_accounts WHERE is_active IS NOT FALSE;
  v_physical   := v_brankas + v_rekening;
  v_pool_total := v_stored_hpp + v_stored_profit + v_stored_lain;

  -- Build issues array
  v_hpp_diff    := v_stored_hpp - v_derived_hpp;
  v_profit_diff := v_stored_profit - v_derived_profit;

  IF ABS(v_hpp_diff) > 0.01 THEN
    v_issues := v_issues || jsonb_build_object(
      'type', 'hpp_mismatch', 'stored', v_stored_hpp,
      'derived', v_derived_hpp, 'diff', v_hpp_diff
    );
  END IF;
  IF ABS(v_profit_diff) > 0.01 THEN
    v_issues := v_issues || jsonb_build_object(
      'type', 'profit_mismatch', 'stored', v_stored_profit,
      'derived', v_derived_profit, 'diff', v_profit_diff
    );
  END IF;
  IF ABS(v_pool_total - v_physical) > 0.01 THEN
    v_issues := v_issues || jsonb_build_object(
      'type', 'pool_physical_mismatch', 'pool_total', v_pool_total,
      'physical_total', v_physical, 'diff', v_pool_total - v_physical
    );
  END IF;

  -- Auto-fix if requested
  IF p_auto_fix AND jsonb_array_length(v_issues) > 0 THEN
    INSERT INTO settings (id, key, value, created_at, updated_at)
    VALUES (gen_random_uuid()::text, 'pool_hpp_paid_balance', v_derived_hpp::text, now(), now())
    ON CONFLICT (key) DO UPDATE SET value = v_derived_hpp::text, updated_at = now();

    INSERT INTO settings (id, key, value, created_at, updated_at)
    VALUES (gen_random_uuid()::text, 'pool_profit_paid_balance', v_derived_profit::text, now(), now())
    ON CONFLICT (key) DO UPDATE SET value = v_derived_profit::text, updated_at = now();

    v_stored_lain := GREATEST(0, v_physical - v_derived_hpp - v_derived_profit);
    INSERT INTO settings (id, key, value, created_at, updated_at)
    VALUES (gen_random_uuid()::text, 'pool_investor_fund', v_stored_lain::text, now(), now())
    ON CONFLICT (key) DO UPDATE SET value = v_stored_lain::text, updated_at = now();
  END IF;

  RETURN json_build_object(
    'stored_hpp', v_stored_hpp,
    'stored_profit', v_stored_profit,
    'stored_lain_lain', v_stored_lain,
    'derived_hpp', v_derived_hpp,
    'derived_profit', v_derived_profit,
    'physical', v_physical,
    'brankas', v_brankas,
    'rekening', v_rekening,
    'pool_total', v_stored_hpp + v_stored_profit + v_stored_lain,
    'issues_count', jsonb_array_length(v_issues),
    'issues', v_issues,
    'auto_fixed', p_auto_fix AND jsonb_array_length(v_issues) > 0,
    'is_healthy', jsonb_array_length(v_issues) = 0
  );
END;
$$;

-- =============================================================================
-- 18. process_courier_handover
-- Processes a courier handover: deducts courier cash, credits brankas,
-- creates finance_request and courier_handover records atomically.
-- Called from: courier/handover/route.ts:158
-- Params: p_courier_id text, p_unit_id text, p_amount numeric,
--         p_processed_by_id text, p_notes text DEFAULT NULL
-- Returns: json { handover_id, finance_request_id, cash_box_id, new_balance,
--                cash_box_balance }
-- =============================================================================
DROP FUNCTION IF EXISTS process_courier_handover(text, text, numeric, text, text);
CREATE OR REPLACE FUNCTION process_courier_handover(
  p_courier_id text,
  p_unit_id text,
  p_amount numeric,
  p_processed_by_id text,
  p_notes text DEFAULT NULL
)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_cash_id text;
  v_new_balance numeric;
  v_cash_box_id text;
  v_cash_box_balance numeric;
  v_finance_request_id text;
  v_handover_id text;
  v_courier_name text;
  v_description text;
BEGIN
  -- 0. Always fetch courier name (needed for description)
  SELECT name INTO v_courier_name FROM users WHERE id = p_courier_id;
  v_description := 'Setoran kurir'
    || CASE WHEN v_courier_name IS NOT NULL THEN ' ' || v_courier_name ELSE '' END;

  -- 1. Get or create courier_cash record
  SELECT id INTO v_cash_id FROM courier_cash
  WHERE courier_id = p_courier_id AND unit_id = p_unit_id;

  IF v_cash_id IS NULL THEN
    INSERT INTO courier_cash (id, courier_id, unit_id, balance, total_collected, total_handover, created_at, updated_at)
    VALUES (gen_random_uuid()::text, p_courier_id, p_unit_id, 0, 0, 0, now(), now())
    RETURNING id INTO v_cash_id;
  END IF;

  -- 2. Validate sufficient balance (FOR UPDATE prevents concurrent handover race)
  SELECT balance INTO v_new_balance FROM courier_cash WHERE id = v_cash_id FOR UPDATE;
  IF v_new_balance IS NULL OR v_new_balance < p_amount THEN
    RAISE EXCEPTION 'Saldo kurir tidak cukup. Tersedia: %, Dibutuhkan: %',
      COALESCE(v_new_balance, 0), p_amount;
  END IF;

  -- 3. Deduct from courier_cash balance
  UPDATE courier_cash
  SET balance = balance - p_amount,
      total_handover = total_handover + p_amount,
      updated_at = now()
  WHERE id = v_cash_id
  RETURNING balance INTO v_new_balance;

  -- 4. Get or create brankas (cash_box) for the unit
  SELECT id INTO v_cash_box_id FROM cash_boxes
  WHERE unit_id = p_unit_id AND is_active = true AND name ILIKE '%brankas%'
  LIMIT 1;
  IF v_cash_box_id IS NULL THEN
    SELECT id INTO v_cash_box_id FROM cash_boxes
    WHERE unit_id = p_unit_id AND is_active = true
    LIMIT 1;
  END IF;
  IF v_cash_box_id IS NULL THEN
    INSERT INTO cash_boxes (id, name, unit_id, balance, is_active, version, notes, created_at, updated_at)
    VALUES (gen_random_uuid()::text, 'Brankas', p_unit_id, 0, true, 1, 'Auto-created', now(), now())
    RETURNING id INTO v_cash_box_id;
  END IF;

  -- 5. Credit brankas balance
  UPDATE cash_boxes
  SET balance = balance + p_amount,
      updated_at = now()
  WHERE id = v_cash_box_id
  RETURNING balance INTO v_cash_box_balance;

  -- 6. Create finance_request (type: courier_deposit, status: processed)
  INSERT INTO finance_requests (
    id, type, request_by_id, unit_id, amount, description,
    courier_id, goods_status, status, approved_by_id, approved_at,
    processed_by_id, processed_at, source_type, cash_box_id,
    payment_type, version, created_at, updated_at
  )
  VALUES (
    gen_random_uuid()::text, 'courier_deposit', p_processed_by_id, p_unit_id, p_amount,
    v_description,
    p_courier_id, 'received', 'processed',
    p_processed_by_id, now(), p_processed_by_id, now(),
    'cashbox', v_cash_box_id, 'pay_now', 1, now(), now()
  )
  RETURNING id INTO v_finance_request_id;

  -- 7. Create courier_handover record
  INSERT INTO courier_handovers (
    id, courier_cash_id, amount, notes, status,
    finance_request_id, processed_by_id, processed_at, created_at, updated_at
  )
  VALUES (
    gen_random_uuid()::text, v_cash_id, p_amount, p_notes, 'processed',
    v_finance_request_id, p_processed_by_id, now(), now(), now()
  )
  RETURNING id INTO v_handover_id;

  -- 8. Return all results
  RETURN json_build_object(
    'handover_id', v_handover_id,
    'finance_request_id', v_finance_request_id,
    'cash_box_id', v_cash_box_id,
    'new_balance', v_new_balance,
    'cash_box_balance', v_cash_box_balance
  );
END;
$$;

-- =============================================================================
-- 19. get_courier_cash_totals
-- Returns aggregated courier cash totals across all couriers.
-- Called from: courier/cash-summary/route.ts:22
-- Params: p_unit_id text DEFAULT NULL (optional filter)
-- Returns: json { total_balance, total_collected, total_handover, courier_count }
-- =============================================================================
DROP FUNCTION IF EXISTS get_courier_cash_totals(text);
CREATE OR REPLACE FUNCTION get_courier_cash_totals(p_unit_id text DEFAULT NULL)
RETURNS json LANGUAGE plpgsql STABLE SECURITY DEFINER AS $$
DECLARE result json;
BEGIN
  SELECT json_build_object(
    'total_balance',   COALESCE(SUM(balance), 0),
    'total_collected', COALESCE(SUM(total_collected), 0),
    'total_handover',  COALESCE(SUM(total_handover), 0),
    'courier_count',   COUNT(DISTINCT courier_id)
  ) INTO result
  FROM courier_cash
  WHERE (p_unit_id IS NULL OR unit_id = p_unit_id);
  RETURN result;
END;
$$;

-- =============================================================================
-- 20. atomic_double_entry
-- Executes a double-entry bookkeeping operation atomically in a single DB txn:
-- debit one account, credit another, write both ledger entries.
-- If credit fails, the debit is automatically rolled back.
-- Called from: lib/finance-engine.ts:275
-- Params: p_debit_type text, p_debit_table text, p_debit_id text,
--         p_credit_type text, p_credit_table text, p_credit_id text,
--         p_amount numeric, p_journal_id text, p_reference_type text,
--         p_reference_id text, p_debit_description text,
--         p_credit_description text, p_created_by_id text DEFAULT NULL,
--         p_min_balance numeric DEFAULT 0
-- Returns: json { debit_result, credit_result, debit_before, credit_before }
-- =============================================================================
DROP FUNCTION IF EXISTS atomic_double_entry(
  text, text, text, text, text, text, numeric, text, text, text, text, text, text, numeric
);
CREATE OR REPLACE FUNCTION atomic_double_entry(
  p_debit_type text,
  p_debit_table text,
  p_debit_id text,
  p_credit_type text,
  p_credit_table text,
  p_credit_id text,
  p_amount numeric,
  p_journal_id text,
  p_reference_type text,
  p_reference_id text,
  p_debit_description text,
  p_credit_description text,
  p_created_by_id text DEFAULT NULL,
  p_min_balance numeric DEFAULT 0
)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_debit_before numeric;
  v_debit_after numeric;
  v_credit_before numeric;
  v_credit_after numeric;
  v_debit_account_type text;
  v_credit_account_type text;
  v_raw text;
BEGIN
  -- Determine account types for ledger entries
  v_debit_account_type := CASE
    WHEN p_debit_type = 'pool' THEN 'pool'
    WHEN p_debit_table = 'bank_accounts' THEN 'bank'
    ELSE 'cashbox'
  END;
  v_credit_account_type := CASE
    WHEN p_credit_type = 'pool' THEN 'pool'
    WHEN p_credit_table = 'bank_accounts' THEN 'bank'
    ELSE 'cashbox'
  END;

  -- ============================================================
  -- DEBIT: atomically deduct and capture before/after
  -- ============================================================
  IF p_debit_type = 'pool' THEN
    -- Lock the settings row FOR UPDATE to prevent concurrent modification
    SELECT value INTO v_raw FROM settings WHERE key = p_debit_id FOR UPDATE;
    BEGIN v_debit_before := v_raw::numeric; EXCEPTION WHEN OTHERS THEN
      BEGIN v_debit_before := (v_raw::json)::text::numeric;
      EXCEPTION WHEN OTHERS THEN v_debit_before := 0; END;
    END;
    v_debit_before := COALESCE(v_debit_before, 0);
    v_debit_after := v_debit_before - p_amount;
    IF v_debit_after < p_min_balance THEN
      RAISE EXCEPTION 'Insufficient pool balance for debit. Key: %, Current: %, Debit: %, Min: %',
        p_debit_id, v_debit_before, p_amount, p_min_balance;
    END IF;
    INSERT INTO settings (id, key, value, created_at, updated_at)
    VALUES (gen_random_uuid()::text, p_debit_id, v_debit_after::text, now(), now())
    ON CONFLICT (key) DO UPDATE SET value = v_debit_after::text, updated_at = now();
  ELSE
    -- Physical account: single atomic UPDATE with RETURNING captures before/after
    EXECUTE format(
      'UPDATE %I SET balance = balance - $1 WHERE id = $2 AND balance - $1 >= $3 RETURNING balance + $1, balance',
      p_debit_table
    ) INTO v_debit_before, v_debit_after USING p_amount, p_debit_id, p_min_balance;
    IF v_debit_before IS NULL THEN
      RAISE EXCEPTION 'Debit failed: insufficient balance or account not found (table: %, id: %)',
        p_debit_table, p_debit_id;
    END IF;
  END IF;

  -- ============================================================
  -- CREDIT: atomically add and capture before/after
  -- If credit fails, the entire function rolls back (single DB txn)
  -- ============================================================
  IF p_credit_type = 'pool' THEN
    SELECT value INTO v_raw FROM settings WHERE key = p_credit_id FOR UPDATE;
    BEGIN v_credit_before := v_raw::numeric; EXCEPTION WHEN OTHERS THEN
      BEGIN v_credit_before := (v_raw::json)::text::numeric;
      EXCEPTION WHEN OTHERS THEN v_credit_before := 0; END;
    END;
    v_credit_before := COALESCE(v_credit_before, 0);
    v_credit_after := v_credit_before + p_amount;
    IF v_credit_after < p_min_balance THEN
      RAISE EXCEPTION 'Insufficient pool balance for credit. Key: %, Current: %, Amount: %, Min: %',
        p_credit_id, v_credit_before, p_amount, p_min_balance;
    END IF;
    INSERT INTO settings (id, key, value, created_at, updated_at)
    VALUES (gen_random_uuid()::text, p_credit_id, v_credit_after::text, now(), now())
    ON CONFLICT (key) DO UPDATE SET value = v_credit_after::text, updated_at = now();
  ELSE
    EXECUTE format(
      'UPDATE %I SET balance = balance + $1 WHERE id = $2 AND balance + $1 >= $3 RETURNING balance - $1, balance',
      p_credit_table
    ) INTO v_credit_before, v_credit_after USING p_amount, p_credit_id, p_min_balance;
    IF v_credit_before IS NULL THEN
      RAISE EXCEPTION 'Credit failed: account not found or constraint violated (table: %, id: %)',
        p_credit_table, p_credit_id;
    END IF;
  END IF;

  -- ============================================================
  -- LEDGER ENTRIES (same DB transaction — atomic with balance changes)
  -- ============================================================
  INSERT INTO finance_ledger (
    id, journal_id, account_type, account_key, delta,
    balance_before, balance_after, reference_type, reference_id,
    description, created_by_id, created_at
  )
  VALUES (
    gen_random_uuid()::text, p_journal_id, v_debit_account_type, p_debit_id, -p_amount,
    v_debit_before, v_debit_after, p_reference_type, p_reference_id,
    p_debit_description, p_created_by_id, now()
  );

  INSERT INTO finance_ledger (
    id, journal_id, account_type, account_key, delta,
    balance_before, balance_after, reference_type, reference_id,
    description, created_by_id, created_at
  )
  VALUES (
    gen_random_uuid()::text, p_journal_id, v_credit_account_type, p_credit_id, p_amount,
    v_credit_before, v_credit_after, p_reference_type, p_reference_id,
    p_credit_description, p_created_by_id, now()
  );

  RETURN json_build_object(
    'debit_result', v_debit_after,
    'credit_result', v_credit_after,
    'debit_before', v_debit_before,
    'credit_before', v_credit_before
  );
END;
$$;

-- =============================================================================
-- 21. get_derived_pool_balances
-- Derives pool balances from finance_ledger entries via DB-side aggregation.
-- Called from: lib/finance-engine.ts:393
-- Params: none
-- Returns: json object { pool_key: balance, ... }
-- =============================================================================
DROP FUNCTION IF EXISTS get_derived_pool_balances();
CREATE OR REPLACE FUNCTION get_derived_pool_balances()
RETURNS json LANGUAGE plpgsql STABLE SECURITY DEFINER AS $$
DECLARE v_result json;
BEGIN
  SELECT COALESCE(
    (SELECT json_object_agg(t.account_key, t.total)
       FROM (
         SELECT account_key, round(SUM(delta)::numeric, 2) as total
         FROM finance_ledger WHERE account_type = 'pool'
         GROUP BY account_key
       ) t
    ), '{}'::json
  ) INTO v_result;
  RETURN v_result;
END;
$$;

-- =============================================================================
-- 22. get_derived_physical_balances
-- Derives physical account balances (bank/cashbox) from finance_ledger.
-- Called from: lib/finance-engine.ts:436
-- Params: none
-- Returns: json { bank: { id: balance, ... }, cashbox: { id: balance, ... } }
-- =============================================================================
DROP FUNCTION IF EXISTS get_derived_physical_balances();
CREATE OR REPLACE FUNCTION get_derived_physical_balances()
RETURNS json LANGUAGE plpgsql STABLE SECURITY DEFINER AS $$
DECLARE v_result json;
BEGIN
  SELECT json_build_object(
    'bank', COALESCE((
      SELECT json_object_agg(t.account_key, t.total)
      FROM (
        SELECT account_key, round(SUM(delta)::numeric, 2) as total
        FROM finance_ledger WHERE account_type = 'bank'
        GROUP BY account_key
      ) t
    ), '{}'::json),
    'cashbox', COALESCE((
      SELECT json_object_agg(t.account_key, t.total)
      FROM (
        SELECT account_key, round(SUM(delta)::numeric, 2) as total
        FROM finance_ledger WHERE account_type = 'cashbox'
        GROUP BY account_key
      ) t
    ), '{}'::json)
  ) INTO v_result;
  RETURN v_result;
END;
$$;

-- =============================================================================
-- 23. atomic_update_balance
-- Atomically updates balance on cash_boxes or bank_accounts.
-- Validates minimum balance constraint.
-- Called from: lib/atomic-ops.ts:20
-- Params: p_table text ('cash_boxes'|'bank_accounts'), p_id text,
--         p_delta numeric, p_min numeric DEFAULT 0
-- Returns: numeric (new balance)
-- =============================================================================
DROP FUNCTION IF EXISTS atomic_update_balance(text, text, numeric, numeric);
CREATE OR REPLACE FUNCTION atomic_update_balance(
  p_table text,
  p_id text,
  p_delta numeric,
  p_min numeric DEFAULT 0
)
RETURNS numeric LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_new_balance numeric;
  v_balance_col text;
BEGIN
  IF p_table = 'cash_boxes' OR p_table = 'bank_accounts' THEN
    v_balance_col := 'balance';
  ELSE
    RAISE EXCEPTION 'Unsupported table: %', p_table;
  END IF;

  EXECUTE format(
    'UPDATE %I SET balance = balance + $1 WHERE id = $2 AND balance + $1 >= $3 RETURNING balance',
    p_table
  ) INTO v_new_balance USING p_delta, p_id, p_min;

  IF v_new_balance IS NULL THEN
    RAISE EXCEPTION 'Insufficient balance or record not found';
  END IF;

  RETURN v_new_balance;
END;
$$;

-- =============================================================================
-- 24. atomic_update_setting_balance
-- Atomically updates a pool balance stored as a stringified number in settings.
-- Parses JSON or plain numeric value. Validates minimum balance constraint.
-- Called from: lib/atomic-ops.ts:41
-- Params: p_key text, p_delta numeric, p_min numeric DEFAULT 0
-- Returns: numeric (new balance)
-- =============================================================================
DROP FUNCTION IF EXISTS atomic_update_setting_balance(text, numeric, numeric);
CREATE OR REPLACE FUNCTION atomic_update_setting_balance(
  p_key text,
  p_delta numeric,
  p_min numeric DEFAULT 0
)
RETURNS numeric LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_current numeric;
  v_new_balance numeric;
  v_raw_value text;
BEGIN
  SELECT value INTO v_raw_value FROM settings WHERE key = p_key;

  BEGIN
    v_current := v_raw_value::numeric;
  EXCEPTION WHEN OTHERS THEN
    BEGIN
      v_current := (v_raw_value::json)::text::numeric;
    EXCEPTION WHEN OTHERS THEN
      v_current := 0;
    END;
  END;

  v_current := COALESCE(v_current, 0);
  v_new_balance := v_current + p_delta;

  IF v_new_balance < p_min THEN
    RAISE EXCEPTION 'Insufficient pool balance. Current: %, Attempted change: %',
      v_current, p_delta;
  END IF;

  INSERT INTO settings (id, key, value, created_at, updated_at)
  VALUES (gen_random_uuid()::text, p_key, v_new_balance::text, now(), now())
  ON CONFLICT (key) DO UPDATE SET value = v_new_balance::text, updated_at = now();

  RETURN v_new_balance;
END;
$$;

COMMIT;
