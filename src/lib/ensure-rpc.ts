// =====================================================================
// ENSURE RPC FUNCTIONS — Auto-deploys missing PostgreSQL RPC functions
// on server startup. Uses the session pool for DDL statements.
//
// Called from instrumentation.ts on server boot.
// Non-critical: failures are logged but don't block server start.
//
// Connection strategy:
//   1. SUPABASE_DB_URL (direct connection — may fail on IPv6-only hosts)
//   2. SUPABASE_POOLER_URL fallback — session-mode (port 5432 on pooler host)
//   3. SUPABASE_POOLER_URL fallback — transaction-mode (port 6543, last resort)
// =====================================================================

const RPC_DEFINITIONS: { name: string; sql: string }[] = [
  {
    name: 'decrement_stock',
    sql: `CREATE OR REPLACE FUNCTION decrement_stock(p_product_id text, p_qty numeric)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_new_stock numeric;
BEGIN
  UPDATE products SET global_stock = global_stock - p_qty
  WHERE id = p_product_id AND global_stock >= p_qty
  RETURNING global_stock INTO v_new_stock;
  IF NOT FOUND THEN RAISE EXCEPTION 'Stok tidak cukup untuk produk %', p_product_id; END IF;
END;
$$;`,
  },
  {
    name: 'increment_stock',
    sql: `CREATE OR REPLACE FUNCTION increment_stock(p_product_id text, p_qty numeric)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  UPDATE products SET global_stock = global_stock + p_qty WHERE id = p_product_id;
END;
$$;`,
  },
  {
    name: 'decrement_unit_stock',
    sql: `CREATE OR REPLACE FUNCTION decrement_unit_stock(p_unit_product_id text, p_qty numeric)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_new_stock numeric;
BEGIN
  UPDATE unit_products SET stock = stock - p_qty
  WHERE id = p_unit_product_id AND stock >= p_qty
  RETURNING stock INTO v_new_stock;
  IF NOT FOUND THEN RAISE EXCEPTION 'Stok unit tidak cukup (unit_product_id: %)', p_unit_product_id; END IF;
END;
$$;`,
  },
  {
    name: 'increment_unit_stock',
    sql: `CREATE OR REPLACE FUNCTION increment_unit_stock(p_unit_product_id text, p_qty numeric)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  UPDATE unit_products SET stock = stock + p_qty WHERE id = p_unit_product_id;
END;
$$;`,
  },
  {
    name: 'recalc_global_stock',
    sql: `CREATE OR REPLACE FUNCTION recalc_global_stock(p_product_id text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_total numeric;
BEGIN
  SELECT COALESCE(SUM(stock), 0) INTO v_total FROM unit_products WHERE product_id = p_product_id;
  UPDATE products SET global_stock = v_total WHERE id = p_product_id;
END;
$$;`,
  },
  {
    name: 'increment_stock_with_hpp',
    sql: `CREATE OR REPLACE FUNCTION increment_stock_with_hpp(p_product_id text, p_qty numeric, p_new_hpp numeric DEFAULT 0)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_current_stock numeric; v_current_hpp numeric; v_new_global_stock numeric; v_new_avg_hpp numeric;
BEGIN
  SELECT global_stock, avg_hpp INTO v_current_stock, v_current_hpp FROM products WHERE id = p_product_id;
  v_new_global_stock := COALESCE(v_current_stock, 0) + p_qty;
  IF p_qty > 0 AND p_new_hpp > 0 THEN
    v_new_avg_hpp := (COALESCE(v_current_stock, 0) * COALESCE(v_current_hpp, 0) + p_qty * p_new_hpp) / v_new_global_stock;
  ELSE v_new_avg_hpp := COALESCE(v_current_hpp, 0); END IF;
  UPDATE products SET global_stock = v_new_global_stock, avg_hpp = v_new_avg_hpp WHERE id = p_product_id;
END;
$$;`,
  },
  {
    name: 'atomic_update_balance',
    sql: `CREATE OR REPLACE FUNCTION atomic_update_balance(p_table text, p_id text, p_delta numeric, p_min numeric DEFAULT 0)
RETURNS numeric LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_new_balance numeric; v_balance_col text;
BEGIN
  IF p_table = 'cash_boxes' OR p_table = 'bank_accounts' THEN v_balance_col := 'balance';
  ELSE RAISE EXCEPTION 'Unsupported table: %', p_table; END IF;
  EXECUTE format('UPDATE %I SET balance = balance + $1 WHERE id = $2 AND balance + $1 >= $3 RETURNING balance', p_table)
    INTO v_new_balance USING p_delta, p_id, p_min;
  IF v_new_balance IS NULL THEN RAISE EXCEPTION 'Insufficient balance or record not found'; END IF;
  RETURN v_new_balance;
END;
$$;`,
  },
  {
    name: 'atomic_update_setting_balance',
    sql: `CREATE OR REPLACE FUNCTION atomic_update_setting_balance(p_key text, p_delta numeric, p_min numeric DEFAULT 0)
RETURNS numeric LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_current numeric; v_new_balance numeric; v_raw_value text;
BEGIN
  SELECT value INTO v_raw_value FROM settings WHERE key = p_key;
  BEGIN v_current := v_raw_value::numeric;
  EXCEPTION WHEN OTHERS THEN
    BEGIN v_current := (v_raw_value::json)::text::numeric;
    EXCEPTION WHEN OTHERS THEN v_current := 0; END;
  END;
  v_current := COALESCE(v_current, 0);
  v_new_balance := v_current + p_delta;
  IF v_new_balance < p_min THEN RAISE EXCEPTION 'Insufficient pool balance. Current: %, Attempted change: %', v_current, p_delta; END IF;
  INSERT INTO settings (id, key, value, created_at, updated_at) VALUES (gen_random_uuid()::text, p_key, v_new_balance::text, now(), now()) ON CONFLICT (key) DO UPDATE SET value = v_new_balance::text, updated_at = now();
  RETURN v_new_balance;
END;
$$;`,
  },
  // === Concurrency-fix RPCs ===
  {
    name: 'atomic_increment_customer_stats',
    sql: `CREATE OR REPLACE FUNCTION atomic_increment_customer_stats(p_customer_id text, p_order_delta integer DEFAULT 1, p_spent_delta numeric DEFAULT 0)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE customers
  SET total_orders = COALESCE(total_orders, 0) + p_order_delta,
      total_spent = COALESCE(total_spent, 0) + p_spent_delta,
      last_transaction_date = GREATEST(COALESCE(last_transaction_date, '1970-01-01'::timestamptz), NOW())
  WHERE id = p_customer_id;
END;
$$;`,
  },
  {
    name: 'decrement_unit_stock_recalc',
    sql: `CREATE OR REPLACE FUNCTION decrement_unit_stock_recalc(p_unit_product_id text, p_qty numeric)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_new_unit_stock numeric; v_new_global_stock numeric; v_product_id text;
BEGIN
  UPDATE unit_products SET stock = stock - p_qty
  WHERE id = p_unit_product_id AND stock >= p_qty
  RETURNING stock, product_id INTO v_new_unit_stock, v_product_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Stok unit tidak cukup (unit_product_id: %)', p_unit_product_id; END IF;
  SELECT COALESCE(SUM(stock), 0) INTO v_new_global_stock FROM unit_products WHERE product_id = v_product_id;
  UPDATE products SET global_stock = v_new_global_stock WHERE id = v_product_id;
  RETURN json_build_object('new_unit_stock', v_new_unit_stock, 'new_global_stock', v_new_global_stock, 'product_id', v_product_id);
END;
$$;`,
  },
  {
    name: 'batch_decrement_centralized_stock',
    sql: `CREATE OR REPLACE FUNCTION batch_decrement_centralized_stock(p_product_ids jsonb, p_quantities jsonb)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_results jsonb := '[]'::jsonb; v_pid text; v_qty numeric; v_new_stock numeric; v_idx integer;
BEGIN
  IF jsonb_array_length(p_product_ids) != jsonb_array_length(p_quantities) THEN
    RAISE EXCEPTION 'product_ids and quantities arrays must have the same length'; END IF;
  FOR v_idx IN 0 .. jsonb_array_length(p_product_ids) - 1 LOOP
    v_pid := p_product_ids->>v_idx; v_qty := (p_quantities->>v_idx)::numeric;
    SELECT global_stock INTO v_new_stock FROM products WHERE id = v_pid;
    IF v_new_stock IS NULL THEN RAISE EXCEPTION 'Produk tidak ditemukan: %', v_pid; END IF;
    IF v_new_stock < v_qty THEN RAISE EXCEPTION 'Stok tidak cukup untuk produk %. Tersedia: %, Dibutuhkan: %', v_pid, v_new_stock, v_qty; END IF;
  END LOOP;
  FOR v_idx IN 0 .. jsonb_array_length(p_product_ids) - 1 LOOP
    v_pid := p_product_ids->>v_idx; v_qty := (p_quantities->>v_idx)::numeric;
    UPDATE products SET global_stock = global_stock - v_qty WHERE id = v_pid RETURNING global_stock INTO v_new_stock;
    v_results := v_results || jsonb_build_object('product_id', v_pid, 'new_stock', v_new_stock);
  END LOOP;
  RETURN v_results;
END;
$$;`,
  },
  // === Courier Handover RPC ===
  {
    name: 'process_courier_handover',
    sql: `CREATE OR REPLACE FUNCTION process_courier_handover(
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
      -- 0. Always fetch courier name (needed for description regardless of courier_cash existence)
      SELECT name INTO v_courier_name FROM users WHERE id = p_courier_id;
      v_description := 'Setoran kurir' || CASE WHEN v_courier_name IS NOT NULL THEN ' ' || v_courier_name ELSE '' END;

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
        RAISE EXCEPTION 'Saldo kurir tidak cukup. Tersedia: %, Dibutuhkan: %', COALESCE(v_new_balance, 0), p_amount;
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
        -- Try any active cash_box in the unit
        SELECT id INTO v_cash_box_id FROM cash_boxes
          WHERE unit_id = p_unit_id AND is_active = true
          LIMIT 1;
      END IF;
      IF v_cash_box_id IS NULL THEN
        -- Create a default brankas
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

      -- 6. Create finance_request (type: courier_deposit, status: processed, payment_type: pay_now)
      INSERT INTO finance_requests (id, type, request_by_id, unit_id, amount, description, courier_id, goods_status, status, approved_by_id, approved_at, processed_by_id, processed_at, source_type, cash_box_id, payment_type, version, created_at, updated_at)
        VALUES (gen_random_uuid()::text, 'courier_deposit', p_processed_by_id, p_unit_id, p_amount,
                v_description,
                p_courier_id, 'received', 'processed',
                p_processed_by_id, now(), p_processed_by_id, now(),
                'cashbox', v_cash_box_id, 'pay_now', 1, now(), now())
        RETURNING id INTO v_finance_request_id;

      -- 7. Create courier_handover record
      INSERT INTO courier_handovers (id, courier_cash_id, amount, notes, status, finance_request_id, processed_by_id, processed_at, created_at, updated_at)
        VALUES (gen_random_uuid()::text, v_cash_id, p_amount, p_notes, 'processed', v_finance_request_id, p_processed_by_id, now(), now(), now())
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
    $$;`,
  },
  // === Cashback RPCs ===
  {
    name: 'atomic_add_cashback',
    sql: `CREATE OR REPLACE FUNCTION atomic_add_cashback(
      p_customer_id text,
      p_delta numeric,
      p_min numeric DEFAULT 0
    )
    RETURNS numeric LANGUAGE plpgsql SECURITY DEFINER AS $$
    DECLARE v_new_balance numeric;
    BEGIN
      UPDATE customers
      SET cashback_balance = COALESCE(cashback_balance, 0) + p_delta
      WHERE id = p_customer_id AND COALESCE(cashback_balance, 0) + p_delta >= p_min
      RETURNING cashback_balance INTO v_new_balance;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Saldo cashback tidak cukup atau customer tidak ditemukan';
      END IF;
      RETURN v_new_balance;
    END;
    $$;`,
  },
  {
    name: 'atomic_deduct_cashback',
    sql: `CREATE OR REPLACE FUNCTION atomic_deduct_cashback(
      p_customer_id text,
      p_delta numeric
    )
    RETURNS numeric LANGUAGE plpgsql SECURITY DEFINER AS $$
    DECLARE v_new_balance numeric;
    BEGIN
      UPDATE customers
      SET cashback_balance = COALESCE(cashback_balance, 0) - p_delta
      WHERE id = p_customer_id AND COALESCE(cashback_balance, 0) >= p_delta
      RETURNING cashback_balance INTO v_new_balance;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Saldo cashback tidak cukup atau customer tidak ditemukan';
      END IF;
      RETURN v_new_balance;
    END;
    $$;`,
  },
  // === Courier Cash RPCs ===
  {
    name: 'atomic_add_courier_cash',
    sql: `CREATE OR REPLACE FUNCTION atomic_add_courier_cash(
      p_courier_id text,
      p_unit_id text,
      p_delta numeric
    )
    RETURNS numeric LANGUAGE plpgsql SECURITY DEFINER AS $$
    DECLARE v_id text; v_new_balance numeric;
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
    $$;`,
  },
  {
    name: 'get_courier_cash_totals',
    sql: `CREATE OR REPLACE FUNCTION get_courier_cash_totals(
      p_unit_id text DEFAULT NULL
    )
    RETURNS json LANGUAGE plpgsql STABLE SECURITY DEFINER AS $$
    DECLARE result json;
    BEGIN
      SELECT json_build_object(
        'total_balance',     COALESCE(SUM(balance), 0),
        'total_collected',   COALESCE(SUM(total_collected), 0),
        'total_handover',    COALESCE(SUM(total_handover), 0),
        'courier_count',     COUNT(DISTINCT courier_id)
      ) INTO result
      FROM courier_cash
      WHERE (p_unit_id IS NULL OR unit_id = p_unit_id);
      RETURN result;
    END;
    $$;`,
  },
  // === Cancel: Atomic reverse purchase stock with HPP ===
  {
    name: 'reverse_purchase_stock_with_hpp',
    sql: `CREATE OR REPLACE FUNCTION reverse_purchase_stock_with_hpp(
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

      v_old_stock := COALESCE(v_old_stock, 0);
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
        v_total_value := v_old_stock * v_old_avg_hpp;
        v_removed_value := p_qty * COALESCE(p_original_hpp, 0);
        v_new_avg_hpp := GREATEST(0, ROUND((v_total_value - v_removed_value) / v_new_stock));
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
    $$;`,
  },
  // === Finance Aggregate RPCs ===
  {
    name: 'get_sale_totals_aggregate',
    sql: `CREATE OR REPLACE FUNCTION get_sale_totals_aggregate()
RETURNS json LANGUAGE plpgsql STABLE SECURITY DEFINER AS $$
DECLARE v_hpp_paid numeric; v_profit_paid numeric; v_total numeric;
BEGIN
  SELECT COALESCE(SUM(hpp_paid), 0), COALESCE(SUM(profit_paid), 0), COALESCE(SUM(total), 0)
    INTO v_hpp_paid, v_profit_paid, v_total
  FROM transactions WHERE type = 'sale';
  RETURN json_build_object('hpp_paid', v_hpp_paid, 'profit_paid', v_profit_paid, 'total', v_total);
END;
$$;`,
  },
  {
    name: 'get_physical_balance_totals',
    sql: `CREATE OR REPLACE FUNCTION get_physical_balance_totals()
RETURNS json LANGUAGE plpgsql STABLE SECURITY DEFINER AS $$
DECLARE v_brankas numeric; v_rekening numeric;
BEGIN
  SELECT COALESCE(SUM(balance), 0) INTO v_brankas FROM cash_boxes WHERE is_active IS NOT FALSE;
  SELECT COALESCE(SUM(balance), 0) INTO v_rekening FROM bank_accounts WHERE is_active IS NOT FALSE;
  RETURN json_build_object('total_brankas', v_brankas, 'total_rekening', v_rekening, 'total_physical', v_brankas + v_rekening);
END;
$$;`,
  },
  {
    name: 'finance_reconcile',
    sql: `CREATE OR REPLACE FUNCTION finance_reconcile(p_auto_fix boolean DEFAULT false)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_stored_hpp numeric; v_stored_profit numeric; v_stored_lain numeric;
  v_raw text;
  v_derived_hpp numeric; v_derived_profit numeric;
  v_brankas numeric; v_rekening numeric; v_physical numeric;
  v_hpp_diff numeric; v_profit_diff numeric; v_pool_total numeric;
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
  SELECT COALESCE(SUM(balance), 0) INTO v_brankas FROM cash_boxes WHERE is_active IS NOT FALSE;
  SELECT COALESCE(SUM(balance), 0) INTO v_rekening FROM bank_accounts WHERE is_active IS NOT FALSE;
  v_physical := v_brankas + v_rekening;
  v_pool_total := v_stored_hpp + v_stored_profit + v_stored_lain;
  
  -- Build issues array
  v_hpp_diff := v_stored_hpp - v_derived_hpp;
  v_profit_diff := v_stored_profit - v_derived_profit;
  
  IF ABS(v_hpp_diff) > 0.01 THEN
    v_issues := v_issues || jsonb_build_object('type', 'hpp_mismatch', 'stored', v_stored_hpp, 'derived', v_derived_hpp, 'diff', v_hpp_diff);
  END IF;
  IF ABS(v_profit_diff) > 0.01 THEN
    v_issues := v_issues || jsonb_build_object('type', 'profit_mismatch', 'stored', v_stored_profit, 'derived', v_derived_profit, 'diff', v_profit_diff);
  END IF;
  IF ABS(v_pool_total - v_physical) > 0.01 THEN
    v_issues := v_issues || jsonb_build_object('type', 'pool_physical_mismatch', 'pool_total', v_pool_total, 'physical_total', v_physical, 'diff', v_pool_total - v_physical);
  END IF;
  
  -- Auto-fix if requested
  IF p_auto_fix AND jsonb_array_length(v_issues) > 0 THEN
    INSERT INTO settings (id, key, value, created_at, updated_at) VALUES (gen_random_uuid()::text, 'pool_hpp_paid_balance', v_derived_hpp::text, now(), now()) ON CONFLICT (key) DO UPDATE SET value = v_derived_hpp::text, updated_at = now();
    INSERT INTO settings (id, key, value, created_at, updated_at) VALUES (gen_random_uuid()::text, 'pool_profit_paid_balance', v_derived_profit::text, now(), now()) ON CONFLICT (key) DO UPDATE SET value = v_derived_profit::text, updated_at = now();
    v_stored_lain := GREATEST(0, v_physical - v_derived_hpp - v_derived_profit);
    INSERT INTO settings (id, key, value, created_at, updated_at) VALUES (gen_random_uuid()::text, 'pool_investor_fund', v_stored_lain::text, now(), now()) ON CONFLICT (key) DO UPDATE SET value = v_stored_lain::text, updated_at = now();
  END IF;
  
  RETURN json_build_object(
    'stored_hpp', v_stored_hpp, 'stored_profit', v_stored_profit, 'stored_lain_lain', v_stored_lain,
    'derived_hpp', v_derived_hpp, 'derived_profit', v_derived_profit,
    'physical', v_physical, 'brankas', v_brankas, 'rekening', v_rekening,
    'pool_total', v_stored_hpp + v_stored_profit + v_stored_lain,
    'issues_count', jsonb_array_length(v_issues),
    'issues', v_issues,
    'auto_fixed', p_auto_fix AND jsonb_array_length(v_issues) > 0,
    'is_healthy', jsonb_array_length(v_issues) = 0
  );
END;
$$;`,
  },
  // === Finance Atomicity RPCs ===
  {
    name: 'atomic_double_entry',
    sql: `CREATE OR REPLACE FUNCTION atomic_double_entry(
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
  -- DEBIT: atomically deduct and capture before/after in one step
  -- No TOCTOU window — balance is read and written atomically
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
      RAISE EXCEPTION 'Insufficient pool balance for debit. Key: %, Current: %, Attempted debit: %, Min: %',
        p_debit_id, v_debit_before, p_amount, p_min_balance;
    END IF;
    INSERT INTO settings (id, key, value, created_at, updated_at)
      VALUES (gen_random_uuid()::text, p_debit_id, v_debit_after::text, now(), now())
      ON CONFLICT (key) DO UPDATE SET value = v_debit_after::text, updated_at = now();
  ELSE
    -- Physical account: single atomic UPDATE with RETURNING captures before/after
    -- RETURNING balance + $1 = before_balance (old value), balance = after_balance (new value)
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
  -- CREDIT: atomically add and capture before/after in one step
  -- If credit fails, the entire function (including debit) rolls back
  -- because PL/pgSQL runs in a single DB transaction.
  -- ============================================================
  IF p_credit_type = 'pool' THEN
    -- Lock the settings row FOR UPDATE to prevent concurrent modification
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
    -- Physical account: single atomic UPDATE with RETURNING captures before/after
    -- RETURNING balance - $1 = before_balance (old value), balance = after_balance (new value)
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
  INSERT INTO finance_ledger (id, journal_id, account_type, account_key, delta, balance_before, balance_after, reference_type, reference_id, description, created_by_id, created_at)
  VALUES (gen_random_uuid()::text, p_journal_id, v_debit_account_type, p_debit_id, -p_amount,
          v_debit_before, v_debit_after, p_reference_type, p_reference_id, p_debit_description, p_created_by_id, now());

  INSERT INTO finance_ledger (id, journal_id, account_type, account_key, delta, balance_before, balance_after, reference_type, reference_id, description, created_by_id, created_at)
  VALUES (gen_random_uuid()::text, p_journal_id, v_credit_account_type, p_credit_id, p_amount,
          v_credit_before, v_credit_after, p_reference_type, p_reference_id, p_credit_description, p_created_by_id, now());

  RETURN json_build_object(
    'debit_result', v_debit_after,
    'credit_result', v_credit_after,
    'debit_before', v_debit_before,
    'credit_before', v_credit_before
  );
END;
$$;`,
  },
  {
    name: 'get_derived_pool_balances',
    sql: `CREATE OR REPLACE FUNCTION get_derived_pool_balances()
RETURNS json LANGUAGE plpgsql STABLE SECURITY DEFINER AS $$
DECLARE v_result json;
BEGIN
  SELECT COALESCE(
    (SELECT json_object_agg(t.account_key, t.total)
       FROM (SELECT account_key, round(SUM(delta)::numeric, 2) as total FROM finance_ledger WHERE account_type = 'pool' GROUP BY account_key) t),
    '{}'::json
  ) INTO v_result;
  RETURN v_result;
END;
$$;`,
  },
  {
    name: 'get_derived_physical_balances',
    sql: `CREATE OR REPLACE FUNCTION get_derived_physical_balances()
RETURNS json LANGUAGE plpgsql STABLE SECURITY DEFINER AS $$
DECLARE v_result json;
BEGIN
  SELECT json_build_object(
    'bank', COALESCE((SELECT json_object_agg(t.account_key, t.total)
                        FROM (SELECT account_key, round(SUM(delta)::numeric, 2) as total FROM finance_ledger WHERE account_type = 'bank' GROUP BY account_key) t), '{}'::json),
    'cashbox', COALESCE((SELECT json_object_agg(t.account_key, t.total)
                          FROM (SELECT account_key, round(SUM(delta)::numeric, 2) as total FROM finance_ledger WHERE account_type = 'cashbox' GROUP BY account_key) t), '{}'::json)
  ) INTO v_result;
  RETURN v_result;
END;
$$;`,
  },
  // === Database Stats RPC ===
  {
    name: 'get_supabase_stats',
    sql: `CREATE OR REPLACE FUNCTION get_supabase_stats()
RETURNS json LANGUAGE plpgsql STABLE SECURITY DEFINER AS $$
DECLARE
  v_db_size_bytes bigint;
  v_index_size_bytes bigint;
  v_pg_version text;
  v_db_name text;
  v_table_sizes json;
  v_top_tables json;
  v_xact_commit bigint;
  v_xact_rollback bigint;
  v_blks_read bigint;
  v_blks_hit bigint;
BEGIN
  -- Total database size
  SELECT pg_database_size(current_database()) INTO v_db_size_bytes;

  -- Total index size across all user tables
  SELECT COALESCE(SUM(pg_relation_size(indexrelid)), 0) INTO v_index_size_bytes
  FROM pg_index
  JOIN pg_class ON pg_class.oid = pg_index.indexrelid
  JOIN pg_namespace ON pg_namespace.oid = pg_class.relnamespace
  WHERE pg_namespace.nspname = 'public';

  -- PostgreSQL version
  SELECT version() INTO v_pg_version;

  -- Database name
  SELECT current_database() INTO v_db_name;

  -- pg_stat_database stats
  SELECT xact_commit, xact_rollback, blks_read, blks_hit
  INTO v_xact_commit, v_xact_rollback, v_blks_read, v_blks_hit
  FROM pg_stat_database WHERE datname = current_database();

  -- Table sizes with row counts (from pg_stat_user_tables)
  SELECT COALESCE(json_agg(row_to_json(t)), '[]'::json) INTO v_table_sizes
  FROM (
    SELECT
      relname AS table_name,
      COALESCE(n_live_tup, 0) AS row_count
    FROM pg_stat_user_tables
    WHERE schemaname = 'public'
    ORDER BY n_live_tup DESC NULLS LAST
  ) t;

  -- Top tables by total size (data + indexes + toast)
  SELECT COALESCE(json_agg(row_to_json(t)), '[]'::json) INTO v_top_tables
  FROM (
    SELECT
      schemaname AS schema,
      relname AS table_name,
      pg_total_relation_size(relid) AS size_bytes,
      pg_relation_size(relid) AS data_size_bytes,
      pg_indexes_size(relid) AS index_size_bytes,
      pg_total_relation_size(relid) AS total_size_bytes
    FROM pg_catalog.pg_statio_user_tables
    WHERE schemaname = 'public'
    ORDER BY pg_total_relation_size(relid) DESC
    LIMIT 20
  ) t;

  RETURN json_build_object(
    'db_size_bytes', v_db_size_bytes,
    'index_size_bytes', v_index_size_bytes,
    'pg_version', v_pg_version,
    'db_name', v_db_name,
    'xact_commit', v_xact_commit,
    'xact_rollback', v_xact_rollback,
    'blks_read', v_blks_read,
    'blks_hit', v_blks_hit,
    'table_sizes', v_table_sizes,
    'top_tables', v_top_tables
  );
END;
$$;`,
  },
  // === Ensure id column DEFAULT gen_random_uuid()::text on all tables ===
  {
    name: 'ensure_id_defaults',
    sql: `CREATE OR REPLACE FUNCTION ensure_id_defaults()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'custom_roles', 'units', 'users', 'password_resets', 'products', 'unit_products',
    'customers', 'user_units', 'payment_proofs', 'customer_follow_ups', 'suppliers',
    'transactions', 'transaction_items', 'payments', 'salary_payments', 'bank_accounts',
    'cash_boxes', 'finance_requests', 'fund_transfers', 'company_debts',
    'company_debt_payments', 'receivables', 'receivable_follow_ups', 'logs',
    'sales_targets', 'sales_tasks', 'sales_task_reports', 'courier_cash',
    'courier_handovers', 'events', 'settings', 'cashback_config', 'cashback_log',
    'cashback_withdrawal', 'customer_prices', 'customer_referral',
    'finance_ledger'
  ];
  col_exists boolean;
BEGIN
  FOREACH t IN ARRAY tables LOOP
    -- Check if table has an 'id' column of type text without a default
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = t AND column_name = 'id'
    ) INTO col_exists;

    IF col_exists THEN
      -- Set default to gen_random_uuid()::text (idempotent - SET DEFAULT replaces any existing default)
      BEGIN
        EXECUTE format('ALTER TABLE %I ALTER COLUMN id SET DEFAULT gen_random_uuid()::text', t);
        RAISE NOTICE 'Set id default for table %', t;
      EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'Could not set id default for table %: %', t, SQLERRM;
      END;
    END IF;
  END LOOP;
END;
$$;`,
  },
  // === Row Level Security — Enable RLS on all tables + create policies ===
  {
    name: 'enable_rls_all_tables',
    sql: `CREATE OR REPLACE FUNCTION enable_rls_all_tables()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'custom_roles', 'units', 'users', 'password_resets', 'products', 'unit_products',
    'customers', 'user_units', 'payment_proofs', 'customer_follow_ups', 'suppliers',
    'transactions', 'transaction_items', 'payments', 'salary_payments', 'bank_accounts',
    'cash_boxes', 'finance_requests', 'fund_transfers', 'company_debts',
    'company_debt_payments', 'receivables', 'receivable_follow_ups', 'logs',
    'sales_targets', 'sales_tasks', 'sales_task_reports', 'courier_cash',
    'courier_handovers', 'events', 'settings', 'cashback_config', 'cashback_log',
    'cashback_withdrawal', 'customer_prices', 'customer_referral'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    -- Enable RLS (idempotent — re-running is safe)
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);

    -- Drop existing policies for idempotency (CREATE POLICY has no IF NOT EXISTS)
    EXECUTE format('DROP POLICY IF EXISTS service_role_full_access ON %I', t);
    EXECUTE format('DROP POLICY IF EXISTS authenticated_read ON %I', t);

    -- service_role key: full access (read, write, update, delete)
    EXECUTE format(
      'CREATE POLICY service_role_full_access ON %I FOR ALL TO service_role USING (true) WITH CHECK (true)',
      t
    );

    -- authenticated users: read-only access
    EXECUTE format(
      'CREATE POLICY authenticated_read ON %I FOR SELECT TO authenticated USING (true)',
      t
    );
  END LOOP;
END;
$$;`,
  },
];

