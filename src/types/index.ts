// Core Types for Razkindo ERP

export type UserRole = 'super_admin' | 'sales' | 'kurir' | 'keuangan';
export type UserStatus = 'pending' | 'approved' | 'rejected';
export type TransactionType = 'sale' | 'purchase' | 'expense' | 'salary';
export type TransactionStatus = 'pending' | 'approved' | 'paid' | 'cancelled';
export type PaymentStatus = 'unpaid' | 'partial' | 'paid';
export type PaymentMethod = 'cash' | 'transfer' | 'giro';
export type TransactionPaymentMethod = 'cash' | 'piutang' | 'tempo';
export type OnlineStatus = 'online' | 'idle' | 'offline';

// User
export interface User {
  id: string;
  email: string;
  name: string;
  phone?: string;
  role: UserRole;
  unitId?: string;
  unit?: Unit;
  userUnits?: Unit[];  // Multi-unit assignment (from user_units junction table)
  status: UserStatus;
  avatar?: string;
  lastSeenAt?: Date;
  currentPage?: string;
  lastAction?: string;
  isActive: boolean;
  canLogin: boolean;
  nearCommission: number;
  farCommission: number;
  createdAt: Date;
  updatedAt: Date;
}

// Unit
export interface Unit {
  id: string;
  name: string;
  address?: string;
  phone?: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

// Product
export interface Product {
  id: string;
  name: string;
  sku?: string;
  description?: string;
  category?: string;
  unit?: string;
  subUnit?: string;
  conversionRate: number;
  globalStock: number;
  avgHpp: number;
  sellingPrice: number;
  sellPricePerSubUnit: number;
  minStock: number;
  stockType: 'centralized' | 'per_unit';
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  unitProducts?: UnitProduct[];
  effectiveStock?: number;
  unitStock?: number;
  hasAccess?: boolean;
  imageUrl?: string;
  trackStock?: boolean;
}

export interface UnitProduct {
  id: string;
  unitId: string;
  productId: string;
  stock: number;
  createdAt: Date;
  updatedAt: Date;
  unit?: Unit;
  product?: Product;
}

// Customer
export interface Customer {
  id: string;
  name: string;
  phone?: string;
  email?: string;
  address?: string;
  unitId: string;
  unit?: Unit;
  notes?: string;
  distance: string;
  totalOrders: number;
  totalSpent: number;
  status: 'active' | 'lost' | 'inactive';
  assignedToId?: string;
  assignedTo?: User;
  lastTransactionDate?: Date;
  lastFollowUpDate?: Date;
  lostAt?: Date;
  lostReason?: string;
  code?: string;
  cashbackBalance: number;
  cashbackType?: 'percentage' | 'nominal';
  cashbackValue?: number;
  createdAt: Date;
  updatedAt: Date;
}

// Supplier
export interface Supplier {
  id: string;
  name: string;
  phone?: string;
  email?: string;
  address?: string;
  bankName?: string;
  bankAccount?: string;
  notes?: string;
  totalPurchase: number;
  totalPaid: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

// Transaction Item
export interface TransactionItem {
  id: string;
  transactionId: string;
  productId: string;
  productName: string;
  qty: number;
  qtyInSubUnit: number;
  qtyUnitType: 'main' | 'sub';
  price: number;
  hpp: number;
  subtotal: number;
  profit: number;
  product?: Product;
}

// Transaction
export interface Transaction {
  id: string;
  type: TransactionType;
  invoiceNo: string;
  unitId: string;
  createdById: string;
  customerId?: string;
  supplierId?: string;
  courierId?: string;
  total: number;
  paidAmount: number;
  remainingAmount: number;
  totalHpp: number;
  totalProfit: number;
  hppPaid: number;
  profitPaid: number;
  hppUnpaid: number;
  profitUnpaid: number;
  paymentMethod?: TransactionPaymentMethod;
  status: TransactionStatus;
  paymentStatus: PaymentStatus;
  dueDate?: Date;
  deliveredAt?: Date;
  notes?: string;
  deliveryAddress?: string;
  transactionDate: Date;
  createdAt: Date;
  updatedAt: Date;
  unit?: Unit;
  createdBy?: User;
  courierCommission: number;
  deliveryDistance?: string;
  courier?: User;
  customer?: Customer;
  supplier?: Supplier;
  items?: TransactionItem[];
  payments?: Payment[];
}

// Payment
export interface Payment {
  id: string;
  transactionId: string;
  receivedById: string;
  amount: number;
  paymentMethod: PaymentMethod;
  bankName?: string;
  accountNo?: string;
  referenceNo?: string;
  notes?: string;
  hppPortion: number;
  profitPortion: number;
  paidAt: Date;
  createdAt: Date;
  transaction?: Transaction;
  receivedBy?: User;
  cashBoxId?: string;
  cashBox?: { id: string; name: string };
  bankAccountId?: string;
  bankAccount?: { id: string; name: string };
}

// Salary Payment
export interface SalaryPayment {
  id: string;
  userId: string;
  periodStart: Date;
  periodEnd: Date;
  baseSalary: number;
  transportAllowance: number;
  mealAllowance: number;
  overtimePay: number;
  incentive: number;
  otherAllowance: number;
  bonus: number;
  bpjsTk: number;
  bpjsKs: number;
  pph21: number;
  loanDeduction: number;
  absenceDeduction: number;
  lateDeduction: number;
  otherDeduction: number;
  deduction: number;
  totalAllowance: number;
  totalDeduction: number;
  totalAmount: number;
  sourceType: 'hpp_hand' | 'profit_hand' | 'cash' | 'bank' | 'cashbox';
  sourceUnitId?: string;
  bankAccountId?: string;
  cashBoxId?: string;
  financeRequestId?: string;
  status: 'pending' | 'approved' | 'paid' | 'rejected';
  approvedById?: string;
  approvedAt?: Date;
  paidAt?: Date;
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
  user?: User;
  cashBox?: CashBox;
  financeRequest?: FinanceRequest;
}

// Bank Account
export interface BankAccount {
  id: string;
  name: string;
  bankName: string;
  accountNo: string;
  accountHolder: string;
  branch?: string;
  balance: number;
  isActive: boolean;
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}

// Cash Box (Brankas)
export interface CashBox {
  id: string;
  name: string;
  unitId?: string;
  balance: number;
  isActive: boolean;
  notes?: string;
  unit?: Unit;
  createdAt: Date;
  updatedAt: Date;
}

// Finance Request
export interface FinanceRequest {
  id: string;
  type: 'purchase' | 'salary' | 'expense' | 'courier_deposit' | 'cash_to_bank';
  requestById: string;
  unitId?: string;
  amount: number;
  description: string;
  supplierId?: string;
  purchaseItems?: string;
  transactionId?: string;
  courierId?: string;
  goodsStatus: 'pending' | 'received' | 'partial';
  status: 'pending' | 'approved' | 'rejected' | 'processed';
  approvedById?: string;
  approvedAt?: Date;
  processedById?: string;
  processedAt?: Date;
  fundSource?: 'hpp_paid' | 'profit_unpaid';
  sourceType?: 'hpp_hand' | 'profit_hand' | 'bank' | 'cashbox';
  sourceAccountId?: string;
  bankAccountId?: string;
  cashBoxId?: string;
  paymentType?: 'debt' | 'pay_now';
  forcePayNow?: boolean;
  fromCashBoxId?: string;
  toBankAccountId?: string;
  notes?: string;
  rejectionReason?: string;
  createdAt: Date;
  updatedAt: Date;
  supplier?: Supplier;
  transaction?: Transaction;
  bankAccount?: BankAccount;
  cashBox?: CashBox;
  salaryPayment?: SalaryPayment;
}

// Fund Transfer
export interface FundTransfer {
  id: string;
  type: 'cash_to_bank' | 'bank_to_bank' | 'bank_to_cash' | 'cash_to_cash';
  fromBankAccountId?: string;
  toBankAccountId?: string;
  fromCashBoxId?: string;
  toCashBoxId?: string;
  amount: number;
  description?: string;
  referenceNo?: string;
  status: 'pending' | 'completed' | 'cancelled';
  processedById?: string;
  processedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
  fromBankAccount?: BankAccount;
  toBankAccount?: BankAccount;
  fromCashBox?: CashBox;
  toCashBox?: CashBox;
}

// Company Debt (Hutang Perusahaan)
export interface CompanyDebt {
  id: string;
  creditorName: string;
  debtType: 'supplier' | 'investor' | 'other';
  description?: string;
  totalAmount: number;
  paidAmount: number;
  remainingAmount: number;
  dueDate?: Date;
  status: 'active' | 'paid' | 'cancelled';
  isActive: boolean;
  notes?: string;
  createdById?: string;
  createdAt: Date;
  updatedAt: Date;
  payments?: CompanyDebtPayment[];
}

// Company Debt Payment
export interface CompanyDebtPayment {
  id: string;
  debtId: string;
  amount: number;
  paymentSource: 'hpp_hand' | 'profit_hand' | 'bank' | 'cashbox';
  bankAccountId?: string;
  cashBoxId?: string;
  referenceNo?: string;
  notes?: string;
  paidById?: string;
  paidAt: Date;
  createdAt: Date;
  debt?: CompanyDebt;
}

// Log
export interface Log {
  id: string;
  type: 'activity' | 'error' | 'audit';
  userId?: string;
  action: string;
  entity?: string;
  entityId?: string;
  payload?: any;
  message?: string;
  createdAt: Date;
}

// Event
export interface Event {
  id: string;
  type: string;
  payload: any;
  isRead: boolean;
  createdAt: Date;
}

// Setting
export interface Setting {
  id: string;
  key: string;
  value: any;
  createdAt: Date;
  updatedAt: Date;
}

// Receivable / Piutang
export interface Receivable {
  id: string;
  transactionId: string;
  customerName?: string;
  customerPhone?: string;
  totalAmount: number;
  paidAmount: number;
  remainingAmount: number;
  assignedToId?: string;
  priority: 'low' | 'normal' | 'high' | 'urgent';
  status: 'active' | 'paid' | 'cancelled' | 'bad_debt';
  lastFollowUpAt?: Date;
  lastFollowUpNote?: string;
  nextFollowUpDate?: Date;
  overdueDays: number;
  reminderCount: number;
  lastReminderAt?: Date;
  notes?: string;
  createdById?: string;
  createdAt: Date;
  updatedAt: Date;
  transaction?: Transaction;
  assignedTo?: User;
  followUps?: ReceivableFollowUp[];
}

export interface ReceivableFollowUp {
  id: string;
  receivableId: string;
  type: 'call' | 'whatsapp' | 'visit' | 'email' | 'other';
  note: string;
  outcome?: 'promised_to_pay' | 'no_response' | 'dispute' | 'partial_payment' | 'rescheduled';
  promisedDate?: Date;
  createdById: string;
  createdAt: Date;
}

// Dashboard Stats
export interface DashboardStats {
  totalSales: number;
  totalProfit: number;
  totalTransactions: number;
  pendingApprovals: number;
  lowStockProducts: number;
  onlineUsers: number;
  todaySales: number;
  todayProfit: number;
  monthlySales: number;
  monthlyProfit: number;
  receivables: number;
  chartData: {
    date: string;
    sales: number;
    profit: number;
  }[];
  topProducts: {
    id: string;
    name: string;
    sold: number;
    revenue: number;
  }[];
  topSales: {
    id: string;
    name: string;
    transactions: number;
    revenue: number;
  }[];
}

// AI Analysis Result
export interface AIAnalysisResult {
  type: 'sales_analysis' | 'stock_alert' | 'profit_trend' | 'recommendation';
  title: string;
  summary: string;
  details: any;
  recommendations?: string[];
}

// Courier Cash
export interface CourierCash {
  id: string;
  courierId: string;
  unitId: string;
  balance: number;
  totalCollected: number;
  totalHandover: number;
  createdAt: Date;
  updatedAt: Date;
  courier?: User;
  unit?: Unit;
  handovers?: CourierHandover[];
}

// Courier Handover
export interface CourierHandover {
  id: string;
  courierCashId: string;
  amount: number;
  notes?: string;
  status: 'pending' | 'processed' | 'rejected';
  financeRequestId?: string;
  processedById?: string;
  processedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

// Online User Info
export interface OnlineUserInfo {
  userId: string;
  user: User;
  status: OnlineStatus;
  currentPage?: string;
  lastAction?: string;
}

// Sales Target
export interface SalesTarget {
  id: string;
  userId: string;
  period: 'monthly' | 'quarterly' | 'yearly';
  year: number;
  month?: number;
  quarter?: number;
  targetAmount: number;
  achievedAmount: number;
  status: 'active' | 'completed' | 'expired';
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
  user?: User;
}

// Sales Task
export type SalesTaskType = 'general' | 'visit' | 'followup' | 'prospecting' | 'collection' | 'other';
export type SalesTaskPriority = 'low' | 'normal' | 'high' | 'urgent';
export type SalesTaskStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled';

export interface SalesTask {
  id: string;
  title: string;
  description?: string;
  type: SalesTaskType;
  priority: SalesTaskPriority;
  assignedToId: string;
  assignedById: string;
  status: SalesTaskStatus;
  dueDate?: Date;
  completedAt?: Date;
  completionNote?: string;
  createdAt: Date;
  updatedAt: Date;
  assignedTo?: User;
  assignedBy?: User;
  reports?: SalesTaskReport[];
  latestReport?: SalesTaskReport;
}

export interface SalesTaskReport {
  id: string;
  taskId: string;
  reportedById: string;
  status: SalesTaskStatus;
  note: string;
  evidence?: string;
  createdAt: Date;
  reportedBy?: User;
}

// Password Reset
export interface PasswordReset {
  id: string;
  userId: string;
  token: string;
  expiresAt: string;
  used: boolean;
  createdAt: string;
}

// Customer Follow Up
export interface CustomerFollowUp {
  id: string;
  customerId: string;
  userId: string;
  notes: string;
  type: string;
  nextFollowUp: string | null;
  createdAt: string;
  user?: Pick<User, 'id' | 'name'>;
}

// Cashback Config
export interface CashbackConfig {
  id: string;
  type: 'percentage' | 'nominal';
  value: number;
  maxCashback: number;
  minOrder: number;
  referralBonusType: 'percentage' | 'nominal';
  referralBonusValue: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

// Cashback Log
export interface CashbackLog {
  id: string;
  customerId: string;
  transactionId?: string;
  withdrawalId?: string;
  type: 'earned' | 'withdrawn' | 'referral_bonus' | 'admin_adjustment';
  amount: number;
  balanceBefore: number;
  balanceAfter: number;
  description?: string;
  createdAt: Date;
  customer?: Customer;
}

// Cashback Withdrawal
export interface CashbackWithdrawal {
  id: string;
  customerId: string;
  amount: number;
  bankName: string;
  accountNo: string;
  accountHolder: string;
  status: 'pending' | 'approved' | 'rejected' | 'processed';
  processedById?: string;
  processedAt?: Date;
  rejectionReason?: string;
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
  customer?: Customer;
  processedBy?: User;
}

// Customer Referral
export interface CustomerReferral {
  id: string;
  customerId: string;
  businessName: string;
  picName: string;
  phone: string;
  status: 'new' | 'contacted' | 'converted' | 'lost';
  notes?: string;
  followUpDate?: Date;
  createdAt: Date;
  updatedAt: Date;
  customer?: Customer;
}
