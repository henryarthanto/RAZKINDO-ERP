'use client';

import { useState } from 'react';
import { useAuthStore } from '@/stores/auth-store';
import { useUnitStore } from '@/stores/unit-store';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { apiFetch } from '@/lib/api-client';
import { RefreshCw, Download, FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem
} from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Table, TableHeader, TableRow, TableHead, TableBody, TableCell
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { formatCurrency, formatDate, formatStock, monthStartLocal, todayLocal } from '@/lib/erp-helpers';

export default function ReportsModule() {
  const { user } = useAuthStore();
  const { units, selectedUnitId } = useUnitStore();
  const [reportType, setReportType] = useState('sales');
  const [dateRange, setDateRange] = useState({
    startDate: monthStartLocal(),
    endDate: todayLocal()
  });
  const [unitId, setUnitId] = useState(selectedUnitId || '');
  
  const params = new URLSearchParams({
    type: reportType,
    startDate: dateRange.startDate,
    endDate: dateRange.endDate
  });
  if (unitId) params.set('unitId', unitId);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['reports', reportType, dateRange, unitId],
    queryFn: () => apiFetch<{ report: any }>(`/api/reports?${params.toString()}`),
    enabled: false
  });
  
  const report = data?.report;
  
  const handleExport = (format: 'csv' | 'pdf') => {
    toast.info(`Export ${format.toUpperCase()} akan segera tersedia`);
  };
  
  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-wrap gap-3">
            <Select value={reportType} onValueChange={setReportType}>
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="sales">Penjualan</SelectItem>
                <SelectItem value="profit">Profit</SelectItem>
                <SelectItem value="stock">Stok</SelectItem>
                <SelectItem value="receivables">Piutang</SelectItem>
                <SelectItem value="users">Kinerja Karyawan</SelectItem>
              </SelectContent>
            </Select>
            
            <Input
              type="date"
              value={dateRange.startDate}
              onChange={e => setDateRange({ ...dateRange, startDate: e.target.value })}
              className="w-36"
            />
            <Input
              type="date"
              value={dateRange.endDate}
              onChange={e => setDateRange({ ...dateRange, endDate: e.target.value })}
              className="w-36"
            />
            
            {user?.role === 'super_admin' && (
              <Select value={unitId} onValueChange={setUnitId}>
                <SelectTrigger className="w-40">
                  <SelectValue placeholder="Semua Unit" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Semua Unit</SelectItem>
                  {units.map(u => (
                    <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            
            <Button onClick={() => refetch()}>
              <RefreshCw className="w-4 h-4 mr-2" />
              Generate
            </Button>
          </div>
        </CardContent>
      </Card>
      
      {report && (
        <Card>
          <CardHeader>
            <div className="flex justify-between items-center">
              <CardTitle>Laporan {report.type}</CardTitle>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => handleExport('csv')}>
                  <Download className="w-4 h-4 mr-2" />
                  CSV
                </Button>
                <Button variant="outline" size="sm" onClick={() => handleExport('pdf')}>
                  <FileText className="w-4 h-4 mr-2" />
                  PDF
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {report.summary && (
              <div className="grid sm:grid-cols-4 gap-4 mb-4">
                {Object.entries(report.summary).map(([key, value]) => (
                  <div key={key} className="p-3 bg-muted rounded-lg">
                    <p className="text-xs text-muted-foreground capitalize">{key.replace(/([A-Z])/g, ' $1')}</p>
                    <p className="text-lg font-bold">
                      {typeof value === 'number' ? formatCurrency(value) : String(value)}
                    </p>
                  </div>
                ))}
              </div>
            )}
            
            {report.transactions && (
              <ScrollArea className="h-96">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Invoice</TableHead>
                      <TableHead>Tanggal</TableHead>
                      <TableHead>Customer</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                      {user?.role === 'super_admin' && (
                        <TableHead className="text-right">Profit</TableHead>
                      )}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {report.transactions.map((t: any, i: number) => (
                      <TableRow key={i}>
                        <TableCell>{t.invoiceNo}</TableCell>
                        <TableCell>{formatDate(t.date)}</TableCell>
                        <TableCell>{t.customer}</TableCell>
                        <TableCell className="text-right">{formatCurrency(t.total)}</TableCell>
                        {user?.role === 'super_admin' && (
                          <TableCell className="text-right text-emerald-500">{formatCurrency(t.profit)}</TableCell>
                        )}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </ScrollArea>
            )}
            
            {report.products && (
              <ScrollArea className="h-96">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Produk</TableHead>
                      <TableHead>SKU</TableHead>
                      <TableHead className="text-right">Stok</TableHead>
                      <TableHead className="text-right">Min Stok</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {report.products.map((p: any, i: number) => (
                      <TableRow key={i}>
                        <TableCell>{p.name}</TableCell>
                        <TableCell>{p.sku}</TableCell>
                        <TableCell className="text-right">{formatStock(p.globalStock, p.unit, p.subUnit, p.conversionRate)}</TableCell>
                        <TableCell className="text-right">{p.minStock}</TableCell>
                        <TableCell>
                          <Badge variant={p.status === 'low' ? 'destructive' : 'secondary'}>
                            {p.status}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </ScrollArea>
            )}
            
            {report.users && (
              <ScrollArea className="h-96">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Nama</TableHead>
                      <TableHead>Role</TableHead>
                      <TableHead>Unit</TableHead>
                      <TableHead className="text-right">Transaksi</TableHead>
                      <TableHead className="text-right">Penjualan</TableHead>
                      {user?.role === 'super_admin' && (
                        <TableHead className="text-right">Profit</TableHead>
                      )}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {report.users.map((u: any, i: number) => (
                      <TableRow key={i}>
                        <TableCell>{u.name}</TableCell>
                        <TableCell>{u.role}</TableCell>
                        <TableCell>{u.unit}</TableCell>
                        <TableCell className="text-right">{u.transactionCount}</TableCell>
                        <TableCell className="text-right">{formatCurrency(u.totalSales)}</TableCell>
                        {user?.role === 'super_admin' && (
                          <TableCell className="text-right text-emerald-500">{formatCurrency(u.totalProfit)}</TableCell>
                        )}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </ScrollArea>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
