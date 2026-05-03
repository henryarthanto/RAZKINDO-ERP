'use client';

let _autoTable: ((doc: any, options: any) => void) | null = null;

async function getAutoTable() {
  if (!_autoTable) {
    const mod = await import('jspdf-autotable');
    _autoTable = (mod as any).default || (mod as any).autoTable;
  }
  return _autoTable!;
}

async function getJsPDF() {
  const mod = await import('jspdf');
  return mod.default;
}

import { formatCurrency, formatDate, formatDateTime, getTransactionPaymentLabel, escapeHtml } from './erp-helpers';
import type { Transaction, TransactionItem } from '@/types';

// ── Invoice Settings Type ──
export interface InvoiceSettings {
  company_name?: string;
  company_logo?: string;
  company_address?: string;
  company_phone?: string;
  company_email?: string;
}

// ── Logo Loader ──
async function loadLogoAsBase64(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    const blob = await res.blob();
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch { return null; }
}

export async function generateInvoicePDF(
  transaction: Transaction,
  settings?: InvoiceSettings
): Promise<any> {
  const jsPDF = await getJsPDF();
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  });
  const autoTable = await getAutoTable();

  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 15;
  const contentWidth = pageWidth - margin * 2;
  const companyName = settings?.company_name || 'RAZKINDO GROUP';
  const companyAddress = settings?.company_address || '';
  const companyPhone = settings?.company_phone || '';
  const companyEmail = settings?.company_email || '';

  // ── Load logo ──
  let logoBase64: string | null = null;
  if (settings?.company_logo) {
    logoBase64 = await loadLogoAsBase64(settings.company_logo);
  }

  let y = 12;

  // ─────────────────────────────────────────────────
  // 1. HEADER: Logo (centered) + Company info (centered)
  // ─────────────────────────────────────────────────
  const centerX = pageWidth / 2;

  if (logoBase64) {
    try {
      doc.addImage(logoBase64, 'PNG', centerX - 12.5, y, 25, 25);
    } catch { /* ignore logo errors */ }
    y += 27;
  }

  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(15, 23, 42); // slate-900
  doc.text(companyName, centerX, y, { align: 'center' });
  y += 5;

  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(100, 116, 139); // slate-500
  if (companyAddress) {
    doc.text(companyAddress, centerX, y, { align: 'center', maxWidth: contentWidth });
    y += 4;
  }
  if (companyPhone) {
    doc.text(`Tel: ${companyPhone}`, centerX, y, { align: 'center' });
    y += 4;
  }
  if (companyEmail) {
    doc.text(`Email: ${companyEmail}`, centerX, y, { align: 'center' });
    y += 2;
  }

  y = Math.max(y, logoBase64 ? 50 : 30);

  // ── Colored accent line under header ──
  doc.setDrawColor(13, 116, 117); // teal-700
  doc.setLineWidth(1.2);
  doc.line(margin, y, pageWidth - margin, y);
  doc.setLineWidth(0.2);
  doc.setDrawColor(13, 116, 117);
  doc.line(margin, y + 1.5, pageWidth - margin, y + 1.5);
  y += 10;

  // ─────────────────────────────────────────────────
  // 2. TITLE: "INVOICE"
  // ─────────────────────────────────────────────────
  doc.setFontSize(22);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(15, 23, 42);
  doc.text('INVOICE', pageWidth / 2, y, { align: 'center' });
  y += 2;

  // Decorative line under title
  const titleLineWidth = 60;
  doc.setDrawColor(13, 116, 117);
  doc.setLineWidth(0.8);
  doc.line(pageWidth / 2 - titleLineWidth / 2, y, pageWidth / 2 + titleLineWidth / 2, y);
  y += 8;

  // ─────────────────────────────────────────────────
  // 3. INVOICE INFO GRID
  // ─────────────────────────────────────────────────
  doc.setTextColor(0);

  const leftInfo = [
    ['Invoice No.', transaction.invoiceNo],
    ['Tanggal', formatDateTime(transaction.transactionDate)],
  ];
  const rightInfo = [
    ['Sales', transaction.createdBy?.name || '-'],
    ['Customer', transaction.customer?.name || 'Walk-in'],
  ];

  if (transaction.customer?.phone) {
    rightInfo.push(['Telp Customer', transaction.customer.phone]);
  }

  // Left column info
  doc.setFontSize(9);
  let leftY = y;
  leftInfo.forEach(([label, value]) => {
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(100, 116, 139);
    doc.text(`${label}:`, margin, leftY);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(15, 23, 42);
    doc.text(value, margin + 30, leftY);
    leftY += 5.5;
  });

  // Right column info
  let rightY = y;
  rightInfo.forEach(([label, value]) => {
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(100, 116, 139);
    doc.text(`${label}:`, pageWidth / 2 + 5, rightY);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(15, 23, 42);
    doc.text(value, pageWidth / 2 + 35, rightY);
    rightY += 5.5;
  });

  y = Math.max(leftY, rightY) + 4;

  // Thin separator
  doc.setDrawColor(226, 232, 240); // slate-200
  doc.setLineWidth(0.3);
  doc.line(margin, y, pageWidth - margin, y);
  y += 6;

  // ─────────────────────────────────────────────────
  // 4. ITEMS TABLE
  // ─────────────────────────────────────────────────
  const tableBody: (string | number)[][] = [];
  transaction.items?.forEach((item: TransactionItem) => {
    const unitLabel = (item.product?.unit && item.qtyUnitType === 'main')
      ? item.product.unit
      : (item.product?.subUnit && item.qtyUnitType === 'sub')
        ? item.product.subUnit
        : (item.qtyUnitType === 'main' ? 'box/pack' : 'pcs');
    tableBody.push([
      item.productName,
      `${item.qty} ${unitLabel}`,
      formatCurrency(item.price),
      formatCurrency(item.subtotal),
    ]);
  });

  autoTable(doc, {
    startY: y,
    head: [['Produk', 'Qty', 'Harga', 'Subtotal']],
    body: tableBody,
    theme: 'striped',
    headStyles: {
      fillColor: [15, 23, 42],
      textColor: 255,
      fontStyle: 'bold',
      fontSize: 9,
      cellPadding: { top: 4, bottom: 4, left: 3, right: 3 },
    },
    styles: {
      fontSize: 9,
      cellPadding: 3,
      lineColor: [226, 232, 240],
      lineWidth: 0.2,
    },
    alternateRowStyles: {
      fillColor: [248, 250, 252],
    },
    columnStyles: {
      0: { cellWidth: contentWidth * 0.40 },
      1: { cellWidth: contentWidth * 0.20, halign: 'center' },
      2: { cellWidth: contentWidth * 0.20, halign: 'right' },
      3: { cellWidth: contentWidth * 0.20, halign: 'right', fontStyle: 'bold' },
    },
    margin: { left: margin, right: margin },
  });

  y = (doc as any).lastAutoTable.finalY + 6;

  // ─────────────────────────────────────────────────
  // 5. TOTALS SECTION (right-aligned)
  // ─────────────────────────────────────────────────
  const totalsData: (string | number)[][] = [
    ['Total', formatCurrency(transaction.total)],
    ['Terbayar', formatCurrency(transaction.paidAmount)],
    ['Sisa', formatCurrency(transaction.remainingAmount)],
  ];

  autoTable(doc, {
    startY: y,
    body: totalsData,
    theme: 'plain',
    styles: {
      fontSize: 10,
      cellPadding: 2,
    },
    columnStyles: {
      0: {
        fontStyle: 'bold',
        cellWidth: contentWidth * 0.5,
        halign: 'right',
      },
      1: {
        fontStyle: 'bold',
        cellWidth: contentWidth * 0.5,
        halign: 'right',
      },
    },
    didParseCell: (data: any) => {
      if (data.row.index === 2 && transaction.remainingAmount > 0 && data.section === 'body') {
        data.cell.styles.textColor = [220, 38, 38];
      }
      if (data.row.index === 0 && data.section === 'body') {
        data.cell.styles.fontSize = 12;
      }
    },
    margin: { left: margin, right: margin },
  });

  y = (doc as any).lastAutoTable.finalY + 8;

  // ── Notes ──
  if (transaction.notes) {
    doc.setFontSize(9);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(100);
    doc.text('Catatan:', margin, y);
    y += 5;
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(0);
    const splitNotes = doc.splitTextToSize(transaction.notes, contentWidth);
    doc.text(splitNotes, margin, y);
    y += splitNotes.length * 4 + 5;
  }

  // ─────────────────────────────────────────────────
  // 6. FOOTER
  // ─────────────────────────────────────────────────
  y = Math.max(y, 230);

  // Thank you text
  doc.setFontSize(10);
  doc.setFont('helvetica', 'italic');
  doc.setTextColor(100, 116, 139);
  doc.text('Terima kasih atas kepercayaan Anda', pageWidth / 2, y, { align: 'center' });
  y += 15;

  // Signature area — two columns
  // Left: "Hormat kami," + company name
  // Right: "Penerima," + line
  const sigLeftX = margin;
  const sigRightX = pageWidth / 2 + 15;

  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(15, 23, 42);
  doc.text('Hormat kami,', sigLeftX, y);
  doc.text('Penerima,', sigRightX, y);
  y += 5;

  // Signature space (dotted line)
  doc.setDrawColor(180);
  doc.setLineWidth(0.3);
  doc.setLineDashPattern([1, 1], 0);
  doc.line(sigLeftX, y + 20, sigLeftX + 60, y + 20);
  doc.line(sigRightX, y + 20, sigRightX + 60, y + 20);
  doc.setLineDashPattern([], 0);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.text(companyName, sigLeftX, y + 24);
  doc.text('..................................', sigRightX, y + 24);

  y += 32;

  // Separator line
  doc.setDrawColor(226, 232, 240);
  doc.setLineWidth(0.3);
  doc.line(margin, y, pageWidth - margin, y);
  y += 4;

  // Footer note
  doc.setFontSize(7);
  doc.setFont('helvetica', 'italic');
  doc.setTextColor(148, 163, 184);
  doc.text('Dokumen ini dibuat secara otomatis oleh sistem Razkindo ERP', pageWidth / 2, y, { align: 'center' });

  return doc;
}

