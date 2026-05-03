import { describe, it, expect, vi, beforeEach } from 'vitest';

// =====================================================================
// Utility Functions Tests
// =====================================================================

describe('Utility Functions', () => {
  describe('Currency Formatting', () => {
    it('should format Indonesian Rupiah correctly', () => {
      const format = (val: number) => new Intl.NumberFormat('id-ID').format(val);
      expect(format(1500000)).toBe('1.500.000');
      expect(format(100000)).toBe('100.000');
      expect(format(0)).toBe('0');
      expect(format(50000)).toBe('50.000');
      expect(format(1234567)).toBe('1.234.567');
    });

    it('should handle negative numbers', () => {
      const format = (val: number) => new Intl.NumberFormat('id-ID').format(val);
      expect(format(-100000)).toBe('-100.000');
    });

    it('should handle decimal numbers', () => {
      const format = (val: number) => new Intl.NumberFormat('id-ID').format(val);
      expect(format(1500.5)).toBe('1.500,5');
    });
  });

  describe('Date Formatting', () => {
    it('should format ISO date strings', () => {
      const d = new Date('2024-01-15T10:30:00');
      expect(d.toISOString().slice(0, 10)).toBe('2024-01-15');
      expect(d.toISOString().slice(11, 16)).toBe('10:30');
    });

    it('should format dates in Indonesian locale', () => {
      const fmtDate = (val: string | null | undefined) => {
        if (!val) return '-';
        try {
          return new Date(val).toLocaleDateString('id-ID', {
            day: '2-digit', month: '2-digit', year: 'numeric',
            hour: '2-digit', minute: '2-digit',
          });
        } catch { return val; }
      };
      expect(fmtDate('2024-06-15T08:30:00Z')).toBeTruthy();
      expect(fmtDate(null)).toBe('-');
      expect(fmtDate(undefined)).toBe('-');
    });
  });

  describe('String Operations', () => {
    it('should handle invoice number generation', () => {
      const now = new Date();
      const prefix = 'INV';
      const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '');
      const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
      const invoiceNo = `${prefix}-${dateStr}-${rand}`;
      expect(invoiceNo).toMatch(/^INV-\d{8}-[A-Z0-9]{4}$/);
    });

    it('should sanitize search queries', () => {
      const sanitize = (q: string) => q.replace(/'/g, "''").trim();
      expect(sanitize("John's")).toBe("John''s");
      expect(sanitize("  hello  ")).toBe('hello');
      expect(sanitize("normal")).toBe('normal');
    });

    it('should convert strings for CSV export', () => {
      const escapeCSV = (val: unknown): string => {
        if (val === null || val === undefined) return '';
        const str = String(val);
        if (str.includes(',') || str.includes('"') || str.includes('\n')) {
          return `"${str.replace(/"/g, '""')}"`;
        }
        return str;
      };
      expect(escapeCSV('hello')).toBe('hello');
      expect(escapeCSV('hello,world')).toBe('"hello,world"');
      expect(escapeCSV('say "hi"')).toBe('"say ""hi"""');
      expect(escapeCSV(null)).toBe('');
      expect(escapeCSV(undefined)).toBe('');
    });
  });

  describe('Array Operations', () => {
    it('should aggregate transaction data correctly', () => {
      const transactions = [
        { total: 100000, status: 'completed' },
        { total: 200000, status: 'completed' },
        { total: 50000, status: 'pending' },
        { total: 300000, status: 'completed' },
      ];

      const completed = transactions.filter(t => t.status === 'completed');
      const totalRevenue = completed.reduce((sum, t) => sum + t.total, 0);

      expect(completed.length).toBe(3);
      expect(totalRevenue).toBe(600000);
    });

    it('should group by payment method', () => {
      const transactions = [
        { payment_method: 'cash', total: 100000 },
        { payment_method: 'transfer', total: 200000 },
        { payment_method: 'cash', total: 150000 },
      ];

      const grouped: Record<string, number> = {};
      transactions.forEach(t => {
        const method = t.payment_method || 'unknown';
        grouped[method] = (grouped[method] || 0) + t.total;
      });

      expect(grouped.cash).toBe(250000);
      expect(grouped.transfer).toBe(200000);
    });

    it('should calculate running balances', () => {
      const payments = [50000, 30000, 20000];
      const total = 100000;
      let remaining = total;

      const balances = payments.map(p => {
        remaining -= p;
        return remaining;
      });

      expect(balances).toEqual([50000, 20000, 0]);
    });
  });
});

// =====================================================================
// Business Logic Tests
// =====================================================================

