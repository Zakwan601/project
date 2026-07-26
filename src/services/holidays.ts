import { supabase } from '@/lib/supabase'
import type { Holiday } from '@/types/database'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any

export const holidaysService = {
  async getAll(startDate?: string, endDate?: string) {
    let query = db.from('holidays').select('*').order('date', { ascending: true })
    if (startDate) query = query.gte('date', startDate)
    if (endDate) query = query.lte('date', endDate)
    const { data, error } = await query
    if (error) throw error
    return data as Holiday[]
  },

  async create(holiday: Omit<Holiday, 'id' | 'created_at' | 'updated_at' | 'created_by'>) {
    const { data, error } = await db
      .from('holidays')
      .insert(holiday)
      .select()
      .single()
    if (error) throw error
    return data as Holiday
  },

  async update(id: string, updates: Partial<Holiday>) {
    const { data, error } = await db
      .from('holidays')
      .update(updates)
      .eq('id', id)
      .select()
      .single()
    if (error) throw error
    return data as Holiday
  },

  async delete(id: string) {
    const { error } = await db.from('holidays').delete().eq('id', id)
    if (error) throw error
  },
}