export async function downloadInvoicePDF(transaction: Transaction, settings?: InvoiceSettings) {
  const doc = await generateInvoicePDF(transaction, settings);
  doc.save(`Invoice_${transaction.invoiceNo}.pdf`);
}

export async function getInvoicePDFBlob(transaction: Transaction, settings?: InvoiceSettings): Promise<Blob> {
  const doc = await generateInvoicePDF(transaction, settings);
  return doc.output('blob');
}

export interface ReceiptSettings {
  company_name?: string;
  receipt_header?: string;
  receipt_footer?: string;
  receipt_show_logo?: boolean;
  company_logo?: string;
}

// ── Text formatting helpers for thermal receipt ──

const LINE_WIDTH: Record<57 | 80, number> = { 57: 32, 80: 48 };

function centerText(text: string, width: number): string {
  const pad = Math.max(0, Math.floor((width - text.length) / 2));
  return ' '.repeat(pad) + text;
}

function twoCol(left: string, right: string, width: number): string {
  const space = width - left.length - right.length;
  if (space <= 0) return left + ' ' + right;
  return left + ' '.repeat(space) + right;
}

function rightPad(text: string, width: number): string {
  return text + ' '.repeat(Math.max(0, width - text.length));
}

function separator(char: string, width: number): string {
  return char.repeat(width);
}

