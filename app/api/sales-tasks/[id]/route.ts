import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/supabase';
import { verifyAuthUser } from '@/lib/token';
import { enforceSuperAdmin } from '@/lib/require-auth';
import { toCamelCase, toSnakeCase, createEvent } from '@/lib/supabase-helpers';
import { wsTaskUpdate } from '@/lib/ws-dispatch';

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const authUserId = await verifyAuthUser(request.headers.get('authorization'));
    if (!authUserId) return NextResponse.json({ error: 'Akses ditolak' }, { status: 401 });

    const { id } = await context.params;

    const { data: task, error } = await db.from('sales_tasks').select(`
      *,
      assigned_to:users!assigned_to_id(id, name),
      assigned_by:users!assigned_by_id(id, name),
      reports:sales_task_reports(*, reported_by:users!reported_by_id(id, name))
    `).eq('id', id).single();

    if (error || !task) return NextResponse.json({ error: 'Tugas tidak ditemukan' }, { status: 404 });

    const { data: authUser, error: authError } = await db.from('users').select('id, role').eq('id', authUserId).maybeSingle();
    if (authError) {
      console.error('Auth user lookup error:', authError);
    }
    if (authUser && authUser.role === 'sales' && task.assigned_to_id !== authUserId) {
      return NextResponse.json({ error: 'Akses ditolak' }, { status: 403 });
    }

    return NextResponse.json({ task: toCamelCase(task) });
  } catch (error: any) {
    console.error('Get sales task detail error:', error);
    return NextResponse.json({ error: error?.message || 'Terjadi kesalahan server' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const authUserId = await verifyAuthUser(request.headers.get('authorization'));
    if (!authUserId) return NextResponse.json({ error: 'Akses ditolak' }, { status: 401 });

    const authResult = await enforceSuperAdmin(request);
    if (!authResult.success) return NextResponse.json({ error: 'Akses ditolak' }, { status: authResult.response.status });
    const { id } = await context.params;

    const { data: existing } = await db.from('sales_tasks').select('*').eq('id', id).maybeSingle();
    if (!existing) return NextResponse.json({ error: 'Tugas tidak ditemukan' }, { status: 404 });

    const data = await request.json();
    const { title, description, type, priority, status, dueDate } = data;

    const validTypes = ['general', 'visit', 'followup', 'prospecting', 'collection', 'other'];
    if (type && !validTypes.includes(type)) return NextResponse.json({ error: 'Tipe tugas tidak valid' }, { status: 400 });
    const validPriorities = ['low', 'normal', 'high', 'urgent'];
    if (priority && !validPriorities.includes(priority)) return NextResponse.json({ error: 'Prioritas tidak valid' }, { status: 400 });
    const validStatuses = ['pending', 'in_progress', 'completed', 'cancelled'];
    if (status && !validStatuses.includes(status)) return NextResponse.json({ error: 'Status tidak valid' }, { status: 400 });

    const updateData: Record<string, any> = {};
    if (title !== undefined) updateData.title = title.trim();
    if (description !== undefined) updateData.description = description?.trim() || null;
    if (type !== undefined) updateData.type = type;
    if (priority !== undefined) updateData.priority = priority;
    if (dueDate !== undefined) updateData.due_date = dueDate ? new Date(dueDate).toISOString() : null;

    if (status !== undefined && status !== existing.status) {
      updateData.status = status;
      if (status === 'completed' && !existing.completed_at) updateData.completed_at = new Date().toISOString();
      if (status !== 'completed') { updateData.completed_at = null; updateData.completion_note = null; }
    }

    if (data.assignedToId && data.assignedToId !== existing.assigned_to_id) {
      const { data: assignedUser, error: assignedError } = await db.from('users').select('id, role, status, is_active').eq('id', data.assignedToId).maybeSingle();
      if (assignedError) {
        return NextResponse.json({ error: assignedError.message }, { status: 500 });
      }
      if (!assignedUser) return NextResponse.json({ error: 'User tidak ditemukan' }, { status: 404 });
      if (assignedUser.role !== 'sales') return NextResponse.json({ error: 'Tugas hanya dapat diberikan kepada sales' }, { status: 400 });
      if (!assignedUser.is_active || assignedUser.status !== 'approved') return NextResponse.json({ error: 'Sales yang dipilih tidak aktif' }, { status: 400 });
      updateData.assigned_to_id = data.assignedToId;
    }

    const { data: task, error } = await db.from('sales_tasks').update(updateData).eq('id', id).select(`
      *, assigned_to:users!assigned_to_id(id, name), assigned_by:users!assigned_by_id(id, name)
    `).single();
    if (error) throw error;

    wsTaskUpdate({ taskId: id, status: updateData.status || existing.status, assignedToId: updateData.assigned_to_id || existing.assigned_to_id });

    createEvent(db, 'sales_task_updated', {
      taskId: id,
      changes: Object.keys(updateData),
      newStatus: updateData.status || existing.status,
      assignedToId: updateData.assigned_to_id || existing.assigned_to_id,
      updatedById: authResult.userId,
    });

    return NextResponse.json({ task: toCamelCase(task) });
  } catch (error: any) {
    console.error('Update sales task error:', error);
    return NextResponse.json({ error: error?.message || 'Terjadi kesalahan server' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    const authUserId = await verifyAuthUser(request.headers.get('authorization'));
    if (!authUserId) return NextResponse.json({ error: 'Akses ditolak' }, { status: 401 });

    const authResult = await enforceSuperAdmin(request);
    if (!authResult.success) return NextResponse.json({ error: 'Akses ditolak' }, { status: authResult.response.status });
    const { id } = await context.params;

    const { data: existing } = await db.from('sales_tasks').select('id').eq('id', id).maybeSingle();
    if (!existing) return NextResponse.json({ error: 'Tugas tidak ditemukan' }, { status: 404 });

    const { error } = await db.from('sales_tasks').delete().eq('id', id);
    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Delete sales task error:', error);
    return NextResponse.json({ error: error?.message || 'Terjadi kesalahan server' }, { status: 500 });
  }
}
