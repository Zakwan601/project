import { supabase } from '@/lib/supabase'
import type { Class, ClassWithDetails } from '@/types/database'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any

export const classesService = {
  async getAll(academicYearId?: string) {
    let query = db
      .from('classes')
      .select(`*, academic_years(id, name, is_current)`)
      .order('grade')
      .order('section')

    if (academicYearId) query = query.eq('academic_year_id', academicYearId)

    const { data, error } = await query
    if (error) throw error
    return data as ClassWithDetails[]
  },

  async getById(id: string) {
    const { data, error } = await db
      .from('classes')
      .select(`*, academic_years(id, name)`)
      .eq('id', id)
      .maybeSingle()
    if (error) throw error
    return data as ClassWithDetails | null
  },

  async create(cls: Omit<Class, 'id' | 'created_at' | 'updated_at'>) {
    const { data, error } = await db
      .from('classes')
      .insert(cls)
      .select()
      .single()
    if (error) throw error
    return data as Class
  },

  async update(id: string, updates: Partial<Class>) {
    const { data, error } = await db
      .from('classes')
      .update(updates)
      .eq('id', id)
      .select()
      .single()
    if (error) throw error
    return data as Class
  },

  async delete(id: string) {
    const { error } = await db.from('classes').delete().eq('id', id)
    if (error) throw error
  },

  async getStudentCount(classId: string) {
    const { count, error } = await db
      .from('students')
      .select('*', { count: 'exact', head: true })
      .eq('class_id', classId)
      .eq('is_active', true)
    if (error) throw error
    return count ?? 0
  },
}
