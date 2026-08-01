import { supabase } from '@/lib/supabase'
import type { DashboardPunch, DeviceLog, DeviceLogWithDevice, Student } from '@/types/database'

// The handwritten database types do not describe relationship selections.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any

export interface AdminDailyPunch {
  key: string
  studentBiometricId: string
  date: string
  student: DashboardPunch['student']
  punches: Array<{ id: string; punched_at: string }>
}

export interface AdminDailyPunchPage {
  rows: AdminDailyPunch[]
  total: number
}

export const deviceLogsService = {
  async getByAdmissionNumber(admissionNumber: string) {
    const { data, error } = await db
      .from('device_logs')
      .select(`
        *,
        devices (
          id,
          name,
          sn,
          device_serial,
          alias
        )
      `)
      .eq('student_biometric_id', admissionNumber)
      .order('punched_at', { ascending: false })
      .limit(500)

    if (error) throw error
    return data as DeviceLogWithDevice[]
  },

  async getDashboardPunches(admissionNumber?: string): Promise<DashboardPunch[]> {
    const logs: DeviceLog[] = []
    const pageSize = 1000
    let from = 0

    // Supabase projects commonly cap a response at 1,000 rows. Page until the
    // final partial response so the dashboard really includes every punch.
    while (true) {
      let query = db
        .from('device_logs')
        .select('*')
        .order('punched_at', { ascending: false })
        .order('id', { ascending: false })
        .range(from, from + pageSize - 1)

      if (admissionNumber) {
        query = query.eq('student_biometric_id', admissionNumber)
      }

      const { data, error } = await query
      if (error) throw error

      const page = (data ?? []) as DeviceLog[]
      logs.push(...page)
      if (page.length < pageSize) break
      from += pageSize
    }

    type PunchStudent = Pick<
      Student,
      'admission_number' | 'first_name' | 'last_name' | 'photo_url'
    >
    const students: PunchStudent[] = []
    let studentFrom = 0

    while (true) {
      let studentQuery = db
        .from('students')
        .select('admission_number, first_name, last_name, photo_url')
        .order('admission_number')
        .range(studentFrom, studentFrom + pageSize - 1)

      if (admissionNumber) {
        studentQuery = studentQuery.eq('admission_number', admissionNumber)
      }

      const { data: studentData, error: studentError } = await studentQuery
      if (studentError) throw studentError

      const page = (studentData ?? []) as PunchStudent[]
      students.push(...page)
      if (page.length < pageSize || admissionNumber) break
      studentFrom += pageSize
    }

    const studentsByAdmission = new Map(
      students.map(student => [student.admission_number, student]),
    )

    return logs.map(log => ({
      ...log,
      student: studentsByAdmission.get(log.student_biometric_id) ?? null,
    }))
  },

  async getAdminDailyPunches({
    date,
    page,
    pageSize,
  }: {
    date?: string
    page: number
    pageSize: number
  }): Promise<AdminDailyPunchPage> {
    const { data, error } = await db.rpc('get_daily_punches_page', {
      p_date: date || null,
      p_page: page,
      p_page_size: pageSize,
    })

    if (error) throw error

    const result = (data ?? []) as Array<{
      student_biometric_id: string
      punch_date: string
      punch_ids: string[]
      punch_times: string[]
      first_name: string | null
      last_name: string | null
      photo_url: string | null
      total_count: number | string
    }>

    return {
      total: result.length > 0 ? Number(result[0].total_count) : 0,
      rows: result.map(row => ({
        key: `${row.student_biometric_id}:${row.punch_date}`,
        studentBiometricId: row.student_biometric_id,
        date: row.punch_date,
        student: row.first_name != null && row.last_name != null
          ? {
              admission_number: row.student_biometric_id,
              first_name: row.first_name,
              last_name: row.last_name,
              photo_url: row.photo_url,
            }
          : null,
        punches: row.punch_times.map((punched_at, index) => ({
          id: row.punch_ids[index] ?? `${row.student_biometric_id}:${punched_at}:${index}`,
          punched_at,
        })),
      })),
    }
  },
}