/**
 * Format currency WITHOUT 'Rp' prefix and WITHOUT dots for compact thermal receipt.
 * e.g. 15000 → "15.000"
 */
function formatCompact(n: number): string {
  if (!Number.isFinite(n) || Number.isNaN(n)) return '0';
  return Math.floor(n).toLocaleString('id-ID');
}

function getUnitLabel(item: TransactionItem): string {
  if (item.product?.unit && item.qtyUnitType === 'main') return item.product.unit;
  if (item.product?.subUnit && item.qtyUnitType === 'sub') return item.product.subUnit;
  return item.qtyUnitType === 'main' ? 'box' : 'pcs';
}

/**
 * Generate receipt text for BLE/text sharing — professional cafe-style layout.
 *
 * Layout (example for 57mm / 32 chars):
 *   ─────────────────────────────────
 *          RAZKINDO GROUP
 *        Alamat lengkap toko
 *       Tlp: 021-xxx-xxx
 *   ================================
 *   01/04/2026          13:20
 *   No.       INV-2026-001
 *   Sales     John
 *   Customer  Walk-in
 *   Metode    CASH
 *   ================================
 *   Product A
 *    1 x Rp10.000
 *                10.000
 *   Product B
 *    2 x Rp5.000
 *                10.000
 *   --------------------------------
 *   Total              20.000
 *   Tunai              20.000
 *   Kembali             0
 *   ================================
 *   --Terima Kasih Atas--
 *   ---Kunjungan Anda!--
 *   ================================
 */
