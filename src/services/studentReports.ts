import { supabase } from '@/lib/supabase'
import type { StudentReport, StudentReportCategory, StudentReportWithStudent } from '@/types/database'

// The generated types do not describe the nested student selection yet.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any

export const studentReportsService = {
  async submit(input: { category: StudentReportCategory; subject: string; message: string }) {
    const { data, error } = await supabase.functions.invoke('submit-student-report', { body: input })
    if (error) throw error
    if (data?.error) throw new Error(data.error)
    return data as { report: StudentReport; discord_delivered: boolean }
  },

  async getMine() {
    const { data, error } = await db
      .from('student_reports')
      .select('*')
      .order('created_at', { ascending: false })
    if (error) throw error
    return data as StudentReport[]
  },

  async getAdminRecent() {
    const { data, error } = await db
      .from('student_reports')
      .select('*, students(first_name, last_name, admission_number)')
      .order('created_at', { ascending: false })
    if (error) throw error
    return data as StudentReportWithStudent[]
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
