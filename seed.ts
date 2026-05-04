import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function seed() {
  console.log('🌱 Seeding Razkindo ERP...\n');

  // ─── 1. UNITS ───────────────────────────────────────
  console.log('📦 Creating units...');
  const existingUnit = await prisma.unit.findFirst();
  let unit1;
  if (existingUnit) {
    unit1 = await prisma.unit.update({ where: { id: existingUnit.id }, data: { name: 'Razkindo Pusat', address: 'Jl. Raya Utama No. 1, Surabaya', phone: '031-1234567', isActive: true } });
  } else {
    unit1 = await prisma.unit.create({ data: { name: 'Razkindo Pusat', address: 'Jl. Raya Utama No. 1, Surabaya', phone: '031-1234567', isActive: true } });
  }

  const existingUnit2 = await prisma.unit.findFirst({ where: { name: 'Razkindo Cabang Malang' } });
  const unit2 = existingUnit2 || await prisma.unit.create({ data: { name: 'Razkindo Cabang Malang', address: 'Jl. Semeru No. 45, Malang', phone: '0341-987654', isActive: true } });
  console.log(`  ✅ ${unit1.name}, ${unit2.name}\n`);

  // ─── 2. USERS ───────────────────────────────────────
  console.log('👤 Creating users...');
  const hash = (pw: string) => bcrypt.hashSync(pw, 10);

  const upsertUser = async (email: string, pw: string, name: string, role: string, unitId: string, extra: any = {}) => {
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return prisma.user.update({ where: { id: existing.id }, data: { password: hash(pw), name, role, status: 'approved', isActive: true, canLogin: true, unitId, ...extra } });
    }
    return prisma.user.create({ data: { email, password: hash(pw), name, role, status: 'approved', isActive: true, canLogin: true, unitId, ...extra } });
  };

  const superAdmin = await upsertUser('admin@razkindo.com', 'admin123', 'Super Admin', 'super_admin', unit1.id, { phone: '081234567890' });
  const salesUser = await upsertUser('sales@razkindo.com', 'sales123', 'Budi Santoso', 'sales', unit1.id, { phone: '081298765432' });
  const kurirUser = await upsertUser('kurir@razkindo.com', 'kurir123', 'Ahmad Rizki', 'kurir', unit1.id, { phone: '081355566677', nearCommission: 10000, farCommission: 20000 });
  const keuanganUser = await upsertUser('keuangan@razkindo.com', 'keuangan123', 'Sari Dewi', 'keuangan', unit1.id, { phone: '081377788899' });

  // Link users to both units
  for (const u of [superAdmin, salesUser, kurirUser, keuanganUser]) {
    for (const unit of [unit1, unit2]) {
      const exists = await prisma.userUnit.findUnique({ where: { userId_unitId: { userId: u.id, unitId: unit.id } } });
      if (!exists) await prisma.userUnit.create({ data: { userId: u.id, unitId: unit.id } });
    }
  }
  console.log(`  ✅ 4 users created\n`);

  // ─── 3. SUPPLIERS ───────────────────────────────────
  console.log('🏭 Creating suppliers...');
  for (const s of [
    { name: 'PT Sumber Makmur', phone: '031-5551234', address: 'Jl. Industri No. 10, Sidoarjo', bankName: 'BCA', bankAccount: '1234567890' },
    { name: 'CV Jaya Abadi', phone: '031-5559876', address: 'Jl. Pasar No. 5, Surabaya', bankName: 'Mandiri', bankAccount: '0987654321' },
  ]) {
    const exists = await prisma.supplier.findFirst({ where: { name: s.name } });
    if (!exists) await prisma.supplier.create({ data: s });
  }
  console.log('  ✅ 2 suppliers created\n');

  // ─── 4. PRODUCTS ────────────────────────────────────
  console.log('📦 Creating products...');
  const productDefs = [
    { name: 'Tepung Terigu Segitiga Biru 1kg', sku: 'PRD-001', category: 'Sembako', unit: 'pcs', subUnit: 'pcs', conversionRate: 1, globalStock: 150, avgHpp: 10500, sellingPrice: 12000, purchasePrice: 10500, minStock: 20 },
    { name: 'Minyak Goreng Bimoli 2L', sku: 'PRD-002', category: 'Sembako', unit: 'pcs', subUnit: 'pcs', conversionRate: 1, globalStock: 80, avgHpp: 28000, sellingPrice: 32000, purchasePrice: 28000, minStock: 15 },
    { name: 'Gula Pasir Gulaku 1kg', sku: 'PRD-003', category: 'Sembako', unit: 'pcs', subUnit: 'pcs', conversionRate: 1, globalStock: 200, avgHpp: 14000, sellingPrice: 16000, purchasePrice: 14000, minStock: 30 },
    { name: 'Beras Premium 5kg', sku: 'PRD-004', category: 'Sembako', unit: 'karung', subUnit: 'kg', conversionRate: 5, globalStock: 100, avgHpp: 60000, sellingPrice: 72000, purchasePrice: 60000, minStock: 10 },
    { name: 'Kopi Kapal Api 65g (Renceng)', sku: 'PRD-005', category: 'Minuman', unit: 'renceng', subUnit: 'pcs', conversionRate: 10, globalStock: 50, avgHpp: 11000, sellingPrice: 13500, purchasePrice: 11000, minStock: 10 },
    { name: 'Indomie Goreng (Dus)', sku: 'PRD-006', category: 'Mie Instan', unit: 'dus', subUnit: 'pcs', conversionRate: 40, globalStock: 30, avgHpp: 98000, sellingPrice: 110000, purchasePrice: 98000, minStock: 5 },
  ];

  const products: any[] = [];
  for (const p of productDefs) {
    const existing = await prisma.product.findUnique({ where: { sku: p.sku } });
    if (existing) {
      products.push(existing);
    } else {
      products.push(await prisma.product.create({ data: { ...p, trackStock: true, isActive: true } }));
    }
  }
  console.log(`  ✅ ${products.length} products created\n`);

  // ─── 5. CUSTOMERS ───────────────────────────────────
  console.log('🛒 Creating customers...');
  const customerDefs = [
    { name: 'Toko Makmur Jaya', phone: '085111222333', address: 'Jl. Pasar Baru No. 15, Surabaya', distance: 'near', assignedToId: salesUser.id },
    { name: 'Warung Bu Siti', phone: '085444555666', address: 'Jl. Kenjeran No. 88, Surabaya', distance: 'near', assignedToId: salesUser.id },
    { name: 'Toko Berkah Abadi', phone: '085777888999', address: 'Jl. Rungkut Asri No. 22, Surabaya', distance: 'far', assignedToId: salesUser.id },
    { name: 'Minimarket Sentosa', phone: '085000111222', address: 'Jl. Ahmad Yani No. 100, Surabaya', distance: 'near', assignedToId: salesUser.id },
  ];

  const customers: any[] = [];
  for (const c of customerDefs) {
    const existing = await prisma.customer.findFirst({ where: { name: c.name, unitId: unit1.id } });
    if (existing) {
      customers.push(existing);
    } else {
      customers.push(await prisma.customer.create({
        data: { ...c, unitId: unit1.id, totalOrders: 0, totalSpent: 0, status: 'active', cashbackBalance: 0, cashbackType: 'percentage', cashbackValue: 0 },
      }));
    }
  }
  console.log(`  ✅ ${customers.length} customers created\n`);

  // ─── 6. TRANSACTIONS ────────────────────────────────
  console.log('💰 Creating transactions...');

  const existingTxCount = await prisma.transaction.count();
  if (existingTxCount > 5) {
    console.log(`  ⏭️ Skipping — ${existingTxCount} transactions already exist\n`);
  } else {
    const txns = [
      { cust: customers[0], items: [{ p: products[0], qty: 10 }, { p: products[1], qty: 5 }], method: 'cash', days: 2 },
      { cust: customers[1], items: [{ p: products[2], qty: 20 }, { p: products[4], qty: 5 }], method: 'cash', days: 3 },
      { cust: customers[2], items: [{ p: products[3], qty: 10 }, { p: products[5], qty: 3 }], method: 'tempo', days: 1 },
      { cust: customers[3], items: [{ p: products[0], qty: 25 }, { p: products[1], qty: 10 }, { p: products[2], qty: 15 }], method: 'cash', days: 0 },
      { cust: customers[1], items: [{ p: products[4], qty: 10 }, { p: products[5], qty: 5 }], method: 'piutang', days: 5 },
      { cust: customers[0], items: [{ p: products[1], qty: 8 }, { p: products[2], qty: 12 }], method: 'cash', days: 7 },
    ];

    for (const tx of txns) {
      const date = new Date();
      date.setDate(date.getDate() - tx.days);
      const invoiceNo = `INV-${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}-${String(Math.floor(Math.random() * 9000) + 1000)}`;

      let total = 0;
      let totalHpp = 0;
      const txItems = tx.items.map(item => {
        const subtotal = Number(item.p.sellingPrice) * item.qty;
        const hpp = Number(item.p.avgHpp) * item.qty;
        total += subtotal;
        totalHpp += hpp;
        return {
          productId: item.p.id,
          productName: item.p.name,
          qty: item.qty,
          qtyInSubUnit: item.qty * Number(item.p.conversionRate),
          qtyUnitType: 'sub',
          price: Number(item.p.sellingPrice),
          hpp: Number(item.p.avgHpp),
          subtotal,
          profit: subtotal - hpp,
        };
      });

      const isPiutang = tx.method === 'piutang' || tx.method === 'tempo';
      await prisma.transaction.create({
        data: {
          type: 'sale',
          invoiceNo,
          unitId: unit1.id,
          createdById: salesUser.id,
          customerId: tx.cust.id,
          courierId: tx.days <= 1 ? kurirUser.id : null,
          total,
          paidAmount: isPiutang ? 0 : total,
          remainingAmount: isPiutang ? total : 0,
          totalHpp,
          totalProfit: total - totalHpp,
          hppPaid: isPiutang ? 0 : totalHpp,
          profitPaid: isPiutang ? 0 : (total - totalHpp),
          hppUnpaid: isPiutang ? totalHpp : 0,
          profitUnpaid: isPiutang ? (total - totalHpp) : 0,
          paymentMethod: tx.method,
          status: 'approved',
          paymentStatus: isPiutang ? 'unpaid' : 'paid',
          deliveredAt: tx.days <= 1 ? date : null,
          transactionDate: date,
          items: { create: txItems },
        },
      });

      await prisma.customer.update({
        where: { id: tx.cust.id },
        data: { totalOrders: { increment: 1 }, totalSpent: { increment: total }, lastTransactionDate: date },
      });
    }
    console.log(`  ✅ ${txns.length} transactions created\n`);
  }

  // ─── 7. BANK & CASHBOX ─────────────────────────────
  console.log('🏦 Creating finance setup...');
  const bankExists = await prisma.bankAccount.findFirst({ where: { name: 'BCA Operasional' } });
  if (!bankExists) await prisma.bankAccount.create({ data: { name: 'BCA Operasional', bankName: 'BCA', accountNo: '1234567890', accountHolder: 'Razkindo', balance: 50000000, isActive: true } });

  const cashExists = await prisma.cashBox.findFirst({ where: { name: 'Brankas Kantor' } });
  if (!cashExists) await prisma.cashBox.create({ data: { name: 'Brankas Kantor', unitId: unit1.id, balance: 15000000, isActive: true } });
  console.log('  ✅ Finance accounts ready\n');

  // ─── DONE ──────────────────────────────────────────
  console.log('═══════════════════════════════════════════');
  console.log('✅ Seed complete! Login credentials:');
  console.log('═══════════════════════════════════════════');
  console.log('');
  console.log('  🔑 Super Admin : admin@razkindo.com / admin123');
  console.log('  👤 Sales       : sales@razkindo.com / sales123');
  console.log('  🚚 Kurir       : kurir@razkindo.com / kurir123');
  console.log('  💰 Keuangan    : keuangan@razkindo.com / keuangan123');
  console.log('');
  console.log('═══════════════════════════════════════════');
}

seed()
  .catch((e) => { console.error('❌ Seed error:', e.message); process.exit(1); })
  .finally(() => prisma.$disconnect());
