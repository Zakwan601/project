import { supabase } from '@/lib/supabase'
import type { Student, StudentWithClass } from '@/types/database'

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
}
