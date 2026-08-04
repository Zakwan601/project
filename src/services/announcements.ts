import { supabase } from '@/lib/supabase'
import { format } from 'date-fns'
import type { Announcement } from '@/types/database'

export type CreateAnnouncementInput = Pick<Announcement, 'title' | 'message' | 'expires_at'>

// The project uses handwritten database types that do not include generated relationships.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any

export const announcementsService = {
  async getActive(limit = 5) {
    const today = format(new Date(), 'yyyy-MM-dd')
    const { data, error } = await db
      .from('announcements')
      .select('*')
      .eq('is_active', true)
      .or(`expires_at.is.null,expires_at.gte.${today}`)
      .order('created_at', { ascending: false })
      .limit(limit)
    if (error) throw error
    return data as Announcement[]
  },

  async getAll() {
    const { data, error } = await db
      .from('announcements')
      .select('*')
      .order('created_at', { ascending: false })
    if (error) throw error
    return data as Announcement[]
  },

  async create(input: CreateAnnouncementInput) {
    const { data, error } = await db
      .from('announcements')
      .insert(input)
      .select()
      .single()
    if (error) throw error
    return data as Announcement
  },

  async delete(id: string) {
    const { error } = await db.from('announcements').delete().eq('id', id)
    if (error) throw error
  },
}
