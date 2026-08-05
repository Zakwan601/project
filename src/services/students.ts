import { supabase } from '@/lib/supabase'
import type { Student, StudentEnrollmentWithDetails, StudentWithClass } from '@/types/database'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any

export const studentsService = {
  async getAll(classId?: string) {
    let query = db
      .from('students')
      .select('*, classes(id, name, grade, section)')
      .order('first_name')

    if (classId) query = query.eq('class_id', classId)

    const { data, error } = await query
    if (error) throw error
    return data as StudentWithClass[]
  },

  async getById(id: string) {
    const { data, error } = await db
      .from('students')
      .select('*, classes(id, name, grade, section)')
      .eq('id', id)
      .maybeSingle()
    if (error) throw error
    return data as StudentWithClass | null
  },

  async create(student: Omit<Student, 'id' | 'created_at' | 'updated_at'>) {
    const { data, error } = await db
      .from('students')
      .insert(student)
      .select()
      .single()
    if (error) throw error
    return data as Student
  },

  async update(id: string, updates: Partial<Student>) {
    const { data, error } = await db
      .from('students')
      .update(updates)
      .eq('id', id)
      .select()
      .single()
    if (error) throw error
    return data as Student
  },

  async delete(id: string) {
    const { error } = await db.from('students').delete().eq('id', id)
    if (error) throw error
  },

  async getByClass(classId: string) {
    const { data, error } = await db
      .from('students')
      .select('*')
      .eq('class_id', classId)
      .eq('is_active', true)
      .order('roll_number')
    if (error) throw error
    return data as Student[]
  },

  async getByClassForPeriod(classId: string, startDate: string, endDate = startDate) {
    const { data, error } = await db.rpc('get_class_students_for_period', {
      p_class_id: classId,
      p_start_date: startDate,
      p_end_date: endDate,
    })
    if (error) throw error
    return data as Student[]
  },

  async promote(studentIds: string[], targetClassId: string, effectiveDate: string) {
    const { data, error } = await db.rpc('promote_students', {
      p_student_ids: studentIds,
      p_target_class_id: targetClassId,
      p_effective_date: effectiveDate,
    })
    if (error) throw error
    return Number(data ?? 0)
  },

  async getEnrollmentHistory(studentId: string) {
    const { data, error } = await db
      .from('student_enrollments')
      .select('*, classes(id, name, grade, section), academic_years(*)')
      .eq('student_id', studentId)
      .order('started_on', { ascending: false })
    if (error) throw error
    return data as StudentEnrollmentWithDetails[]
  },
}
