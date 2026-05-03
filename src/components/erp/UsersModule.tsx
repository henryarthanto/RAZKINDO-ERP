'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api-client';
import { formatDateTime } from '@/lib/erp-helpers';
import { toast } from 'sonner';
import { useAuthStore } from '@/stores/auth-store';

import {
  Users,
  Plus,
  Search,
  MoreVertical,
  Pencil,
  Trash2,
  CheckCircle,
  XCircle,
  Shield,
  ShieldCheck,
  Ban,
  Building2,
  Check,
  UserCog,
  Briefcase,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Checkbox } from '@/components/ui/checkbox';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';

type UserItem = {
  id: string;
  email: string;
  name: string;
  phone: string | null;
  role: string;
  unitId: string | null;
  unit: { id: string; name: string } | null;
  userUnits?: { id: string; name: string }[];
  status: string;
  isActive: boolean;
  canLogin?: boolean;
  customRoleId?: string | null;
  customRole?: { id: string; name: string; description: string | null } | null;
  lastSeenAt: string | null;
  createdAt: string;
  nearCommission: number;
  farCommission: number;
};

type CustomRoleItem = {
  id: string;
  name: string;
  description: string | null;
  userCount: number;
  createdAt: string;
};

const ROLES = [
  { value: 'super_admin', label: 'Super Admin', color: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300' },
  { value: 'sales', label: 'Sales', color: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300' },
  { value: 'kurir', label: 'Kurir', color: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300' },
  { value: 'keuangan', label: 'Keuangan', color: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300' },
];

const STATUS_MAP: Record<string, { label: string; color: string }> = {
  pending: { label: 'Pending', color: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300' },
  approved: { label: 'Approved', color: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300' },
  rejected: { label: 'Rejected', color: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300' },
};

function getRoleInfo(role: string, customRole?: { name: string } | null) {
  const found = ROLES.find(r => r.value === role);
  if (found) return found;
  // Custom role
  return {
    value: role,
    label: customRole?.name || role,
    color: 'bg-gray-100 text-gray-700 dark:bg-gray-900/30 dark:text-gray-300',
  };
}

function getStatusInfo(status: string) {
  return STATUS_MAP[status] || STATUS_MAP.pending;
}

export default function UsersModule() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [editUser, setEditUser] = useState<UserItem | null>(null);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [deleteDialog, setDeleteDialog] = useState<{ user: UserItem; mode: 'deactivate' | 'delete' } | null>(null);
  const [activeTab, setActiveTab] = useState<'system' | 'employees'>('system');
  const [showAddEmployeeDialog, setShowAddEmployeeDialog] = useState(false);
  const [showManageRolesDialog, setShowManageRolesDialog] = useState(false);

  // Form for non-ERP employee
  const [empName, setEmpName] = useState('');
  const [empPhone, setEmpPhone] = useState('');
  const [empCustomRoleId, setEmpCustomRoleId] = useState('');
  const [empUnitIds, setEmpUnitIds] = useState<string[]>([]);

  // Custom roles
  const [newRoleName, setNewRoleName] = useState('');
  const [newRoleDesc, setNewRoleDesc] = useState('');
  const [editRoleId, setEditRoleId] = useState<string | null>(null);
  const [editRoleName, setEditRoleName] = useState('');
  const [editRoleDesc, setEditRoleDesc] = useState('');

  // Fetch custom roles
  const { data: customRolesData } = useQuery({
    queryKey: ['custom-roles'],
    queryFn: async () => {
      const res = await fetch('/api/custom-roles', { headers: { authorization: useAuthStore.getState().token || '' } });
      const data = await res.json();
      return data.roles || [];
    },
  });
  const customRoles: CustomRoleItem[] = customRolesData || [];

  // Form state
  const [formName, setFormName] = useState('');
  const [formEmail, setFormEmail] = useState('');
  const [formPhone, setFormPhone] = useState('');
  const [formRole, setFormRole] = useState('sales');
  const [formUnitIds, setFormUnitIds] = useState<string[]>([]);
  const [formPassword, setFormPassword] = useState('');

  // Fetch users
  const { data: usersData, isLoading } = useQuery({
    queryKey: ['users'],
    queryFn: () => api.users.getAll(),
  });

  // Fetch units for the selector
  const { data: unitsData } = useQuery({
    queryKey: ['units'],
    queryFn: () => api.units.getAll(),
  });

  const users: UserItem[] = Array.isArray(usersData?.users) ? usersData.users : [];
  const units = Array.isArray(unitsData?.units) ? unitsData.units : [];

  // Filter users by search
  const filteredUsers = users.filter(u =>
    u.name.toLowerCase().includes(search.toLowerCase()) ||
    u.email.toLowerCase().includes(search.toLowerCase()) ||
    (u.phone && u.phone.includes(search))
  );

  // Separate system users and non-ERP employees
  const systemUsers = filteredUsers.filter(u => u.canLogin !== false && !u.customRoleId);
  const nonErpEmployees = filteredUsers.filter(u => u.canLogin === false || u.customRoleId);
  const displayUsers = activeTab === 'system' ? systemUsers : nonErpEmployees;

  // Counts
  const totalUsers = systemUsers.length;
  const totalEmployees = nonErpEmployees.length;
  const activeUsers = users.filter(u => u.isActive && u.status === 'approved').length;
  const pendingUsers = users.filter(u => u.status === 'pending').length;

  // Approve mutation
  const approveMutation = useMutation({
    mutationFn: (id: string) => api.users.approve(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      toast.success('User berhasil di-approve');
    },
    onError: (err: any) => {
      toast.error(err.message || 'Gagal approve user');
    },
  });

  // Update mutation
  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => api.users.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      setEditUser(null);
      toast.success('User berhasil diperbarui');
    },
    onError: (err: any) => {
      console.error('Update user error:', err);
      const msg = err?.message || err?.details?.error || (typeof err === 'string' ? err : 'Gagal memperbarui user');
      toast.error(msg);
    },
  });

  // Delete mutation (hard delete)
  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.users.delete(id),
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      const reassigned = data?.reassigned;
      if (reassigned) {
        toast.success(`User berhasil dihapus. ${reassigned.reassignedCustomers} pelanggan & ${reassigned.reassignedOrders} order pending dipindahkan ke Super Admin.`);
      } else {
        toast.success('User berhasil dihapus');
      }
      setDeleteDialog(null);
    },
    onError: (err: any) => {
      toast.error(err.message || 'Gagal menghapus user');
    },
  });

  // Deactivate mutation (soft delete)
  const deactivateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => api.users.update(id, data),
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      const reassigned = data?.reassigned;
      if (reassigned) {
        toast.success(`User dinonaktifkan. ${reassigned.reassignedCustomers} pelanggan & ${reassigned.reassignedOrders} order pending dipindahkan ke Super Admin.`);
      } else {
        toast.success('User berhasil dinonaktifkan');
      }
      setDeleteDialog(null);
    },
    onError: (err: any) => {
      toast.error(err.message || 'Gagal menonaktifkan user');
    },
  });

  // Register mutation
  const registerMutation = useMutation({
    mutationFn: (data: any) => api.auth.register(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      setShowAddDialog(false);
      resetForm();
      toast.success('User berhasil ditambahkan');
    },
    onError: (err: any) => {
      console.error('Register user error:', err);
      const msg = err?.message || err?.details?.error || (typeof err === 'string' ? err : 'Gagal menambahkan user');
      toast.error(msg);
    },
  });

  // Add non-ERP employee mutation
  const addEmployeeMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', authorization: useAuthStore.getState().token || '' },
        body: JSON.stringify(data),
      });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error || 'Gagal'); }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      queryClient.invalidateQueries({ queryKey: ['custom-roles'] });
      setShowAddEmployeeDialog(false);
      setEmpName(''); setEmpPhone(''); setEmpCustomRoleId(''); setEmpUnitIds([]);
      toast.success('Karyawan berhasil ditambahkan');
    },
    onError: (err: any) => toast.error(err.message),
  });

  // Custom role CRUD
  const createRoleMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await fetch('/api/custom-roles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', authorization: useAuthStore.getState().token || '' },
        body: JSON.stringify(data),
      });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error || 'Gagal'); }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['custom-roles'] });
      setNewRoleName(''); setNewRoleDesc('');
      toast.success('Role berhasil ditambahkan');
    },
    onError: (err: any) => toast.error(err.message),
  });

  const updateRoleMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: any }) => {
      const res = await fetch(`/api/custom-roles/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', authorization: useAuthStore.getState().token || '' },
        body: JSON.stringify(data),
      });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error || 'Gagal'); }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['custom-roles'] });
      queryClient.invalidateQueries({ queryKey: ['users'] });
      setEditRoleId(null);
      toast.success('Role berhasil diperbarui');
    },
    onError: (err: any) => toast.error(err.message),
  });

  const deleteRoleMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/custom-roles/${id}`, {
        method: 'DELETE',
        headers: { authorization: useAuthStore.getState().token || '' },
      });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error || 'Gagal'); }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['custom-roles'] });
      toast.success('Role berhasil dihapus');
    },
    onError: (err: any) => toast.error(err.message),
  });

  // Toggle unit in add form
  const toggleFormUnit = (unitId: string) => {
    setFormUnitIds(prev =>
      prev.includes(unitId)
        ? prev.filter(id => id !== unitId)
        : [...prev, unitId]
    );
  };

  const resetForm = () => {
    setFormName('');
    setFormEmail('');
    setFormPhone('');
    setFormRole('sales');
    setFormUnitIds([]);
    setFormPassword('');
  };

  const handleAddUser = () => {
    if (!formName || !formEmail || !formPassword) {
      toast.error('Nama, email, dan password wajib diisi');
      return;
    }
    if (formPassword.length < 6) {
      toast.error('Password minimal 6 karakter');
      return;
    }
    if (formRole !== 'super_admin' && formUnitIds.length === 0) {
      toast.error('Pilih minimal 1 unit');
      return;
    }
    registerMutation.mutate({
      name: formName,
      email: formEmail,
      phone: formPhone || undefined,
      password: formPassword,
      role: formRole,
      unitIds: formUnitIds.length > 0 ? formUnitIds : undefined,
      status: 'approved',
    });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin w-8 h-8 border-2 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="space-y-4 mx-auto max-w-4xl w-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Users className="w-5 h-5" />
            Pengguna & Karyawan
          </h2>
          <p className="text-sm text-muted-foreground">{totalUsers} pengguna sistem · {totalEmployees} karyawan non-ERP</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Dialog open={showManageRolesDialog} onOpenChange={setShowManageRolesDialog}>
            <DialogTrigger asChild>
              <Button size="sm" variant="outline" className="gap-1.5">
                <UserCog className="w-4 h-4" />
                Kelola Role
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2"><UserCog className="w-5 h-5" />Role Kustom</DialogTitle>
                <DialogDescription>Buat role untuk karyawan non-ERP (OB, Sopir, Security, dll)</DialogDescription>
              </DialogHeader>
              <div className="space-y-4 pt-2">
                {customRoles.length === 0 ? (
                  <div className="text-center py-4 text-sm text-muted-foreground">
                    <Briefcase className="w-8 h-8 mx-auto mb-2 text-muted-foreground/50" />
                    <p>Belum ada role kustom</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {customRoles.map((cr) => (
                      <div key={cr.id} className="flex items-center justify-between p-3 rounded-lg border gap-2">
                        {editRoleId === cr.id ? (
                          <div className="flex-1 space-y-1">
                            <Input value={editRoleName} onChange={e => setEditRoleName(e.target.value)} className="h-8 text-sm" />
                            <Input value={editRoleDesc} onChange={e => setEditRoleDesc(e.target.value)} placeholder="Deskripsi (opsional)" className="h-8 text-sm" />
                          </div>
                        ) : (
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium">{cr.name}</p>
                            {cr.description && <p className="text-xs text-muted-foreground">{cr.description}</p>}
                            <p className="text-[10px] text-muted-foreground mt-0.5">{cr.userCount} karyawan</p>
                          </div>
                        )}
                        <div className="flex items-center gap-1 shrink-0">
                          {editRoleId === cr.id ? (
                            <>
                              <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => updateRoleMutation.mutate({ id: cr.id, data: { name: editRoleName, description: editRoleDesc } })} disabled={updateRoleMutation.isPending}>
                                <Check className="w-3.5 h-3.5" />
                              </Button>
                              <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => setEditRoleId(null)}>
                                <XCircle className="w-3.5 h-3.5" />
                              </Button>
                            </>
                          ) : (
                            <>
                              <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => { setEditRoleId(cr.id); setEditRoleName(cr.name); setEditRoleDesc(cr.description || ''); }}>
                                <Pencil className="w-3.5 h-3.5" />
                              </Button>
                              <Button size="sm" variant="ghost" className="h-7 px-2 text-destructive" onClick={() => deleteRoleMutation.mutate(cr.id)} disabled={deleteRoleMutation.isPending}>
                                <Trash2 className="w-3.5 h-3.5" />
                              </Button>
                            </>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                <Separator />
                <div className="space-y-2">
                  <p className="text-xs font-medium text-muted-foreground">Tambah Role Baru</p>
                  <div className="flex gap-2">
                    <Input value={newRoleName} onChange={e => setNewRoleName(e.target.value)} placeholder="Nama role (misal: OB, Sopir)" className="h-8 text-sm" />
                    <Button size="sm" onClick={() => createRoleMutation.mutate({ name: newRoleName, description: newRoleDesc })} disabled={!newRoleName.trim() || createRoleMutation.isPending} className="shrink-0">
                      <Plus className="w-4 h-4" />
                    </Button>
                  </div>
                  <Input value={newRoleDesc} onChange={e => setNewRoleDesc(e.target.value)} placeholder="Deskripsi (opsional)" className="h-8 text-sm" />
                </div>
              </div>
            </DialogContent>
          </Dialog>
          {activeTab === 'employees' && (
            <Dialog open={showAddEmployeeDialog} onOpenChange={(open) => { setShowAddEmployeeDialog(open); if (!open) { setEmpName(''); setEmpPhone(''); setEmpCustomRoleId(''); setEmpUnitIds([]); } }}>
              <DialogTrigger asChild>
                <Button size="sm" className="gap-1.5">
                  <Plus className="w-4 h-4" />
                  Tambah Karyawan
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-md">
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2"><Briefcase className="w-5 h-5" />Tambah Karyawan Non-ERP</DialogTitle>
                  <DialogDescription>Karyawan ini tidak memiliki akses login ke sistem, hanya untuk penggajian.</DialogDescription>
                </DialogHeader>
                <div className="space-y-4 pt-2">
                  <div>
                    <Label>Nama</Label>
                    <Input value={empName} onChange={e => setEmpName(e.target.value)} placeholder="Nama lengkap" />
                  </div>
                  <div>
                    <Label>Telepon</Label>
                    <Input value={empPhone} onChange={e => setEmpPhone(e.target.value)} placeholder="08xxxxxxxxxx" />
                  </div>
                  <div>
                    <Label>Jabatan / Role</Label>
                    <Select value={empCustomRoleId} onValueChange={setEmpCustomRoleId}>
                      <SelectTrigger><SelectValue placeholder="Pilih jabatan..." /></SelectTrigger>
                      <SelectContent>
                        {customRoles.map(cr => <SelectItem key={cr.id} value={cr.id}>{cr.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label className="flex items-center gap-1.5"><Building2 className="w-3.5 h-3.5" />Unit / Cabang</Label>
                    <ScrollArea className="max-h-36 rounded-md border p-2">
                      <div className="space-y-1">
                        {units.map(u => {
                          const isSelected = empUnitIds.includes(u.id);
                          return (
                            <label key={u.id} className={cn("flex items-center gap-2.5 rounded-md px-2.5 py-1.5 cursor-pointer transition-colors text-sm", isSelected ? "bg-emerald-50 dark:bg-emerald-950/30" : "hover:bg-muted")}>
                              <Checkbox checked={isSelected} onCheckedChange={() => setEmpUnitIds(prev => prev.includes(u.id) ? prev.filter(id => id !== u.id) : [...prev, u.id])} />
                              <span>{u.name}</span>
                            </label>
                          );
                        })}
                      </div>
                    </ScrollArea>
                  </div>
                  <Button className="w-full" onClick={() => {
                    if (!empName.trim()) { toast.error('Nama wajib diisi'); return; }
                    if (!empCustomRoleId) { toast.error('Pilih jabatan/role'); return; }
                    addEmployeeMutation.mutate({ name: empName, phone: empPhone || undefined, customRoleId: empCustomRoleId, unitIds: empUnitIds.length > 0 ? empUnitIds : undefined });
                  }} disabled={addEmployeeMutation.isPending}>
                    {addEmployeeMutation.isPending ? 'Menyimpan...' : 'Tambah Karyawan'}
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          )}
          {activeTab === 'system' && (
            <Dialog open={showAddDialog} onOpenChange={(open) => { setShowAddDialog(open); if (!open) resetForm(); }}>
              <DialogTrigger asChild>
                <Button size="sm" className="gap-1.5">
                  <Plus className="w-4 h-4" />
                  Tambah User
                </Button>
              </DialogTrigger>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Tambah Pengguna Baru</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 pt-2">
              <div>
                <Label>Nama</Label>
                <Input value={formName} onChange={(e) => setFormName(e.target.value)} placeholder="Nama lengkap" />
              </div>
              <div>
                <Label>Email</Label>
                <Input type="email" value={formEmail} onChange={(e) => setFormEmail(e.target.value)} placeholder="email@contoh.com" />
              </div>
              <div>
                <Label>Telepon</Label>
                <Input value={formPhone} onChange={(e) => setFormPhone(e.target.value)} placeholder="08xxxxxxxxxx" />
              </div>
              <div>
                <Label>Password</Label>
                <Input type="password" value={formPassword} onChange={(e) => setFormPassword(e.target.value)} placeholder="Min. 6 karakter" />
              </div>
              <div>
                <Label>Role</Label>
                <Select value={formRole} onValueChange={(v) => { setFormRole(v); if (v === 'super_admin') setFormUnitIds([]); }}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ROLES.map(r => (
                      <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Multi-unit selector */}
              {formRole !== 'super_admin' && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label className="flex items-center gap-1.5">
                      <Building2 className="w-3.5 h-3.5" />
                      Unit / Cabang
                    </Label>
                    {formUnitIds.length > 0 && (
                      <Badge variant="secondary" className="text-xs bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
                        {formUnitIds.length} dipilih
                      </Badge>
                    )}
                  </div>
                  <ScrollArea className="max-h-36 rounded-md border p-2">
                    <div className="space-y-1">
                      {units.map(u => {
                        const isSelected = formUnitIds.includes(u.id);
                        return (
                          <label
                            key={u.id}
                            className={cn(
                              "flex items-center gap-2.5 rounded-md px-2.5 py-1.5 cursor-pointer transition-colors text-sm",
                              isSelected
                                ? "bg-emerald-50 dark:bg-emerald-950/30 text-emerald-900 dark:text-emerald-100"
                                : "hover:bg-muted"
                            )}
                          >
                            <Checkbox checked={isSelected} onCheckedChange={() => toggleFormUnit(u.id)} />
                            <span className="flex-1 truncate">{u.name}</span>
                            {isSelected && <Check className="w-3.5 h-3.5 text-emerald-600" />}
                          </label>
                        );
                      })}
                    </div>
                  </ScrollArea>
                </div>
              )}

              <Button className="w-full" onClick={handleAddUser} disabled={registerMutation.isPending}>
                {registerMutation.isPending ? 'Menyimpan...' : 'Tambah User'}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
          )}
        </div>
      </div>

      {/* Tabs: Pengguna Sistem / Karyawan Non-ERP */}
      <div className="flex gap-2 border-b pb-3">
        <button
          onClick={() => setActiveTab('system')}
          className={cn(
            "px-4 py-2 text-sm font-medium border-b-2 transition-colors -mb-[13px]",
            activeTab === 'system' ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
          )}
        >
          <Users className="w-4 h-4 inline mr-1.5" />
          Pengguna Sistem ({totalUsers})
        </button>
        <button
          onClick={() => setActiveTab('employees')}
          className={cn(
            "px-4 py-2 text-sm font-medium border-b-2 transition-colors -mb-[13px]",
            activeTab === 'employees' ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
          )}
        >
          <Briefcase className="w-4 h-4 inline mr-1.5" />
          Karyawan Non-ERP ({totalEmployees})
        </button>
      </div>

      {/* Stats — only for system users tab */}
      {activeTab === 'system' && (
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Card className="p-3">
          <p className="text-xs text-muted-foreground">Total</p>
          <p className="text-xl font-bold">{totalUsers}</p>
        </Card>
        <Card className="p-3">
          <p className="text-xs text-muted-foreground">Aktif</p>
          <p className="text-xl font-bold text-green-600">{activeUsers}</p>
        </Card>
        <Card className="p-3">
          <p className="text-xs text-muted-foreground">Pending</p>
          <p className="text-xl font-bold text-yellow-600">{pendingUsers}</p>
        </Card>
      </div>
      )}

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          placeholder="Cari pengguna..."
          className="pl-9"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {/* User List */}
      <div className="max-h-[calc(100dvh-380px)] overflow-y-auto">
        <div className="space-y-2">
          {displayUsers.length === 0 ? (
            <p className="text-center text-sm text-muted-foreground py-8">
              {activeTab === 'system' ? 'Tidak ada pengguna ditemukan' : 'Tidak ada karyawan non-ERP'}
            </p>
          ) : (
            displayUsers.map((user) => {
              const roleInfo = getRoleInfo(user.role, user.customRole);
              const statusInfo = getStatusInfo(user.status);
              const userUnitNames = user.userUnits?.map(u => u.name) || (user.unit ? [user.unit.name] : []);
              const isNonErp = user.canLogin === false || !!user.customRoleId;

              return (
                <Card key={user.id} className="p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-medium text-sm truncate">{user.name}</p>
                        <Badge variant="secondary" className={`text-[10px] px-1.5 py-0 ${roleInfo.color}`}>
                          {roleInfo.label}
                        </Badge>
                        <Badge variant="secondary" className={`text-[10px] px-1.5 py-0 ${statusInfo.color}`}>
                          {statusInfo.label}
                        </Badge>
                        {isNonErp && (
                          <Badge variant="secondary" className="text-[10px] px-1.5 py-0 bg-slate-100 text-slate-600">
                            Non-ERP
                          </Badge>
                        )}
                        {!user.isActive && (
                          <Badge variant="secondary" className="text-[10px] px-1.5 py-0 bg-gray-100 text-gray-600">
                            Nonaktif
                          </Badge>
                        )}
                      </div>
                      {!isNonErp && <p className="text-xs text-muted-foreground mt-0.5">{user.email}</p>}
                      <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground flex-wrap">
                        {user.phone && <span>📱 {user.phone}</span>}
                        {userUnitNames.length > 0 && (
                          <span className="flex items-center gap-1">
                            🏢 {userUnitNames.length === 1 ? userUnitNames[0] : `${userUnitNames.length} unit`}
                          </span>
                        )}
                        {user.role === 'kurir' && user.nearCommission > 0 && (
                          <span>Komisi: dekat {user.nearCommission.toLocaleString('id-ID')} / jauh {user.farCommission.toLocaleString('id-ID')}</span>
                        )}
                      </div>
                      <p className="text-[10px] text-muted-foreground mt-1">
                        Bergabung: {formatDateTime(user.createdAt)}
                      </p>
                    </div>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="shrink-0 h-8 w-8">
                          <MoreVertical className="w-4 h-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        {user.status === 'pending' && (
                          <DropdownMenuItem onClick={() => approveMutation.mutate(user.id)}>
                            <CheckCircle className="w-4 h-4 mr-2" />
                            Approve
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuItem onClick={() => {
                          setEditUser(user);
                        }}>
                          <Pencil className="w-4 h-4 mr-2" />
                          Edit
                        </DropdownMenuItem>
                        {user.isActive && user.role !== 'super_admin' && (
                          <>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              className="text-amber-600"
                              onClick={() => setDeleteDialog({ user, mode: 'deactivate' })}
                            >
                              <Ban className="w-4 h-4 mr-2" />
                              Nonaktifkan
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              className="text-destructive"
                              onClick={() => setDeleteDialog({ user, mode: 'delete' })}
                            >
                              <Trash2 className="w-4 h-4 mr-2" />
                              Hapus
                            </DropdownMenuItem>
                          </>
                        )}
                        {!user.isActive && user.role !== 'super_admin' && (
                          <>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              className="text-destructive"
                              onClick={() => setDeleteDialog({ user, mode: 'delete' })}
                            >
                              <Trash2 className="w-4 h-4 mr-2" />
                              Hapus Permanen
                            </DropdownMenuItem>
                          </>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </Card>
              );
            })
          )}
        </div>
      </div>

      {/* Delete / Deactivate Confirmation Dialog */}
      <Dialog open={!!deleteDialog} onOpenChange={(open) => { if (!open) setDeleteDialog(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {deleteDialog?.mode === 'delete'
                ? (deleteDialog.user.isActive ? 'Hapus Karyawan' : 'Hapus Permanen')
                : 'Nonaktifkan Karyawan'
              }
            </DialogTitle>
            <DialogDescription>
              {deleteDialog?.mode === 'delete'
                ? `Apakah Anda yakin ingin menghapus ${deleteDialog?.user.name}? Aksi ini tidak dapat dibatalkan.`
                : `Apakah Anda yakin ingin menonaktifkan ${deleteDialog?.user.name}?`
              }
            </DialogDescription>
          </DialogHeader>
          {deleteDialog?.user.role === 'sales' && (
            <div className="rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 p-3 space-y-1">
              <p className="text-xs font-medium text-amber-700 dark:text-amber-300">
                ⚠️ Perhatian
              </p>
              <p className="text-xs text-amber-600 dark:text-amber-400">
                Semua pelanggan yang ditangani oleh sales ini akan otomatis dipindahkan ke Super Admin.
                Order PWA yang masih pending juga akan dialihkan.
              </p>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteDialog(null)}>Batal</Button>
            {deleteDialog?.mode === 'deactivate' ? (
              <Button
                className="bg-amber-600 hover:bg-amber-700"
                onClick={() => deactivateMutation.mutate({ id: deleteDialog.user.id, data: { isActive: false } })}
                disabled={deactivateMutation.isPending}
              >
                {deactivateMutation.isPending ? 'Menonaktifkan...' : 'Nonaktifkan'}
              </Button>
            ) : (
              <Button
                variant="destructive"
                onClick={() => deleteMutation.mutate(deleteDialog!.user.id)}
                disabled={deleteMutation.isPending}
              >
                {deleteMutation.isPending ? 'Menghapus...' : 'Hapus'}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog open={!!editUser} onOpenChange={(open) => { if (!open) setEditUser(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Pengguna</DialogTitle>
          </DialogHeader>
          {editUser && (
            <EditUserForm
              key={editUser?.id}
              user={editUser}
              units={units}
              customRoles={customRoles}
              onSave={(data) => updateMutation.mutate({ id: editUser.id, data })}
              onCancel={() => setEditUser(null)}
              isLoading={updateMutation.isPending}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function EditUserForm({
  user,
  units,
  customRoles,
  onSave,
  onCancel,
  isLoading,
}: {
  user: UserItem;
  units: { id: string; name: string }[];
  customRoles: CustomRoleItem[];
  onSave: (data: any) => void;
  onCancel: () => void;
  isLoading: boolean;
}) {
  const [name, setName] = useState(user.name);
  const [phone, setPhone] = useState(user.phone || '');
  const [role, setRole] = useState(user.role);
  const [unitIds, setUnitIds] = useState<string[]>(
    user.userUnits?.map(u => u.id) || (user.unitId ? [user.unitId] : [])
  );
  const [status, setStatus] = useState(user.status);
  const [password, setPassword] = useState('');
  const [nearCommission, setNearCommission] = useState(String(user.nearCommission || 0));
  const [farCommission, setFarCommission] = useState(String(user.farCommission || 0));
  const [selectedCustomRoleId, setSelectedCustomRoleId] = useState(user.customRoleId || '');

  const isNonErp = user.canLogin === false || !!user.customRoleId;

  const toggleUnit = (unitId: string) => {
    setUnitIds(prev =>
      prev.includes(unitId)
        ? prev.filter(id => id !== unitId)
        : [...prev, unitId]
    );
  };

  const handleSave = () => {
    if (!name.trim()) {
      toast.error('Nama tidak boleh kosong');
      return;
    }
    const data: any = {
      name: name.trim(),
      phone: phone.trim() || null,
      unitIds,
    };

    if (isNonErp) {
      // Non-ERP employee: send customRoleId to identify the role
      if (selectedCustomRoleId) {
        data.customRoleId = selectedCustomRoleId;
      }
      // Keep the current role string from the custom role
      data.role = role;
    } else {
      // System user: send role as usual
      data.role = role;
      data.status = status;
      if (password && password.length >= 6) {
        data.password = password;
      } else if (password && password.length > 0 && password.length < 6) {
        toast.error('Password minimal 6 karakter');
        return;
      }
    }

    if (role === 'kurir') {
      data.nearCommission = Number(nearCommission) || 0;
      data.farCommission = Number(farCommission) || 0;
    }
    onSave(data);
  };

  // Find the custom role name for display
  const currentCustomRole = customRoles.find(cr => cr.id === selectedCustomRoleId);

  return (
    <div className="space-y-4 pt-2">
      <div>
        <Label>Nama</Label>
        <Input value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      {!isNonErp && (
        <div>
          <Label>Email (tidak bisa diubah)</Label>
          <Input value={user.email} disabled />
        </div>
      )}
      <div>
        <Label>Telepon</Label>
        <Input value={phone} onChange={(e) => setPhone(e.target.value)} />
      </div>
      {!isNonErp && (
        <div>
          <Label>Password Baru (kosongkan jika tidak diubah)</Label>
          <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Min. 6 karakter" />
        </div>
      )}
      {isNonErp ? (
        <div>
          <Label>Jabatan / Role</Label>
          <Select value={selectedCustomRoleId} onValueChange={(v) => {
            setSelectedCustomRoleId(v);
            const cr = customRoles.find(c => c.id === v);
            if (cr) setRole(cr.name);
          }}>
            <SelectTrigger><SelectValue placeholder="Pilih jabatan..." /></SelectTrigger>
            <SelectContent>
              {customRoles.map(cr => (
                <SelectItem key={cr.id} value={cr.id}>{cr.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : (
        <div>
          <Label>Role</Label>
          <Select value={role} onValueChange={setRole}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ROLES.map(r => (
                <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
      {!isNonErp && (
        <div>
          <Label>Status</Label>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="approved">Approved</SelectItem>
              <SelectItem value="rejected">Rejected</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}

      {/* Multi-unit selector */}
      {role !== 'super_admin' && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="flex items-center gap-1.5">
              <Building2 className="w-3.5 h-3.5" />
              Unit / Cabang
            </Label>
            {unitIds.length > 0 && (
              <Badge variant="secondary" className="text-xs bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
                {unitIds.length} dipilih
              </Badge>
            )}
          </div>
          <ScrollArea className="max-h-36 rounded-md border p-2">
            <div className="space-y-1">
              {units.map(u => {
                const isSelected = unitIds.includes(u.id);
                return (
                  <label
                    key={u.id}
                    className={cn(
                      "flex items-center gap-2.5 rounded-md px-2.5 py-1.5 cursor-pointer transition-colors text-sm",
                      isSelected
                        ? "bg-emerald-50 dark:bg-emerald-950/30 text-emerald-900 dark:text-emerald-100"
                        : "hover:bg-muted"
                    )}
                  >
                    <Checkbox checked={isSelected} onCheckedChange={() => toggleUnit(u.id)} />
                    <span className="flex-1 truncate">{u.name}</span>
                    {isSelected && <Check className="w-3.5 h-3.5 text-emerald-600" />}
                  </label>
                );
              })}
            </div>
          </ScrollArea>
        </div>
      )}

      {role === 'kurir' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <Label>Komisi Dekat</Label>
            <Input type="number" value={nearCommission} onChange={(e) => setNearCommission(e.target.value)} />
          </div>
          <div>
            <Label>Komisi Jauh</Label>
            <Input type="number" value={farCommission} onChange={(e) => setFarCommission(e.target.value)} />
          </div>
        </div>
      )}
      <div className="flex gap-2">
        <Button variant="outline" className="flex-1" onClick={onCancel}>Batal</Button>
        <Button className="flex-1" onClick={handleSave} disabled={isLoading}>
          {isLoading ? 'Menyimpan...' : 'Simpan'}
        </Button>
      </div>
    </div>
  );
}