describe('Business Logic', () => {
  describe('Commission Calculation', () => {
    it('should calculate courier commission correctly', () => {
      const nearCommission = 5000;
      const farCommission = 10000;
      const deliveries = [
        { distance: 'near' },
        { distance: 'far' },
        { distance: 'near' },
      ];

      const total = deliveries.reduce((sum, d) => {
        return sum + (d.distance === 'far' ? farCommission : nearCommission);
      }, 0);

      expect(total).toBe(20000); // 2 near + 1 far
    });

    it('should calculate salary with deductions', () => {
      const baseSalary = 5000000;
      const allowances = { transport: 500000, meal: 300000 };
      const deductions = { bpjs_tk: 200000, bpjs_ks: 100000, absence: 50000 };

      const totalAllowance = Object.values(allowances).reduce((s, v) => s + v, 0);
      const totalDeduction = Object.values(deductions).reduce((s, v) => s + v, 0);
      const totalAmount = baseSalary + totalAllowance - totalDeduction;

      expect(totalAllowance).toBe(800000);
      expect(totalDeduction).toBe(350000);
      expect(totalAmount).toBe(5450000);
    });
  });

  describe('Cashback Calculation', () => {
    it('should calculate percentage cashback', () => {
      const transactionTotal = 200000;
      const cashbackPercent = 5;
      const maxCashback = 15000;

      let cashback = (transactionTotal * cashbackPercent) / 100;
      cashback = Math.min(cashback, maxCashback);
      cashback = Math.round(cashback);

      expect(cashback).toBe(10000);
    });

    it('should cap cashback at maximum', () => {
      const transactionTotal = 1000000;
      const cashbackPercent = 5;
      const maxCashback = 15000;

      let cashback = (transactionTotal * cashbackPercent) / 100;
      cashback = Math.min(cashback, maxCashback);
      cashback = Math.round(cashback);

      expect(cashback).toBe(15000); // Capped at max
    });

    it('should handle fixed cashback', () => {
      const transactionTotal = 100000;
      const fixedCashback = 10000;
      const minOrder = 50000;

      const cashback = transactionTotal >= minOrder ? fixedCashback : 0;
      expect(cashback).toBe(10000);
    });

    it('should not give cashback below minimum order', () => {
      const transactionTotal = 30000;
      const fixedCashback = 10000;
      const minOrder = 50000;

      const cashback = transactionTotal >= minOrder ? fixedCashback : 0;
      expect(cashback).toBe(0);
    });
  });

  describe('HPP & Profit Calculation', () => {
    it('should calculate HPP and profit per item', () => {
      const hpp = 50000; // Cost per unit
      const sellingPrice = 75000;
      const qty = 10;

      const totalHpp = hpp * qty;
      const subtotal = sellingPrice * qty;
      const profit = (sellingPrice - hpp) * qty;

      expect(totalHpp).toBe(500000);
      expect(subtotal).toBe(750000);
      expect(profit).toBe(250000);
    });

    it('should calculate profit margin percentage', () => {
      const sellingPrice = 75000;
      const hpp = 50000;

      const profit = sellingPrice - hpp;
      const marginPercent = (profit / sellingPrice) * 100;

      expect(marginPercent).toBeCloseTo(33.33, 1);
    });

    it('should handle unit conversions', () => {
      const conversionRate = 10; // 1 box = 10 pack
      const qtyInMainUnit = 3; // 3 boxes
      const qtyInSubUnit = qtyInMainUnit * conversionRate; // 30 packs

      expect(qtyInSubUnit).toBe(30);

      const pricePerMainUnit = 100000;
      const pricePerSubUnit = pricePerMainUnit / conversionRate;

      expect(pricePerSubUnit).toBe(10000);
    });
  });

  describe('Piutang (Receivable) Management', () => {
    it('should calculate overdue days', () => {
      const dueDate = new Date('2024-01-01');
      const now = new Date('2024-01-16');
      const diffMs = now.getTime() - dueDate.getTime();
      const overdueDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

      expect(overdueDays).toBe(15);
    });

    it('should track payment progress', () => {
      const totalAmount = 1000000;
      const payments = [300000, 200000];
      const paidAmount = payments.reduce((s, p) => s + p, 0);
      const remaining = totalAmount - paidAmount;
      const progressPercent = Math.round((paidAmount / totalAmount) * 100);

      expect(paidAmount).toBe(500000);
      expect(remaining).toBe(500000);
      expect(progressPercent).toBe(50);
    });
  });

  describe('Stock Management', () => {
    it('should deduct stock correctly', () => {
      let currentStock = 100;
      const orders = [
        { qty: 10 },
        { qty: 25 },
        { qty: 5 },
      ];

      orders.forEach(o => { currentStock -= o.qty; });
      expect(currentStock).toBe(60);
    });

    it('should detect low stock', () => {
      const products = [
        { name: 'Product A', stock: 5, minStock: 10 },
        { name: 'Product B', stock: 20, minStock: 10 },
        { name: 'Product C', stock: 10, minStock: 10 },
      ];

      const lowStock = products.filter(p => p.stock <= p.minStock);
      expect(lowStock.length).toBe(2);
      expect(lowStock.map(p => p.name)).toEqual(['Product A', 'Product C']);
    });
  });
});

