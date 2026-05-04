import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/supabase';
import { verifyAuthUser } from '@/lib/token';
import { enforceSuperAdmin } from '@/lib/require-auth';
import { rowsToCamelCase, toCamelCase, toSnakeCase, createEvent, generateId } from '@/lib/supabase-helpers';
import { wsTaskUpdate } from '@/lib/ws-dispatch';
import { validateBody } from '@/lib/validators';

const salesTaskCreateSchema = z.object({
  title: z.string().min(1, 'Judul tugas wajib diisi'),
  assignedToId: z.string().min(1, 'Sales yang ditugaskan wajib diisi'),
  description: z.string().optional(),
  type: z.enum(['general', 'visit', 'followup', 'prospecting', 'collection', 'other']).optional(),
  priority: z.enum(['low', 'normal', 'high', 'urgent']).optional(),
  dueDate: z.string().optional(),
});

export async function GET(request: NextRequest) {
  try {
    const authUserId = await verifyAuthUser(request.headers.get('authorization'));
    if (!authUserId) return NextResponse.json({ error: 'Akses ditolak' }, { status: 401 });

    const { data: authUser } = await db.from('users').select('id, role, is_active, status').eq('id', authUserId).single();
    if (!authUser || !authUser.is_active || authUser.status !== 'approved') {
      return NextResponse.json({ error: 'Akses ditolak' }, { status: 403 });
    }

    const isSuperAdmin = authUser.role === 'super_admin';
    const isSales = authUser.role === 'sales';
    if (!isSuperAdmin && !isSales) return NextResponse.json({ error: 'Akses ditolak' }, { status: 403 });

    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');
    const priority = searchParams.get('priority');
    const assignedToId = searchParams.get('assignedToId');

    let query = db.from('sales_tasks').select(`
      *,
      assigned_to:users!assigned_to_id(id, name),
      assigned_by:users!assigned_by_id(id, name),
      reports:sales_task_reports(*, reported_by:users!reported_by_id(id, name))
    `).order('created_at', { ascending: false });

    if (isSales) query = query.eq('assigned_to_id', authUserId);
    else if (assignedToId && assignedToId !== 'all') query = query.eq('assigned_to_id', assignedToId);
    if (status && status !== 'all') query = query.eq('status', status);
    if (priority && priority !== 'all') query = query.eq('priority', priority);

    const { data: tasks, error } = await query;
    if (error) throw error;

    const mappedTasks = rowsToCamelCase(tasks || []).map((task: any) => ({
      ...task,
      latestReport: task.reports && task.reports[0] ? { id: task.reports[0].id, note: task.reports[0].note, status: task.reports[0].status, createdAt: task.reports[0].created_at, reportedBy: task.reports[0].reported_by } : null,
    }));

    // Summary
    const now = new Date();
    let overdueCount = 0;
    for (const t of mappedTasks) {
      if (t.dueDate) {
        const due = new Date(t.dueDate);
        due.setHours(23, 59, 59, 999);
        if (now > due) overdueCount++;
      }
    }

    // Aggregate counts
    const { data: allTasksForCount } = isSales
      ? await db.from('sales_tasks').select('id, status').eq('assigned_to_id', authUserId)
      : await db.from('sales_tasks').select('id, status');
    const summary: Record<string, number> = { total: 0, overdue: overdueCount };
    for (const t of (allTasksForCount || [])) {
      summary[t.status] = (summary[t.status] || 0) + 1;
      summary.total++;
    }

    return NextResponse.json({ tasks: mappedTasks, summary });
  } catch (error: any) {
    console.error('Get sales tasks error:', error);
    return NextResponse.json({ error: 'Terjadi kesalahan server' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const authResult = await enforceSuperAdmin(request);
    if (!authResult.success) return NextResponse.json({ error: 'Akses ditolak' }, { status: authResult.response.status });

    const rawBody = await request.json();
    const validation = validateBody(salesTaskCreateSchema, rawBody);
    if (!validation.success) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }
    const { title, description, type, priority, assignedToId, dueDate } = validation.data;

    const { data: assignedUser } = await db.from('users').select('id, role, status, is_active').eq('id', assignedToId).single();
    if (!assignedUser) return NextResponse.json({ error: 'User tidak ditemukan' }, { status: 404 });
    if (assignedUser.role !== 'sales') return NextResponse.json({ error: 'Tugas hanya dapat diberikan kepada sales' }, { status: 400 });
    if (!assignedUser.is_active || assignedUser.status !== 'approved') return NextResponse.json({ error: 'Sales yang dipilih tidak aktif' }, { status: 400 });

    const now = new Date().toISOString();
    const insertData = toSnakeCase({
      id: generateId(),
      title: title.trim(), description: description?.trim() || null, type: type || 'general', priority: priority || 'normal',
      assignedToId, assignedById: authResult.userId, status: 'pending', dueDate: dueDate ? new Date(dueDate).toISOString() : null,
      createdAt: now, updatedAt: now,
    });

    const { data: task, error } = await db.from('sales_tasks').insert(insertData).select(`
      *, assigned_to:users!assigned_to_id(id, name), assigned_by:users!assigned_by_id(id, name)
    `).single();
    if (error) throw error;

    wsTaskUpdate({ assignedToId, taskId: (task as any).id, status: 'pending' });

    createEvent(db, 'sales_task_created', {
      taskId: (task as any).id,
      title,
      type: type || 'general',
      priority: priority || 'normal',
      assignedToId,
      assignedById: authResult.userId,
      dueDate: dueDate ? new Date(dueDate).toISOString() : null,
    });

    return NextResponse.json({ task: toCamelCase(task) }, { status: 201 });
  } catch (error: any) {
    console.error('Create sales task error:', error);
    return NextResponse.json({ error: 'Terjadi kesalahan server' }, { status: 500 });
  }
}
