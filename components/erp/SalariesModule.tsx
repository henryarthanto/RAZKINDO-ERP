'use client';

import { useState } from 'react';
import { useAuthStore } from '@/stores/auth-store';
import { useUnitStore } from '@/stores/unit-store';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { POLLING_CONFIG } from '@/providers/query-provider';
import { toast } from 'sonner';
import { apiFetch } from '@/lib/api-client';
import {
  Receipt, Plus, DollarSign, Clock, Check, Briefcase, Search,
  Eye, Download, Share2, Trash2, ClipboardList, ArrowRight,
  TrendingUp, TrendingDown, RefreshCw, Send, AlertCircle
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogDescription, DialogTrigger
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Table, TableHeader, TableRow, TableHead, TableBody, TableCell
} from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem
} from '@/components/ui/select';
import {
  TooltipProvider, Tooltip, TooltipTrigger, TooltipContent
} from '@/components/ui/tooltip';
import { Textarea } from '@/components/ui/textarea';
import { Separator } from '@/components/ui/separator';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { formatCurrency, formatDate, formatDateTime, getInitials, toLocalDateStr, monthStartLocal } from '@/lib/erp-helpers';
import type { SalaryPayment, User } from '@/types';

export default function SalariesModule() {
  const { user } = useAuthStore();
  const queryClient = useQueryClient();
  const { selectedUnitId } = useUnitStore();
  const [showCreate, setShowCreate] = useState(false);
  const [selectedSalary, setSelectedSalary] = useState<SalaryPayment | null>(null);
  const [showPayslip, setShowPayslip] = useState(false);
  const [statusFilter, setStatusFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  
  const { data, isLoading } = useQuery({
    queryKey: ['salaries'],
    queryFn: () => apiFetch<{ salaries: any[]; stats: any }>('/api/salaries'),
    ...POLLING_CONFIG
  });
  
  const { data: usersData } = useQuery({
    queryKey: ['users'],
    queryFn: () => apiFetch<{ users: any[] }>('/api/users'),
  });

  const salaries = Array.isArray(data?.salaries) ? data.salaries : [];
  const stats = data?.stats || { totalPaid: 0, totalPending: 0, totalApproved: 0, paidCount: 0, pendingCount: 0 };
  const users = Array.isArray(usersData?.users) ? usersData.users : [];
  
  const filteredSalaries = salaries.filter((s: SalaryPayment) => {
    if (statusFilter !== 'all' && s.status !== statusFilter) return false;
    if (searchQuery) {
      const name = s.user?.name?.toLowerCase() || '';
      return name.includes(searchQuery.toLowerCase());
    }
    return true;
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiFetch(`/api/salaries/${id}`, { method: 'DELETE' });
    },
    onSuccess: () => {
      toast.success('Slip gaji berhasil dihapus');
      queryClient.invalidateQueries({ queryKey: ['salaries'] });
      queryClient.invalidateQueries({ queryKey: ['finance-requests'] });
    },
    onError: (err: Error) => {
      toast.error(err.message);
    }
  });

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'paid': return <Badge className="bg-green-500 hover:bg-green-600">Dibayar</Badge>;
      case 'approved': return <Badge className="bg-blue-500 hover:bg-blue-600">Disetujui</Badge>;
      case 'pending': return <Badge className="bg-amber-500 hover:bg-amber-600">Menunggu Finance</Badge>;
      case 'rejected': return <Badge className="bg-red-500 hover:bg-red-600">Ditolak</Badge>;
      default: return <Badge variant="outline">{status}</Badge>;
    }
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Receipt className="w-5 h-5" />
            Penggajian & Slip Gaji
          </h2>
          <p className="text-sm text-muted-foreground">Kelola gaji karyawan, buat slip gaji, dan request ke finance</p>
        </div>
        
        {user?.role === 'super_admin' && (
          <Dialog open={showCreate} onOpenChange={setShowCreate}>
            <DialogTrigger asChild>
              <Button size="sm">
                <Plus className="w-4 h-4 mr-2" />
                Buat Penggajian
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-3xl w-[calc(100%-2rem)] max-h-[85dvh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <ClipboardList className="w-5 h-5" />
                  Buat Slip Gaji & Request Penggajian
                </DialogTitle>
                <DialogDescription>
                  Slip gaji akan dibuat dan otomatis mengirim request ke Finance untuk persetujuan
                </DialogDescription>
              </DialogHeader>
              <SalaryForm
                users={users}
                requestById={user?.id || ''}
                unitId={selectedUnitId || undefined}
                onSuccess={() => {
                  setShowCreate(false);
                  queryClient.invalidateQueries({ queryKey: ['salaries'] });
                  queryClient.invalidateQueries({ queryKey: ['finance-requests'] });
                }}
              />
            </DialogContent>
          </Dialog>
        )}
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className="p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-green-100 rounded-lg flex-shrink-0">
              <DollarSign className="w-5 h-5 text-green-600" />
            </div>
            <div className="min-w-0">
              <p className="text-xs text-muted-foreground">Total Dibayar</p>
              <p className="text-sm sm:text-lg font-bold truncate">{formatCurrency(stats.totalPaid)}</p>
            </div>
          </div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-amber-100 rounded-lg flex-shrink-0">
              <Clock className="w-5 h-5 text-amber-600" />
            </div>
            <div className="min-w-0">
              <p className="text-xs text-muted-foreground">Menunggu Finance</p>
              <p className="text-sm sm:text-lg font-bold truncate">{formatCurrency(stats.totalPending)}</p>
              {stats.pendingCount > 0 && (
                <p className="text-xs text-amber-600">{stats.pendingCount} request</p>
              )}
            </div>
          </div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-100 rounded-lg flex-shrink-0">
              <Check className="w-5 h-5 text-blue-600" />
            </div>
            <div className="min-w-0">
              <p className="text-xs text-muted-foreground">Disetujui</p>
              <p className="text-sm sm:text-lg font-bold truncate">{formatCurrency(stats.totalApproved)}</p>
            </div>
          </div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-purple-100 rounded-lg flex-shrink-0">
              <Briefcase className="w-5 h-5 text-purple-600" />
            </div>
            <div className="min-w-0">
              <p className="text-xs text-muted-foreground">Slip Gaji</p>
              <p className="text-sm sm:text-lg font-bold truncate">{stats.paidCount} dibayar</p>
            </div>
          </div>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Cari karyawan..."
            className="pl-9"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
          />
        </div>
        <div className="flex flex-wrap gap-2">
          {[
            { value: 'all', label: 'Semua' },
            { value: 'pending', label: 'Menunggu' },
            { value: 'approved', label: 'Disetujui' },
            { value: 'paid', label: 'Dibayar' },
            { value: 'rejected', label: 'Ditolak' }
          ].map(f => (
            <Button
              key={f.value}
              size="sm"
              variant={statusFilter === f.value ? 'default' : 'outline'}
              onClick={() => setStatusFilter(f.value)}
              className="text-xs"
            >
              {f.label}
            </Button>
          ))}
        </div>
      </div>
      
      {/* Salary List - Mobile Card Layout */}
      <div className="block md:hidden space-y-3">
        {filteredSalaries.length === 0 ? (
          <Card className="p-6">
            <div className="text-center text-muted-foreground">
              <Receipt className="w-12 h-12 mx-auto mb-2 opacity-20" />
              <p>Belum ada data penggajian</p>
              {user?.role === 'super_admin' && (
                <Button size="sm" variant="outline" className="mt-2" onClick={() => setShowCreate(true)}>
                  <Plus className="w-4 h-4 mr-1" /> Buat Penggajian Pertama
                </Button>
              )}
            </div>
          </Card>
        ) : (
          filteredSalaries.map((s: SalaryPayment) => (
            <Card key={s.id} className="p-4 space-y-3">
              {/* Top row: Avatar + Name + Role | Status */}
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2.5 min-w-0">
                  <Avatar className="h-9 w-9 flex-shrink-0">
                    <AvatarFallback className="text-xs">{getInitials(s.user?.name || '?')}</AvatarFallback>
                  </Avatar>
                  <div className="min-w-0">
                    <p className="font-semibold text-sm truncate">{s.user?.name}</p>
                    <p className="text-xs text-muted-foreground capitalize">{s.user?.role?.replace('_', ' ')}</p>
                  </div>
                </div>
                {getStatusBadge(s.status)}
              </div>

              {/* Middle: Period + Total */}
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">
                  {formatDate(s.periodStart)} s/d {formatDate(s.periodEnd)}
                </p>
                <p className="text-xl font-bold text-primary">{formatCurrency(s.totalAmount)}</p>
              </div>

              {/* Bottom: 3-col grid - Gaji Pokok, Tambahan, Potongan */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
                <div className="space-y-0.5 min-w-0">
                  <p className="text-muted-foreground">Gaji Pokok</p>
                  <p className="font-medium truncate">{formatCurrency(s.baseSalary)}</p>
                </div>
                <div className="space-y-0.5 min-w-0">
                  <p className="text-muted-foreground">Tambahan</p>
                  <p className="font-medium text-green-600 truncate">+{formatCurrency(s.totalAllowance)}</p>
                </div>
                <div className="space-y-0.5 min-w-0">
                  <p className="text-muted-foreground">Potongan</p>
                  <p className="font-medium text-red-500 truncate">-{formatCurrency(s.totalDeduction)}</p>
                </div>
              </div>

              {/* Action buttons */}
              <Separator />
              <div className="flex items-center justify-end gap-1">
                <Button size="sm" variant="ghost" className="h-8 w-8 p-0"
                  onClick={() => { setSelectedSalary(s); setShowPayslip(true); }}>
                  <Eye className="w-4 h-4" />
                </Button>
                <Button size="sm" variant="ghost" className="h-8 w-8 p-0 text-green-600"
                  onClick={() => downloadPayslipPDF(s)}>
                  <Download className="w-4 h-4" />
                </Button>
                <Button size="sm" variant="ghost" className="h-8 w-8 p-0 text-blue-600"
                  onClick={() => sharePayslip(s)}>
                  <Share2 className="w-4 h-4" />
                </Button>
                {user?.role === 'super_admin' && s.status === 'pending' && (
                  <Button size="sm" variant="ghost" className="h-8 w-8 p-0 text-red-500"
                    onClick={() => {
                      if (confirm('Hapus slip gaji ini?')) deleteMutation.mutate(s.id);
                    }}>
                    <Trash2 className="w-4 h-4" />
                  </Button>
                )}
              </div>
            </Card>
          ))
        )}
      </div>

      {/* Salary List - Desktop Table Layout */}
      <Card className="hidden md:block">
        <CardContent className="p-0">
          <ScrollArea className="max-h-[600px]">
            <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="whitespace-nowrap">Karyawan</TableHead>
                  <TableHead className="whitespace-nowrap">Periode</TableHead>
                  <TableHead className="whitespace-nowrap text-right">Gaji Pokok</TableHead>
                  <TableHead className="whitespace-nowrap text-right">Tambahan</TableHead>
                  <TableHead className="whitespace-nowrap text-right">Potongan</TableHead>
                  <TableHead className="whitespace-nowrap text-right">Total</TableHead>
                  <TableHead className="whitespace-nowrap">Status</TableHead>
                  <TableHead className="whitespace-nowrap text-center">Aksi</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredSalaries.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                      <Receipt className="w-12 h-12 mx-auto mb-2 opacity-20" />
                      <p>Belum ada data penggajian</p>
                      {user?.role === 'super_admin' && (
                        <Button size="sm" variant="outline" className="mt-2" onClick={() => setShowCreate(true)}>
                          <Plus className="w-4 h-4 mr-1" /> Buat Penggajian Pertama
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredSalaries.map((s: SalaryPayment) => (
                    <TableRow key={s.id}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Avatar className="h-7 w-7">
                            <AvatarFallback className="text-xs">{getInitials(s.user?.name || '?')}</AvatarFallback>
                          </Avatar>
                          <div>
                            <p className="font-medium text-sm">{s.user?.name}</p>
                            <p className="text-xs text-muted-foreground">{s.user?.role}</p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="text-xs">
                        {formatDate(s.periodStart)}<br/>s/d {formatDate(s.periodEnd)}
                      </TableCell>
                      <TableCell className="text-right text-sm">{formatCurrency(s.baseSalary)}</TableCell>
                      <TableCell className="text-right text-sm text-green-600">+{formatCurrency(s.totalAllowance)}</TableCell>
                      <TableCell className="text-right text-sm text-red-500">-{formatCurrency(s.totalDeduction)}</TableCell>
                      <TableCell className="text-right font-bold text-sm">{formatCurrency(s.totalAmount)}</TableCell>
                      <TableCell>{getStatusBadge(s.status)}</TableCell>
                      <TableCell className="text-center">
                        <div className="flex items-center justify-center gap-1">
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button size="sm" variant="ghost" className="h-8 w-8 p-0 sm:h-7 sm:w-7"
                                  onClick={() => { setSelectedSalary(s); setShowPayslip(true); }}>
                                  <Eye className="w-4 h-4" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent><p>Lihat Slip Gaji</p></TooltipContent>
                            </Tooltip>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button size="sm" variant="ghost" className="h-8 w-8 p-0 sm:h-7 sm:w-7 text-green-600"
                                  onClick={() => downloadPayslipPDF(s)}>
                                  <Download className="w-4 h-4" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent><p>Download PDF</p></TooltipContent>
                            </Tooltip>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button size="sm" variant="ghost" className="h-8 w-8 p-0 sm:h-7 sm:w-7 text-blue-600"
                                  onClick={() => sharePayslip(s)}>
                                  <Share2 className="w-4 h-4" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent><p>Share Slip Gaji</p></TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                          {user?.role === 'super_admin' && s.status === 'pending' && (
                            <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button size="sm" variant="ghost" className="h-8 w-8 p-0 sm:h-7 sm:w-7 text-red-500"
                                    onClick={() => {
                                      if (confirm('Hapus slip gaji ini?')) deleteMutation.mutate(s.id);
                                    }}>
                                    <Trash2 className="w-4 h-4" />
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent><p>Hapus</p></TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          )}

                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
            </div>
          </ScrollArea>
        </CardContent>
      </Card>

      {/* Payslip Dialog */}
      <Dialog open={showPayslip} onOpenChange={setShowPayslip}>
        <DialogContent className="sm:max-w-2xl w-[calc(100%-2rem)] max-h-[85dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Receipt className="w-5 h-5" />
              Slip Gaji
            </DialogTitle>
          </DialogHeader>
          {selectedSalary && (
            <PayslipView salary={selectedSalary} />
          )}
        </DialogContent>
      </Dialog>


    </div>
  );
}

// Payslip PDF Generator & Web Share
async function generatePayslipPDF(salary: SalaryPayment): Promise<Blob> {
  const { default: jsPDF } = await import('jspdf');
  const autoTable = (await import('jspdf-autotable')).default;

  const doc = new jsPDF('p', 'mm', 'a4');
  const pageWidth = doc.internal.pageSize.getWidth();
  const marginX = 15;
  let y = 15;

  // Company Header
  doc.setFontSize(18);
  doc.setFont('helvetica', 'bold');
  doc.text('SLIP GAJI', pageWidth / 2, y, { align: 'center' });
  y += 6;
  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(120, 120, 120);
  doc.text(`Dicetak: ${new Date().toLocaleDateString('id-ID', { day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })}`, pageWidth / 2, y, { align: 'center' });
  y += 10;

  // Employee Info
  doc.setTextColor(0, 0, 0);
  doc.setFontSize(10);
  const empName = salary.user?.name || '-';
  const empRole = salary.user?.role?.replace('_', ' ') || '-';
  const periodText = `${new Date(salary.periodStart).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' })} s/d ${new Date(salary.periodEnd).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' })}`;

  const empInfo = [
    ['Nama Karyawan', empName],
    ['Jabatan', empRole.charAt(0).toUpperCase() + empRole.slice(1)],
    ['Periode Gaji', periodText],
    ['Status', salary.status === 'paid' ? `Dibayar - ${salary.paidAt ? new Date(salary.paidAt).toLocaleDateString('id-ID') : '-'}` : salary.status === 'approved' ? 'Disetujui' : salary.status === 'rejected' ? 'Ditolak' : 'Menunggu Persetujuan'],
  ];

  autoTable(doc, {
    startY: y,
    body: empInfo,
    theme: 'plain',
    margin: { left: marginX, right: marginX },
    styles: { fontSize: 9, cellPadding: 2 },
    columnStyles: {
      0: { fontStyle: 'bold', cellWidth: 35, textColor: [100, 100, 100] },
      1: { cellWidth: 120 }
    },
  });

  y = (doc as any).lastAutoTable.finalY + 8;

  // Pendapatan Table
  const incomeItems: [string, number][] = [];
  if (salary.baseSalary > 0) incomeItems.push(['Gaji Pokok', salary.baseSalary]);
  if (salary.transportAllowance > 0) incomeItems.push(['Tunjangan Transport', salary.transportAllowance]);
  if (salary.mealAllowance > 0) incomeItems.push(['Tunjangan Makan', salary.mealAllowance]);
  if (salary.overtimePay > 0) incomeItems.push(['Lembur', salary.overtimePay]);
  if (salary.incentive > 0) incomeItems.push(['Insentif', salary.incentive]);
  if (salary.otherAllowance > 0) incomeItems.push(['Tunjangan Lainnya', salary.otherAllowance]);
  if (salary.bonus > 0) incomeItems.push(['Bonus', salary.bonus]);
  incomeItems.push(['', 0] as [string, number]);
  incomeItems.push(['Total Pendapatan', salary.baseSalary + salary.totalAllowance] as [string, number]);

  autoTable(doc, {
    startY: y,
    head: [['PENDAPATAN', 'JUMLAH (Rp)']],
    body: incomeItems.map((row, idx) => {
      if (idx === incomeItems.length - 1) return [{ content: row[0], styles: { fontStyle: 'bold' } }, { content: formatCurrency(row[1]), styles: { fontStyle: 'bold' } }];
      if (idx === incomeItems.length - 2) return ['-', ''];
      return [row[0], formatCurrency(row[1])];
    }),
    theme: 'grid',
    headStyles: { fillColor: [34, 197, 94], textColor: 255, fontSize: 9 },
    margin: { left: marginX, right: marginX },
    styles: { fontSize: 9, cellPadding: 3, halign: 'right' },
    columnStyles: {
      0: { halign: 'left', fontStyle: 'normal' },
      1: { cellWidth: 55 }
    },
  });

  y = (doc as any).lastAutoTable.finalY + 6;

  // Pengurangan Table
  const deductionItems: [string, number][] = [];
  if (salary.bpjsTk > 0) deductionItems.push(['BPJS TK', salary.bpjsTk]);
  if (salary.bpjsKs > 0) deductionItems.push(['BPJS Kesehatan', salary.bpjsKs]);
  if (salary.pph21 > 0) deductionItems.push(['PPh 21', salary.pph21]);
  if (salary.loanDeduction > 0) deductionItems.push(['Potongan Pinjaman', salary.loanDeduction]);
  if (salary.absenceDeduction > 0) deductionItems.push(['Potongan Absensi', salary.absenceDeduction]);
  if (salary.lateDeduction > 0) deductionItems.push(['Potongan Terlambat', salary.lateDeduction]);
  if (salary.otherDeduction > 0) deductionItems.push(['Potongan Lainnya', salary.otherDeduction]);
  if (salary.deduction > 0) deductionItems.push(['Potongan Lain-lain', salary.deduction]);
  if (deductionItems.length === 0) deductionItems.push(['Tidak ada potongan', 0]);
  deductionItems.push(['', 0] as [string, number]);
  deductionItems.push(['Total Pengurangan', salary.totalDeduction]);

  autoTable(doc, {
    startY: y,
    head: [['PENGURANGAN', 'JUMLAH (Rp)']],
    body: deductionItems.map((row, idx) => {
      if (idx === deductionItems.length - 1) return [{ content: row[0], styles: { fontStyle: 'bold' } }, { content: formatCurrency(row[1]), styles: { fontStyle: 'bold' } }];
      if (idx === deductionItems.length - 2) return ['-', ''];
      return [row[0], formatCurrency(row[1])];
    }),
    theme: 'grid',
    headStyles: { fillColor: [239, 68, 68], textColor: 255, fontSize: 9 },
    margin: { left: marginX, right: marginX },
    styles: { fontSize: 9, cellPadding: 3, halign: 'right' },
    columnStyles: {
      0: { halign: 'left', fontStyle: 'normal' },
      1: { cellWidth: 55 }
    },
  });

  y = (doc as any).lastAutoTable.finalY + 8;

  // Total Net (GAJI BERSIH) - highlighted box
  const boxWidth = pageWidth - marginX * 2;
  doc.setFillColor(240, 253, 244);
  doc.setDrawColor(34, 197, 94);
  doc.roundedRect(marginX, y, boxWidth, 16, 2, 2, 'FD');
  doc.setFontSize(12);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(22, 163, 74);
  doc.text('GAJI BERSIH', marginX + 4, y + 7);
  doc.text(formatCurrency(salary.totalAmount), pageWidth - marginX - 4, y + 7, { align: 'right' });
  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(100, 100, 100);
  doc.text(`(Gaji Pokok ${formatCurrency(salary.baseSalary)} + Tambahan ${formatCurrency(salary.totalAllowance)} - Potongan ${formatCurrency(salary.totalDeduction)})`, pageWidth / 2, y + 13, { align: 'center' });

  y += 22;

  // Signature area
  doc.setTextColor(0, 0, 0);
  doc.setFontSize(9);
  const signY = Math.max(y, 240);
  const halfPage = pageWidth / 2;
  const leftSignX = marginX + 25;
  const rightSignX = halfPage + 25;

  doc.text('Penerima,', leftSignX, signY, { align: 'center' });
  doc.text('HRD / Keuangan,', rightSignX, signY, { align: 'center' });
  doc.text('', leftSignX, signY + 5);
  doc.text('', rightSignX, signY + 5);
  doc.text('(____________________)', leftSignX, signY + 25, { align: 'center' });
  doc.text('(____________________)', rightSignX, signY + 25, { align: 'center' });
  doc.setFontSize(7);
  doc.setTextColor(120, 120, 120);
  doc.text(empName, leftSignX, signY + 29, { align: 'center' });

  // Footer
  doc.setFontSize(7);
  doc.setTextColor(160, 160, 160);
  doc.text(`Dokumen ini digenerate secara otomatis oleh sistem ERP - ${new Date().toISOString()}`, pageWidth / 2, 285, { align: 'center' });

  return doc.output('blob');
}

function downloadPayslipPDF(salary: SalaryPayment) {
  toast.loading('Membuat PDF slip gaji...', { id: 'pdf-gen' });
  generatePayslipPDF(salary).then(blob => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Slip_Gaji_${salary.user?.name?.replace(/\s+/g, '_')}_${toLocalDateStr(new Date(salary.periodStart))}.pdf`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.dismiss('pdf-gen');
    toast.success('PDF slip gaji berhasil didownload');
  }).catch(() => {
    toast.dismiss('pdf-gen');
    toast.error('Gagal membuat PDF');
  });
}

async function sharePayslip(salary: SalaryPayment) {
  if (!navigator.share) {
    toast.error('Browser tidak mendukung fitur Web Share');
    return;
  }
  try {
    toast.loading('Menyiapkan slip gaji...', { id: 'share-gen' });
    const blob = await generatePayslipPDF(salary);
    const file = new File([blob], `Slip_Gaji_${salary.user?.name?.replace(/\s+/g, '_')}.pdf`, { type: 'application/pdf' });

    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({
        title: `Slip Gaji - ${salary.user?.name}`,
        text: `Slip Gaji ${salary.user?.name} periode ${formatDate(salary.periodStart)} s/d ${formatDate(salary.periodEnd)}. Gaji Bersih: ${formatCurrency(salary.totalAmount)}`,
        files: [file]
      });
      toast.dismiss('share-gen');
      toast.success('Berhasil membagikan slip gaji');
    } else {
      // Fallback: share without file
      toast.dismiss('share-gen');
      await navigator.share({
        title: `Slip Gaji - ${salary.user?.name}`,
        text: `Slip Gaji ${salary.user?.name} periode ${formatDate(salary.periodStart)} s/d ${formatDate(salary.periodEnd)}. Gaji Bersih: ${formatCurrency(salary.totalAmount)}`
      });
      toast.success('Berhasil membagikan informasi slip gaji');
    }
  } catch (err: any) {
    toast.dismiss('share-gen');
    if (err.name !== 'AbortError') {
      toast.error('Gagal membagikan slip gaji');
    }
  }
}

// Payslip View Component
function PayslipView({ salary }: { salary: SalaryPayment }) {
  const settingQuery = useQuery({
    queryKey: ['settings'],
    queryFn: () => apiFetch<{ settings: any }>('/api/settings'),
  });
  const settings = settingQuery.data?.settings || {};
  const companyName = settings.company_name || 'Razkindo';

  const incomeItems = [
    { label: 'Gaji Pokok', value: salary.baseSalary },
    { label: 'Tunjangan Transport', value: salary.transportAllowance },
    { label: 'Tunjangan Makan', value: salary.mealAllowance },
    { label: 'Lembur', value: salary.overtimePay },
    { label: 'Insentif', value: salary.incentive },
    { label: 'Tunjangan Lainnya', value: salary.otherAllowance },
    { label: 'Bonus', value: salary.bonus },
  ].filter(i => i.value > 0);

  const deductionItems = [
    { label: 'BPJS TK', value: salary.bpjsTk },
    { label: 'BPJS Kesehatan', value: salary.bpjsKs },
    { label: 'PPh 21', value: salary.pph21 },
    { label: 'Potongan Pinjaman', value: salary.loanDeduction },
    { label: 'Potongan Absensi', value: salary.absenceDeduction },
    { label: 'Potongan Terlambat', value: salary.lateDeduction },
    { label: 'Potongan Lainnya', value: salary.otherDeduction },
    { label: 'Potongan Lain-lain', value: salary.deduction },
  ].filter(i => i.value > 0);

  return (
    <div className="space-y-4" id="payslip-print">
      {/* Action Buttons */}
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="outline" onClick={() => downloadPayslipPDF(salary)}>
          <Download className="w-4 h-4 mr-1" />
          Download PDF
        </Button>
        <Button size="sm" variant="outline" onClick={() => sharePayslip(salary)}>
          <Share2 className="w-4 h-4 mr-1" />
          Share
        </Button>
      </div>

      {/* Header */}
      <div className="text-center border-b pb-4">
        <h3 className="text-lg font-bold">{companyName}</h3>
        <p className="text-sm text-muted-foreground">SLIP GAJI</p>
        <div className="flex flex-col sm:flex-row justify-center gap-4 sm:gap-8 mt-3 text-sm">
          <div>
            <p className="text-muted-foreground">Nama</p>
            <p className="font-semibold">{salary.user?.name}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Jabatan</p>
            <p className="font-semibold capitalize">{salary.user?.role?.replace('_', ' ')}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Periode</p>
            <p className="font-semibold">{formatDate(salary.periodStart)} - {formatDate(salary.periodEnd)}</p>
          </div>
        </div>
      </div>

      {/* Income Section */}
      <div>
        <h4 className="font-semibold text-sm text-green-600 mb-2 border-b pb-1">PENDAPATAN</h4>
        <div className="space-y-1">
          {incomeItems.map((item, idx) => (
            <div key={idx} className="flex justify-between text-sm">
              <span>{item.label}</span>
              <span className="text-green-600">{formatCurrency(item.value)}</span>
            </div>
          ))}
          <Separator className="my-2" />
          <div className="flex justify-between text-sm font-bold">
            <span>Total Pendapatan</span>
            <span className="text-green-600">{formatCurrency(salary.baseSalary + salary.totalAllowance)}</span>
          </div>
        </div>
      </div>

      {/* Deduction Section */}
      <div>
        <h4 className="font-semibold text-sm text-red-500 mb-2 border-b pb-1">PENGURANG</h4>
        <div className="space-y-1">
          {deductionItems.length === 0 ? (
            <p className="text-sm text-muted-foreground">Tidak ada potongan</p>
          ) : (
            deductionItems.map((item, idx) => (
              <div key={idx} className="flex justify-between text-sm">
                <span>{item.label}</span>
                <span className="text-red-500">-{formatCurrency(item.value)}</span>
              </div>
            ))
          )}
          <Separator className="my-2" />
          <div className="flex justify-between text-sm font-bold">
            <span>Total Pengurang</span>
            <span className="text-red-500">-{formatCurrency(salary.totalDeduction)}</span>
          </div>
        </div>
      </div>

      {/* Total */}
      <div className="bg-muted rounded-lg p-4">
        <div className="flex justify-between items-center">
          <span className="text-lg font-bold">GAJI BERSIH</span>
          <span className="text-2xl font-bold text-primary">{formatCurrency(salary.totalAmount)}</span>
        </div>
      </div>

      {/* Footer Info */}
      <div className="flex flex-col sm:flex-row justify-between text-xs text-muted-foreground border-t pt-3 gap-2">
        <div>
          <p>Dibuat: {formatDateTime(salary.createdAt)}</p>
          <p>Status: {salary.status === 'paid' ? `Dibayar ${salary.paidAt ? formatDate(salary.paidAt) : '-'}` : salary.status}</p>
        </div>
        <div className="text-right">
          {salary.notes && <p>Catatan: {salary.notes}</p>}
        </div>
      </div>
    </div>
  );
}

// Enhanced Salary Form Component
function SalaryForm({ users, requestById, unitId, onSuccess }: {
  users: User[];
  requestById: string;
  unitId?: string;
  onSuccess: () => void;
}) {
  const [step, setStep] = useState(1);
  const [selectedUser, setSelectedUser] = useState('');
  const [formData, setFormData] = useState({
    periodStart: monthStartLocal(),
    periodEnd: toLocalDateStr(new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0)),
    baseSalary: 0,
    transportAllowance: 0,
    mealAllowance: 0,
    overtimePay: 0,
    incentive: 0,
    otherAllowance: 0,
    bonus: 0,
    bpjsTk: 0,
    bpjsKs: 0,
    pph21: 0,
    loanDeduction: 0,
    absenceDeduction: 0,
    lateDeduction: 0,
    otherDeduction: 0,
    deduction: 0,
    notes: ''
  });
  const [loading, setLoading] = useState(false);

  const totalAllowance = formData.transportAllowance + formData.mealAllowance + formData.overtimePay + formData.incentive + formData.otherAllowance + formData.bonus;
  const totalDeduction = formData.bpjsTk + formData.bpjsKs + formData.pph21 + formData.loanDeduction + formData.absenceDeduction + formData.lateDeduction + formData.otherDeduction + formData.deduction;
  const totalAmount = formData.baseSalary + totalAllowance - totalDeduction;

  const updateField = (field: string, value: number | string) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };
  
  const handleSubmit = async () => {
    if (!selectedUser) {
      toast.error('Pilih karyawan terlebih dahulu');
      return;
    }
    if (formData.baseSalary <= 0) {
      toast.error('Gaji pokok harus lebih dari 0');
      return;
    }

    setLoading(true);
    try {
      await apiFetch('/api/salaries', {
        method: 'POST',
        body: JSON.stringify({
          ...formData,
          userId: selectedUser,
          requestById,
          unitId
        })
      });
      
      toast.success('Slip gaji berhasil dibuat! Request telah dikirim ke Finance.');
      onSuccess();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* Step 1: Select Employee & Period */}
      {step === 1 && (
        <div className="space-y-4">
          <div className="space-y-2">
            <Label className="font-semibold">Pilih Karyawan <span className="text-red-500">*</span></Label>
            <Select value={selectedUser} onValueChange={setSelectedUser}>
              <SelectTrigger>
                <SelectValue placeholder="Pilih karyawan..." />
              </SelectTrigger>
              <SelectContent>
                {users.filter(u => u.role !== 'super_admin' && u.status === 'approved').map(u => (
                  <SelectItem key={u.id} value={u.id}>
                    <span className="inline-flex items-center gap-2">
                      <Avatar className="h-6 w-6">
                        <AvatarFallback className="text-xs">{getInitials(u.name)}</AvatarFallback>
                      </Avatar>
                      <span>
                        <span>{u.name}</span>
                        <span className="text-muted-foreground ml-2 text-xs">({u.role})</span>
                      </span>
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Periode Mulai</Label>
              <Input type="date" value={formData.periodStart} onChange={e => updateField('periodStart', e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Periode Selesai</Label>
              <Input type="date" value={formData.periodEnd} onChange={e => updateField('periodEnd', e.target.value)} />
            </div>
          </div>

          <div className="flex justify-end">
            <Button onClick={() => { if (selectedUser) setStep(2); else toast.error('Pilih karyawan'); }} disabled={!selectedUser}>
              Lanjut <ArrowRight className="w-4 h-4 ml-1" />
            </Button>
          </div>
        </div>
      )}

      {/* Step 2: Salary Components */}
      {step === 2 && (
        <div className="space-y-5">
          {/* Pendapatan */}
          <div className="space-y-3">
            <h4 className="font-semibold text-green-600 flex items-center gap-2">
              <TrendingUp className="w-4 h-4" /> Pendapatan
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Gaji Pokok <span className="text-red-500">*</span></Label>
                <Input type="number" placeholder="0" value={formData.baseSalary || ''} onChange={e => updateField('baseSalary', parseFloat(e.target.value) || 0)} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Tunjangan Transport</Label>
                <Input type="number" placeholder="0" value={formData.transportAllowance || ''} onChange={e => updateField('transportAllowance', parseFloat(e.target.value) || 0)} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Tunjangan Makan</Label>
                <Input type="number" placeholder="0" value={formData.mealAllowance || ''} onChange={e => updateField('mealAllowance', parseFloat(e.target.value) || 0)} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Lembur</Label>
                <Input type="number" placeholder="0" value={formData.overtimePay || ''} onChange={e => updateField('overtimePay', parseFloat(e.target.value) || 0)} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Insentif</Label>
                <Input type="number" placeholder="0" value={formData.incentive || ''} onChange={e => updateField('incentive', parseFloat(e.target.value) || 0)} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Tunjangan Lainnya</Label>
                <Input type="number" placeholder="0" value={formData.otherAllowance || ''} onChange={e => updateField('otherAllowance', parseFloat(e.target.value) || 0)} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Bonus</Label>
                <Input type="number" placeholder="0" value={formData.bonus || ''} onChange={e => updateField('bonus', parseFloat(e.target.value) || 0)} />
              </div>
            </div>
            <div className="text-right text-sm text-green-600 font-medium bg-green-50 p-2 rounded">
              Subtotal Pendapatan: {formatCurrency(formData.baseSalary + totalAllowance)}
            </div>
          </div>

          {/* Pengurang */}
          <div className="space-y-3">
            <h4 className="font-semibold text-red-500 flex items-center gap-2">
              <TrendingDown className="w-4 h-4" /> Pengurangan
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">BPJS TK</Label>
                <Input type="number" placeholder="0" value={formData.bpjsTk || ''} onChange={e => updateField('bpjsTk', parseFloat(e.target.value) || 0)} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">BPJS Kesehatan</Label>
                <Input type="number" placeholder="0" value={formData.bpjsKs || ''} onChange={e => updateField('bpjsKs', parseFloat(e.target.value) || 0)} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">PPh 21</Label>
                <Input type="number" placeholder="0" value={formData.pph21 || ''} onChange={e => updateField('pph21', parseFloat(e.target.value) || 0)} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Potongan Pinjaman</Label>
                <Input type="number" placeholder="0" value={formData.loanDeduction || ''} onChange={e => updateField('loanDeduction', parseFloat(e.target.value) || 0)} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Potongan Absensi</Label>
                <Input type="number" placeholder="0" value={formData.absenceDeduction || ''} onChange={e => updateField('absenceDeduction', parseFloat(e.target.value) || 0)} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Potongan Terlambat</Label>
                <Input type="number" placeholder="0" value={formData.lateDeduction || ''} onChange={e => updateField('lateDeduction', parseFloat(e.target.value) || 0)} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Potongan Lainnya</Label>
                <Input type="number" placeholder="0" value={formData.otherDeduction || ''} onChange={e => updateField('otherDeduction', parseFloat(e.target.value) || 0)} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Potongan Lain-lain</Label>
                <Input type="number" placeholder="0" value={formData.deduction || ''} onChange={e => updateField('deduction', parseFloat(e.target.value) || 0)} />
              </div>
            </div>
            <div className="text-right text-sm text-red-500 font-medium bg-red-50 p-2 rounded">
              Subtotal Pengurangan: -{formatCurrency(totalDeduction)}
            </div>
          </div>

          <div className="flex justify-between">
            <Button variant="outline" onClick={() => setStep(1)}>
              <ArrowRight className="w-4 h-4 mr-1 rotate-180" /> Kembali
            </Button>
            <Button onClick={() => setStep(3)}>
              Lanjut <ArrowRight className="w-4 h-4 ml-1" />
            </Button>
          </div>
        </div>
      )}

      {/* Step 3: Review & Submit */}
      {step === 3 && (
        <div className="space-y-4">
          {/* Summary */}
          <div className="bg-muted rounded-lg p-4 space-y-2">
            <h4 className="font-semibold text-center">Ringkasan Slip Gaji</h4>
            <div className="text-sm">
              <div className="flex justify-between"><span>Karyawan:</span><span className="font-medium">{users.find(u => u.id === selectedUser)?.name}</span></div>
              <div className="flex justify-between"><span>Periode:</span><span>{formatDate(formData.periodStart)} - {formatDate(formData.periodEnd)}</span></div>
            </div>
            <Separator />
            <div className="text-sm space-y-1">
              <div className="flex justify-between"><span>Gaji Pokok</span><span>{formatCurrency(formData.baseSalary)}</span></div>
              {totalAllowance > 0 && <div className="flex justify-between text-green-600"><span>Tambahan</span><span>+{formatCurrency(totalAllowance)}</span></div>}
              {totalDeduction > 0 && <div className="flex justify-between text-red-500"><span>Potongan</span><span>-{formatCurrency(totalDeduction)}</span></div>}
            </div>
            <Separator />
            <div className="flex justify-between text-lg font-bold">
              <span>Gaji Bersih</span>
              <span className="text-primary">{formatCurrency(totalAmount)}</span>
            </div>
          </div>

          <div className="space-y-2">
            <Label className="text-xs">Catatan (opsional)</Label>
            <Textarea placeholder="Catatan tambahan..." value={formData.notes} onChange={e => updateField('notes', e.target.value)} rows={2} />
          </div>

          {/* Finance request notice */}
          <Alert className="bg-blue-50 border-blue-200">
            <AlertCircle className="w-4 h-4 text-blue-600" />
            <AlertTitle className="text-blue-800">Request ke Finance</AlertTitle>
            <AlertDescription className="text-blue-700 text-xs">
              Setelah disimpan, slip gaji ini akan otomatis mengirim request pembayaran ke bagian Finance untuk diproses dan disetujui.
            </AlertDescription>
          </Alert>

          <div className="flex justify-between">
            <Button variant="outline" onClick={() => setStep(2)}>
              <ArrowRight className="w-4 h-4 mr-1 rotate-180" /> Kembali
            </Button>
            <Button onClick={handleSubmit} disabled={loading || totalAmount <= 0}>
              {loading ? (
                <><RefreshCw className="w-4 h-4 mr-1 animate-spin" /> Mengirim...</>
              ) : (
                <><Send className="w-4 h-4 mr-1" /> Buat & Request ke Finance</>
              )}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