export function generateReceiptText(
  transaction: Transaction,
  settings?: ReceiptSettings,
  paperWidth: 57 | 80 = 57
): string {
  const W = LINE_WIDTH[paperWidth];
  const companyName = settings?.company_name || 'RAZKINDO GROUP';
  const receiptHeader = settings?.receipt_header || '';
  const receiptFooter = settings?.receipt_footer || 'Terima Kasih Atas\nKunjungan Anda!';
  const showLogo = !!settings?.receipt_show_logo && !!settings?.company_logo;

  const paymentMethodLabel = getTransactionPaymentLabel(transaction.paymentMethod);
  const sepEq = separator('=', W);
  const sepDash = separator('-', W);

  const lines: string[] = [];

  // ── Header ──
  lines.push(sepEq);
  if (showLogo) lines.push(centerText('[LOGO]', W));
  lines.push(centerText(companyName, W));
  if (receiptHeader) {
    receiptHeader.split('\n').forEach(h => lines.push(centerText(h.trim(), W)));
  }
  lines.push(sepEq);

  // ── Date & Time on same line ──
  const txDate = new Date(transaction.transactionDate);
  const dateStr = `${String(txDate.getDate()).padStart(2,'0')}/${String(txDate.getMonth()+1).padStart(2,'0')}/${txDate.getFullYear()}`;
  const timeStr = `${String(txDate.getHours()).padStart(2,'0')}:${String(txDate.getMinutes()).padStart(2,'0')}`;
  lines.push(twoCol(dateStr, timeStr, W));

  // ── Transaction info (two-column) ──
  lines.push(twoCol('No.', transaction.invoiceNo, W));
  lines.push(twoCol('Sales', transaction.createdBy?.name || '-', W));
  lines.push(twoCol('Customer', transaction.customer?.name || 'Walk-in', W));
  lines.push(twoCol('Metode', paymentMethodLabel, W));
  lines.push(sepEq);

  // ── Items ──
  transaction.items?.forEach((item: TransactionItem) => {
    const unit = getUnitLabel(item);
    const priceStr = formatCompact(item.price);
    const subtotalStr = formatCompact(item.subtotal);
    lines.push(item.productName);
    lines.push(` ${item.qty} x ${priceStr}`);
    lines.push(rightPad('', W - subtotalStr.length) + subtotalStr);
  });
  lines.push(sepDash);

  // ── Totals ──
  lines.push(twoCol('Total', formatCompact(transaction.total), W));
  lines.push(twoCol('Tunai', formatCompact(transaction.paidAmount), W));
  // Kembalian (change) = paid - total, only if fully/partially paid more than total
  const change = transaction.paidAmount - transaction.total;
  if (change > 0) {
    lines.push(twoCol('Kembali', formatCompact(change), W));
  } else if (transaction.remainingAmount > 0) {
    lines.push(twoCol('Sisa', formatCompact(transaction.remainingAmount), W));
  }

  if (transaction.paymentMethod === 'tempo' && transaction.dueDate) {
    lines.push(sepDash);
    lines.push(twoCol('Jth Tempo', formatDate(transaction.dueDate), W));
  }

  lines.push(sepEq);

  // ── Footer ──
  receiptFooter.split('\n').forEach(f => {
    const trimmed = f.trim();
    if (!trimmed) return;
    lines.push(centerText(`--${trimmed}--`, W));
  });
  lines.push(sepEq);

  return lines.join('\n');
}

/**
 * Generate receipt HTML for browser thermal printing.
 * Uses CSS for precise alignment matching the thermal layout.
 */
