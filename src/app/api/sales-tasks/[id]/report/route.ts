import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/supabase';
import { verifyAuthUser } from '@/lib/token';
import { toCamelCase, createEvent, generateId } from '@/lib/supabase-helpers';
import { wsTaskUpdate } from '@/lib/ws-dispatch';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authUserId = await verifyAuthUser(request.headers.get('authorization'));
    if (!authUserId) return NextResponse.json({ error: 'Akses ditolak' }, { status: 401 });

    const { id: taskId } = await params;

    const { data: task, error: taskError } = await db.from('sales_tasks').select('id, status, assigned_to_id').eq('id', taskId).maybeSingle();
    if (taskError) {
      return NextResponse.json({ error: taskError.message }, { status: 500 });
    }
    if (!task) return NextResponse.json({ error: 'Tugas tidak ditemukan' }, { status: 404 });
    if (task.assigned_to_id !== authUserId) return NextResponse.json({ error: 'Anda hanya dapat melaporkan tugas yang ditugaskan kepada Anda' }, { status: 403 });

    const { data: authUser, error: authUserError } = await db.from('users').select('id, role').eq('id', authUserId).maybeSingle();
    if (authUserError) {
      return NextResponse.json({ error: authUserError.message }, { status: 500 });
    }
    if (!authUser || (authUser.role !== 'sales' && authUser.role !== 'super_admin')) {
      return NextResponse.json({ error: 'Hanya sales yang dapat mengirim laporan tugas' }, { status: 403 });
    }

    const body = await request.json();
    const { status, note, evidence } = body;

    if (!status || !note) return NextResponse.json({ error: 'Field status dan note wajib diisi' }, { status: 400 });
    const validStatuses = ['pending', 'in_progress', 'completed', 'cancelled'];
    if (!validStatuses.includes(status)) return NextResponse.json({ error: `Status harus salah satu dari: ${validStatuses.join(', ')}` }, { status: 400 });
    if (task.status === 'completed') return NextResponse.json({ error: 'Tugas sudah selesai, tidak dapat mengirim laporan lagi' }, { status: 400 });
    if (task.status === 'cancelled') return NextResponse.json({ error: 'Tugas sudah dibatalkan, tidak dapat mengirim laporan' }, { status: 400 });
    if (status === 'completed' && !note.trim()) return NextResponse.json({ error: 'Catatan wajib diisi saat melaporkan tugas selesai' }, { status: 400 });

    // Create report
    const now = new Date().toISOString();
    const reportData = {
      id: generateId(),
      task_id: taskId, reported_by_id: authUserId, status, note, evidence: evidence ?? null,
      created_at: now,
    };
    const { data: report, error: reportError } = await db.from('sales_task_reports').insert(reportData).select(`
      *, reported_by:users!reported_by_id(id, name)
    `).single();
    if (reportError) throw reportError;

    // Update task
    const taskUpdate: Record<string, any> = { status };
    if (status === 'completed') {
      taskUpdate.completed_at = new Date().toISOString();
      taskUpdate.completion_note = note;
    }
    await db.from('sales_tasks').update(taskUpdate).eq('id', taskId);
    wsTaskUpdate({ taskId, status, assignedToId: task.assigned_to_id });

    createEvent(db, 'sales_task_reported', {
      taskId,
      reportId: (report as any).id,
      status,
      note,
      reportedById: authUserId,
      assignedToId: task.assigned_to_id,
    });

    return NextResponse.json({ report: toCamelCase(report) }, { status: 201 });
  } catch (error: any) {
    console.error('Create sales task report error:', error);
    return NextResponse.json({ error: error?.message || 'Terjadi kesalahan server' }, { status: 500 });
  }
}
