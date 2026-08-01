import { supabase } from '@/lib/supabase'
import type { StudentReport, StudentReportCategory, StudentReportWithStudent } from '@/types/database'

// The generated types do not describe the nested student selection yet.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any

export interface StudentReportPage<T> {
  rows: T[]
  total: number
}

export const studentReportsService = {
  async submit(input: { category: StudentReportCategory; subject: string; message: string }) {
    const { data, error } = await supabase.functions.invoke('submit-student-report', { body: input })
    if (error) throw error
    if (data?.error) throw new Error(data.error)
    return data as { report: StudentReport; discord_delivered: boolean }
  },

  async getMinePage(page: number, pageSize: number): Promise<StudentReportPage<StudentReport>> {
    const from = (page - 1) * pageSize
    const { data, error, count } = await db
      .from('student_reports')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(from, from + pageSize - 1)
    if (error) throw error
    return { rows: data as StudentReport[], total: count ?? 0 }
  },

  async getAdminPage(page: number, pageSize: number): Promise<StudentReportPage<StudentReportWithStudent>> {
    const from = (page - 1) * pageSize
    const { data, error, count } = await db
      .from('student_reports')
      .select('*, students(first_name, last_name, admission_number)', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(from, from + pageSize - 1)
    if (error) throw error
    return { rows: data as StudentReportWithStudent[], total: count ?? 0 }
  },

  async getAdminUnreadCount() {
    const { count, error } = await db
      .from('student_reports')
      .select('id', { count: 'exact', head: true })
      .is('admin_read_at', null)
    if (error) throw error
    return count ?? 0
  },

  async markRead(id: string) {
    const { data, error } = await db
      .from('student_reports')
      .update({
        admin_read_at: new Date().toISOString(),
        status: 'reviewed',
      })
      .eq('id', id)
      .select()
      .single()
    if (error) throw error
    return data as StudentReport
  },

  async markSolved(id: string) {
    const { data, error } = await db
      .from('student_reports')
      .update({
        admin_read_at: new Date().toISOString(),
        status: 'resolved',
      })
      .eq('id', id)
      .select()
      .single()
    if (error) throw error
    return data as StudentReport
  },
}