export function generateReceiptHTML(
  transaction: Transaction,
  settings?: ReceiptSettings,
  paperWidth: 57 | 80 = 57
): string {
  const companyName = settings?.company_name || 'RAZKINDO GROUP';
  const receiptHeader = settings?.receipt_header || '';
  const receiptFooter = settings?.receipt_footer || 'Terima Kasih Atas\nKunjungan Anda!';
  const showLogo = !!settings?.receipt_show_logo && !!settings?.company_logo;
  const paymentMethodLabel = getTransactionPaymentLabel(transaction.paymentMethod);

  const txDate = new Date(transaction.transactionDate);
  const dateStr = `${String(txDate.getDate()).padStart(2,'0')}/${String(txDate.getMonth()+1).padStart(2,'0')}/${txDate.getFullYear()}`;
  const timeStr = `${String(txDate.getHours()).padStart(2,'0')}:${String(txDate.getMinutes()).padStart(2,'0')}`;
  const change = transaction.paidAmount - transaction.total;

  const paperSize = paperWidth === 80 ? '80mm auto' : '57mm auto';
  const bodyWidth = paperWidth === 80 ? '80mm' : '57mm';
  const fontSize = paperWidth === 80 ? '12px' : '10px';
  const smallFontSize = paperWidth === 80 ? '11px' : '9px';

  const headerLines = receiptHeader
    ? receiptHeader.split('\n').map(h => `<div class="header-sub">${escapeHtml(h)}</div>`).join('')
    : '';

  const itemsHTML = (transaction.items || []).map((item: TransactionItem) => {
    const unit = getUnitLabel(item);
    return `
      <div class="item-name">${escapeHtml(item.productName)}</div>
      <div class="item-detail">${item.qty} x ${formatCurrency(item.price)} ${escapeHtml(unit)}</div>
      <div class="item-subtotal">${formatCurrency(item.subtotal)}</div>`;
  }).join('');

  const footerLines = receiptFooter
    .split('\n')
    .filter(f => f.trim())
    .map(f => `<div class="footer-line">---- ${escapeHtml(f.trim())} ----</div>`).join('');

  return `
<!DOCTYPE html>
<html>
<head>
  <title>Receipt</title>
  <style>
    @page { size: ${paperSize}; margin: 2mm; }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Courier New', Courier, monospace;
      font-size: ${fontSize};
      width: ${bodyWidth};
      margin: 0 auto;
      padding: 2mm;
      color: #000;
    }
    .sep-eq { border: none; border-top: 1.5px dashed #000; margin: 4px 0; }
    .sep-dash { border: none; border-top: 1px dotted #000; margin: 4px 0; }
    .header-name { text-align: center; font-weight: bold; font-size: ${paperWidth === 80 ? '16px' : '13px'}; margin-bottom: 2px; }
    .header-sub { text-align: center; font-size: ${smallFontSize}; color: #333; line-height: 1.3; }
    .header-logo { text-align: center; margin-bottom: 4px; }
    .header-logo img { max-width: 60px; max-height: 60px; }
    .info-row { display: flex; justify-content: space-between; font-size: ${fontSize}; line-height: 1.4; }
    .info-label { color: #333; }
    .item-name { font-size: ${fontSize}; line-height: 1.3; }
    .item-detail { font-size: ${smallFontSize}; color: #333; padding-left: 4px; }
    .item-subtotal { text-align: right; font-size: ${fontSize}; }
    .total-row { display: flex; justify-content: space-between; font-size: ${fontSize}; line-height: 1.5; font-weight: bold; }
    .total-row.normal { font-weight: normal; }
    .footer-line { text-align: center; font-size: ${smallFontSize}; color: #333; line-height: 1.3; }
    @media print {
      body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    }
  </style>
</head>
<body>
  ${showLogo ? `<div class="header-logo"><img src="${escapeHtml(settings?.company_logo || '')}" /></div>` : ''}
  <div class="header-name">${escapeHtml(companyName)}</div>
  ${headerLines}

  <hr class="sep-eq" />
  <div class="info-row">
    <span>${dateStr}</span>
    <span>${timeStr}</span>
  </div>
  <div class="info-row">
    <span class="info-label">No.</span>
    <span>${escapeHtml(transaction.invoiceNo)}</span>
  </div>
  <div class="info-row">
    <span class="info-label">Sales</span>
    <span>${escapeHtml(transaction.createdBy?.name || '-')}</span>
  </div>
  <div class="info-row">
    <span class="info-label">Customer</span>
    <span>${escapeHtml(transaction.customer?.name || 'Walk-in')}</span>
  </div>
  <div class="info-row">
    <span class="info-label">Metode</span>
    <span>${paymentMethodLabel}</span>
  </div>
  <hr class="sep-eq" />

  ${itemsHTML}

  <hr class="sep-dash" />
  <div class="total-row">
    <span>Total</span>
    <span>${formatCurrency(transaction.total)}</span>
  </div>
  <div class="total-row normal">
    <span>Tunai</span>
    <span>${formatCurrency(transaction.paidAmount)}</span>
  </div>
  ${change > 0
    ? `<div class="total-row normal">
        <span>Kembali</span>
        <span>${formatCurrency(change)}</span>
      </div>`
    : (transaction.remainingAmount > 0
      ? `<div class="total-row normal">
          <span>Sisa</span>
          <span>${formatCurrency(transaction.remainingAmount)}</span>
        </div>`
      : '')
  }
  ${transaction.paymentMethod === 'tempo' && transaction.dueDate
    ? `<hr class="sep-dash" />
       <div class="info-row">
        <span class="info-label">Jth Tempo</span>
        <span>${formatDate(transaction.dueDate)}</span>
      </div>`
    : ''
  }
  <hr class="sep-eq" />
  ${footerLines}
  <hr class="sep-eq" />
</body>
</html>`;
}