// =====================================================================
// Validation Tests
// =====================================================================

describe('Validations', () => {
  describe('Email Validation', () => {
    const isValidEmail = (email: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

    it('should accept valid emails', () => {
      expect(isValidEmail('test@example.com')).toBe(true);
      expect(isValidEmail('user.name@company.co.id')).toBe(true);
    });

    it('should reject invalid emails', () => {
      expect(isValidEmail('invalid')).toBe(false);
      expect(isValidEmail('@domain.com')).toBe(false);
      expect(isValidEmail('user@')).toBe(false);
      expect(isValidEmail('')).toBe(false);
    });
  });

  describe('Phone Validation', () => {
    const isValidPhone = (phone: string) => {
      const digits = phone.replace(/\D/g, '');
      return digits.length >= 10 && digits.length <= 15;
    };

    it('should accept valid Indonesian phone numbers', () => {
      expect(isValidPhone('08123456789')).toBe(true);
      expect(isValidPhone('+628123456789')).toBe(true);
      expect(isValidPhone('6281234567890')).toBe(true);
    });

    it('should reject invalid phone numbers', () => {
      expect(isValidPhone('123')).toBe(false);
      expect(isValidPhone('')).toBe(false);
      expect(isValidPhone('abc')).toBe(false);
    });
  });
});

// =====================================================================
// Search & Filter Tests
// =====================================================================

describe('Search & Filtering', () => {
  const sampleProducts = [
    { id: '1', name: 'Beras Premium 5kg', sku: 'BR-001', category: 'Sembako', stock: 50, price: 75000 },
    { id: '2', name: 'Minyak Goreng 2L', sku: 'MG-001', category: 'Sembako', stock: 100, price: 35000 },
    { id: '3', name: 'Gula Pasir 1kg', sku: 'GP-001', category: 'Sembako', stock: 30, price: 15000 },
    { id: '4', name: 'Sabun Mandi', sku: 'SM-001', category: 'Kebutuhan RT', stock: 200, price: 5000 },
    { id: '5', name: 'Deterjen 900g', sku: 'DT-001', category: 'Kebutuhan RT', stock: 80, price: 12000 },
  ];

  it('should filter by search query', () => {
    const query = 'beras';
    const results = sampleProducts.filter(p =>
      p.name.toLowerCase().includes(query.toLowerCase()) ||
      p.sku.toLowerCase().includes(query.toLowerCase())
    );
    expect(results.length).toBe(1);
    expect(results[0].name).toBe('Beras Premium 5kg');
  });

  it('should filter by category', () => {
    const category = 'Sembako';
    const results = sampleProducts.filter(p => p.category === category);
    expect(results.length).toBe(3);
  });

  it('should combine filters', () => {
    const query = 'premium';
    const category = 'Sembako';
    const results = sampleProducts.filter(p =>
      p.category === category &&
      p.name.toLowerCase().includes(query.toLowerCase())
    );
    expect(results.length).toBe(1);
  });

  it('should sort by price ascending', () => {
    const sorted = [...sampleProducts].sort((a, b) => a.price - b.price);
    expect(sorted[0].name).toBe('Sabun Mandi');
    expect(sorted[sorted.length - 1].name).toBe('Beras Premium 5kg');
  });
});

// =====================================================================
// Pagination Tests
// =====================================================================

describe('Pagination', () => {
  const items = Array.from({ length: 53 }, (_, i) => ({ id: i + 1 }));

  it('should calculate total pages', () => {
    const totalItems = 53;
    const pageSize = 10;
    const totalPages = Math.ceil(totalItems / pageSize);
    expect(totalPages).toBe(6);
  });

  it('should slice items for page', () => {
    const page = 2;
    const pageSize = 10;
    const start = (page - 1) * pageSize;
    const end = start + pageSize;
    const pageItems = items.slice(start, end);
    expect(pageItems.length).toBe(10);
    expect(pageItems[0].id).toBe(11);
  });

  it('should handle last page with fewer items', () => {
    const page = 6;
    const pageSize = 10;
    const start = (page - 1) * pageSize;
    const end = start + pageSize;
    const pageItems = items.slice(start, end);
    expect(pageItems.length).toBe(3);
  });
});