export { RPC_DEFINITIONS };

/**
 * Build a list of connection URLs to try, in priority order.
 * 1. Direct DB URL (SUPABASE_DB_URL) — fastest, but may fail on IPv6-only hosts
 * 2. Session-mode pooler (port 5432 on pooler host) — DDL-safe, IPv4 through AWS
 * 3. Transaction-mode pooler (port 6543, the original SUPABASE_POOLER_URL) — last resort
 */
function getConnectionStringCandidates(): { url: string; label: string }[] {
  const candidates: { url: string; label: string }[] = [];

  const directUrl = process.env.SUPABASE_DB_URL;
  if (directUrl) {
    candidates.push({ url: directUrl, label: 'direct (SUPABASE_DB_URL)' });
  }

  const poolerUrl = process.env.SUPABASE_POOLER_URL;
  if (poolerUrl) {
    // Session-mode pooler: same host, change port 6543 → 5432
    const sessionModeUrl = poolerUrl.replace(/:6543\//, ':5432/');
    if (sessionModeUrl !== poolerUrl) {
      candidates.push({ url: sessionModeUrl, label: 'session-mode pooler (port 5432)' });
    }
    // Transaction-mode pooler as last resort
    candidates.push({ url: poolerUrl, label: 'transaction-mode pooler (port 6543)' });
  }

  // Fallback: use Prisma's DATABASE_URL / DIRECT_URL (remove pgbouncer params for pg module)
  const fallbackUrl = process.env.DIRECT_URL || process.env.DATABASE_URL;
  if (fallbackUrl && candidates.length === 0) {
    // Session-mode pooler: change port 6543 → 5432, remove pgbouncer param
    let cleanUrl = fallbackUrl.replace(/:6543\//, ':5432/');
    cleanUrl = cleanUrl.replace(/[?&]pgbouncer=true/gi, '');
    candidates.push({ url: cleanUrl, label: 'session-mode from DATABASE_URL (port 5432)' });
    // Transaction-mode fallback
    let txUrl = fallbackUrl.replace(/[?&]pgbouncer=true/gi, '');
    candidates.push({ url: txUrl, label: 'transaction-mode from DATABASE_URL (port 6543)' });
  }

  return candidates;
}

/**
 * Extract function signature from CREATE OR REPLACE FUNCTION ... RETURNS ... for DROP statement.
 * Falls back to function name only if signature can't be parsed.
 */
function extractDropSignature(sql: string, funcName: string): string {
  // Match: FUNCTION name(params) RETURNS
  const match = sql.match(/FUNCTION\s+\w+\(([^)]*)\)\s*RETURNS/i);
  if (match) {
    return `${funcName}(${match[1].trim()})`;
  }
  return funcName;
}

/**
 * Attempt to deploy all RPC functions using the given connection string.
 * Uses DROP + CREATE pattern to handle return type changes.
 * Returns { deployed, failed } counts.
 */
async function deployWithConnectionString(connString: string): Promise<{ deployed: number; failed: number }> {
  let deployed = 0;
  let failed = 0;

  const { Pool } = await import('pg');
  const pool = new Pool({
    connectionString: connString,
    ssl: { rejectUnauthorized: false },
    max: 2,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 15_000,
  });

  const client = await pool.connect();
  try {
    for (const rpc of RPC_DEFINITIONS) {
      try {
        // First try CREATE OR REPLACE (fast path for same return type)
        await client.query(rpc.sql);
        deployed++;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        // If "cannot change return type", DROP and recreate
        if (msg.includes('cannot change return type')) {
          try {
            const sig = extractDropSignature(rpc.sql, rpc.name);
            await client.query(`DROP FUNCTION IF EXISTS ${sig} CASCADE;`);
            await client.query(rpc.sql);
            console.log(`[ensure-rpc] Recreated ${rpc.name} (return type changed)`);
            deployed++;
          } catch (retryErr: unknown) {
            const retryMsg = retryErr instanceof Error ? retryErr.message : String(retryErr);
            failed++;
            console.warn(`[ensure-rpc] Failed to recreate ${rpc.name}: ${retryMsg.substring(0, 120)}`);
          }
        } else {
          failed++;
          console.warn(`[ensure-rpc] Failed to deploy ${rpc.name}: ${msg.substring(0, 120)}`);
        }
      }
    }

    // Notify PostgREST to reload schema cache
    try {
      await client.query("NOTIFY pgrst, 'reload schema'");
    } catch {
      // Non-critical
    }
  } finally {
    client.release();
    await pool.end();
  }

  return { deployed, failed };
}

export async function ensureRpcFunctions(): Promise<void> {
  const candidates = getConnectionStringCandidates();

  if (candidates.length === 0) {
    console.log('[ensure-rpc] No database URL configured (SUPABASE_DB_URL / SUPABASE_POOLER_URL / DATABASE_URL), skipping RPC deployment.');
    return;
  }

  let deployed = 0;
  let failed = 0;
  let connected = false;

  for (const { url, label } of candidates) {
    try {
      console.log(`[ensure-rpc] Trying ${label}...`);
      const result = await deployWithConnectionString(url);
      deployed = result.deployed;
      failed = result.failed;
      connected = true;
      console.log(`[ensure-rpc] Connected via ${label}.`);
      break;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[ensure-rpc] ${label} failed: ${msg.substring(0, 120)}`);
    }
  }

  if (!connected) {
    console.error('[ensure-rpc] All connection methods failed. RPC functions were NOT deployed.');
  } else {
    console.log(`[ensure-rpc] Deployed ${deployed}/${RPC_DEFINITIONS.length} RPC functions${failed > 0 ? ` (${failed} failed)` : ''}`);
  }
}