// ---- ESC/POS Bluetooth Helpers ----

const ESC_INIT = new Uint8Array([0x1B, 0x40]);        // Initialize printer
const ESC_CENTER = new Uint8Array([0x1B, 0x61, 0x01]); // Center align
const ESC_LEFT = new Uint8Array([0x1B, 0x61, 0x00]);   // Left align
const ESC_CUT = new Uint8Array([0x1D, 0x56, 0x01]);    // Paper cut (partial cut - feeds paper out)
const ESC_FEED_N = new Uint8Array([0x1B, 0x64, 0x03]); // Feed 3 lines after content
const ESC_FEED_5 = new Uint8Array([0x1B, 0x64, 0x05]); // Feed 5 lines before cut

// BLE thermal printer service UUIDs — covers RPP02N, Goojprt, MPT-II, PeriPage, etc.
const BLE_PRINTER_SERVICES = [
  '0000ff00-0000-1000-8000-00805f9b34fb', // Most common: RPP02N, Goojprt, PeriPage, generic mini printers
  '000018f0-0000-1000-8000-00805f9b34fb', // Some Chinese thermal printers (RPP02N variant)
  '0000ffe0-0000-1000-8000-00805f9b34fb', // HM-10 / BLE module based printers
  'e7810a71-73ae-499d-8c15-faa9aef0c3f2', // Some specific models
  '0000ff01-0000-1000-8000-00805f9b34fb', // Some RPP02N firmware variants
];

// BLE thermal printer write characteristic UUIDs
const BLE_PRINTER_CHARACTERISTICS = [
  '0000ff02-0000-1000-8000-00805f9b34fb', // Most common write characteristic (RPP02N primary)
  '0000ff01-0000-1000-8000-00805f9b34fb', // Alternative write char (some RPP02N)
  '0000ff03-0000-1000-8000-00805f9b34fb', // Another variant
  '00002af1-0000-1000-8000-00805f9b34fb', // Previous default
  '00002af0-0000-1000-8000-00805f9b34fb', // Alternative write characteristic
  '0000ffe1-0000-1000-8000-00805f9b34fb', // HM-10 style
  '0000ffe2-0000-1000-8000-00805f9b34fb', // HM-10 alternative
  'beefcafe-0000-0000-0000-000000000001', // Some specific models
];

export interface BLEPrinterConnection {
  device: BluetoothDevice;
  characteristic: BluetoothRemoteGATTCharacteristic;
}

/**
 * Request a BLE printer device.
 * Tries common thermal printer service UUIDs first.
 * Falls back to acceptAllDevices so RPP02N and other printers are always discoverable.
 */
export async function requestBLEPrinter(): Promise<BluetoothDevice> {
  if (!navigator.bluetooth) {
    throw new Error('Browser tidak mendukung Bluetooth. Gunakan Chrome/Edge di Android/ChromeOS.');
  }

  // Single request: acceptAllDevices shows the system picker ONCE immediately.
  // optionalServices ensures we can connect to RPP02N's custom service after selection.
  // This avoids the old bug of trying 5 filter strategies sequentially (causing long hang).
  try {
    const device = await navigator.bluetooth.requestDevice({
      acceptAllDevices: true,
      optionalServices: BLE_PRINTER_SERVICES,
    });
    return device;
  } catch (err: any) {
    if (err.name === 'NotFoundError') {
      throw new Error('Tidak ada perangkat Bluetooth ditemukan. Pastikan printer RPP02N menyala dan Bluetooth aktif.');
    }
    if (err.name === 'AbortError') {
      throw new Error('Pemilihan printer dibatalkan.');
    }
    throw err;
  }
}

