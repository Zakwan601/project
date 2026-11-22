import { supabase } from '@/lib/supabase'

const db = supabase as any
export interface RoutineEntry {
  id: string; class_id: string; day_of_week: number; start_time: string; end_time: string
  subject_name: string; teacher_name: string; room: string
}
export interface ClassRoutines {
  classes: { id: string; name: string; session: string | null }[]
  entries: RoutineEntry[]
}
export const classRoutinesService = {
  async get(classId: string, signal?: AbortSignal): Promise<ClassRoutines> {
    const { data, error } = await db.rpc('get_public_class_routines', { p_class_id: classId || null }).abortSignal(signal)
    if (error) throw error
    return data
  },
  async save(entry: Omit<RoutineEntry, 'id'>, id?: string) {
    const query = id ? db.from('class_routine_entries').update(entry).eq('id', id) : db.from('class_routine_entries').insert(entry)
    const { error } = await query.select('id').single()
    if (error) throw error
  },
  async remove(id: string) {
    const { error } = await db.from('class_routine_entries').delete().eq('id', id).select('id').single()
    if (error) throw error
  },
}