/**
 * Connect to a BLE printer and find the correct write characteristic.
 * Tries all known service/characteristic UUIDs used by RPP02N and similar thermal printers.
 * Also discovers ALL services on the device as a fallback.
 */
export async function connectBLEPrinter(
  device: BluetoothDevice,
  signal?: AbortSignal
): Promise<BLEPrinterConnection> {
  // Disconnect any existing connection first
  if (device.gatt?.connected) {
    device.gatt.disconnect();
  }

  // Add 10-second connection timeout — fail fast instead of hanging forever
  const connectionPromise = device.gatt!.connect();
  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error(
      'Koneksi printer timeout (10 detik). Pastikan printer RPP02N menyala dan dekat.'
    )), 10000)
  );

  const server = await Promise.race([connectionPromise, timeoutPromise]);
  if (!server) {
    device.gatt?.disconnect();
    throw new Error('Gagal konek ke printer ' + (device.name || ''));
  }

  // Phase 1: Try known service/characteristic UUIDs (fast — direct lookup)
  for (const serviceUuid of BLE_PRINTER_SERVICES) {
    try {
      const service = await server.getPrimaryService(serviceUuid);
      for (const charUuid of BLE_PRINTER_CHARACTERISTICS) {
        try {
          const characteristic = await service.getCharacteristic(charUuid);
          if (characteristic.properties.write || characteristic.properties.writeWithoutResponse) {
            console.log(`[BT Printer] Connected: service=${serviceUuid} char=${charUuid}`);
            return { device, characteristic };
          }
        } catch {
          continue;
        }
      }
    } catch {
      continue;
    }
  }

  // Phase 2: Auto-discover ALL services (slower — used as fallback)
  try {
    const services = await server.getPrimaryServices();
    console.log(`[BT Printer] Found ${services.length} services on ${device.name}`);

    for (const service of services) {
      try {
        const characteristics = await service.getCharacteristics();
        for (const char of characteristics) {
          if (char.properties.write || char.properties.writeWithoutResponse) {
            console.log(`[BT Printer] Auto-discovered: service=${service.uuid} char=${char.uuid}`);
            return { device, characteristic: char };
          }
        }
      } catch {
        continue;
      }
    }
  } catch (err) {
    console.warn('[BT Printer] Service discovery failed:', err);
  }

  // Cleanup on failure
  device.gatt?.disconnect();
  throw new Error(
    'Tidak ditemukan characteristic printer yang didukung. ' +
    'Pastikan printer RPP02N menyala dan dalam jarak dekat. ' +
    'Coba matikan dan nyalakan ulang printer.'
  );
}

/**
 * Wrap receipt text with ESC/POS commands for RPP02N 57x30mm thermal printer.
 * Uses CR+LF (\r\n) line endings — required by most BLE thermal printers.
 *
 * Layout:
 *   1. CENTERED header (company name, address) — before the date line
 *   2. LEFT-ALIGNED body (date, items, totals, footer)
 *
 * Split is detected at the first line matching DD/MM/YYYY pattern (the date line).
 */
export function wrapReceiptWithESCPOS(receiptText: string): Uint8Array {
  const encoder = new TextEncoder();

  // Convert \n to \r\n — RPP02N and most BLE thermal printers need CR+LF
  const crlfText = receiptText.replace(/\r?\n/g, '\r\n');

  // Split at the date line (DD/MM/YYYY) to separate header from body
  const dateMatch = crlfText.match(/\r\n\d{2}\/\d{2}\/\d{4}/);
  let headerPart: string;
  let bodyPart: string;

  if (dateMatch && dateMatch.index !== undefined) {
    headerPart = crlfText.substring(0, dateMatch.index);
    bodyPart = crlfText.substring(dateMatch.index + 2); // skip the \r\n, keep date in body
  } else {
    headerPart = '';
    bodyPart = crlfText;
  }

  // Ensure clean line endings
  const headerClean = headerPart.replace(/\r?\n+$/, '') + '\r\n';
  const bodyClean = bodyPart.replace(/\r?\n+$/, '') + '\r\n';

  // ESC/POS commands
  const ESC_BOLD_ON = new Uint8Array([0x1B, 0x45, 0x01]);
  const ESC_BOLD_OFF = new Uint8Array([0x1B, 0x45, 0x00]);
  const ESC_DOUBLE_ON = new Uint8Array([0x1B, 0x21, 0x30]); // double height + double width
  const ESC_DOUBLE_OFF = new Uint8Array([0x1B, 0x21, 0x00]);
  const ESC_FEED_1 = new Uint8Array([0x1B, 0x64, 0x01]); // Feed 1 line

  // Parse header: first line = company name (big + bold + center), rest = normal center
  const headerLines = headerClean.split('\r\n');
  const companyNameLine = headerLines[0] || '';
  const restHeader = headerLines.slice(1).join('\r\n');

  const companyBytes = encoder.encode(companyNameLine);
  const restHeaderBytes = encoder.encode(restHeader);
  const bodyBytes = encoder.encode(bodyClean);

  // Build ESC/POS byte sequence:
  // INIT → CENTER → DOUBLE+BIG → BOLD → company name → DOUBLE OFF → BOLD OFF → rest header
  // → LEFT → body → FEED 5 → CUT → FEED 1
  const parts: Uint8Array[] = [
    ESC_INIT,
    ESC_CENTER,
    ESC_DOUBLE_ON,
    ESC_BOLD_ON,
    companyBytes,
    new Uint8Array([0x0D, 0x0A]), // CR+LF after company name
    ESC_DOUBLE_OFF,
    ESC_BOLD_OFF,
    restHeaderBytes,
    ESC_LEFT,
    bodyBytes,
    ESC_FEED_5,
    ESC_CUT,
    ESC_FEED_1,
  ];

  const totalLen = parts.reduce((sum, p) => sum + p.length, 0);
  const fullData = new Uint8Array(totalLen);
  let offset = 0;
  for (const part of parts) {
    fullData.set(part, offset);
    offset += part.length;
  }

  return fullData;
}

/**
 * Write data to a BLE characteristic in chunks — optimized for RPP02N 57x30mm.
 * Uses writeWithoutResponse when available (faster, no timeout issues).
 * RPP02N typically supports 128-200 byte MTU. Uses 100 as safe default.
 * Adds delays between chunks to prevent buffer overflow on budget printers.
 */
export async function writeBLEChunks(
  characteristic: BluetoothRemoteGATTCharacteristic,
  data: Uint8Array
): Promise<void> {
  const useWriteWithoutResponse = characteristic.properties.writeWithoutResponse;
  const CHUNK_SIZE = 100; // Safe for RPP02N and most BLE thermal printers

  for (let i = 0; i < data.length; i += CHUNK_SIZE) {
    const chunk = data.slice(i, i + CHUNK_SIZE);

    try {
      if (useWriteWithoutResponse) {
        await characteristic.writeValueWithoutResponse(chunk);
      } else {
        await characteristic.writeValueWithResponse(chunk);
      }
    } catch (err) {
      // On write error, retry once after a short delay
      console.warn(`[BT Printer] Write error at chunk ${Math.floor(i / CHUNK_SIZE)}, retrying...`, err);
      await new Promise(resolve => setTimeout(resolve, 200));
      try {
        if (useWriteWithoutResponse) {
          await characteristic.writeValueWithoutResponse(chunk);
        } else {
          await characteristic.writeValueWithResponse(chunk);
        }
      } catch (retryErr) {
        console.error(`[BT Printer] Write retry failed at chunk ${Math.floor(i / CHUNK_SIZE)}`, retryErr);
        throw new Error('Gagal mengirim data ke printer. Coba dekatkan ke printer dan coba lagi.');
      }
    }

    // Delay between chunks — RPP02N needs ~30ms between chunks to avoid buffer overflow
    if (i + CHUNK_SIZE < data.length) {
      await new Promise(resolve => setTimeout(resolve, 30));
    }
  }

  // Extra delay after last chunk to ensure printer finishes processing
  await new Promise(resolve => setTimeout(resolve, 100));
}
