import { supabase } from '@/lib/supabase'
import type { Device } from '@/types/database'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any

export const devicesService = {
  async getAll() {
    const { data, error } = await db
      .from('devices')
      .select('*')
      .order('created_at', { ascending: false })
    if (error) throw error
    return data as Device[]
  },

  async getById(id: string) {
    const { data, error } = await db
      .from('devices')
      .select('*')
      .eq('id', id)
      .maybeSingle()
    if (error) throw error
    return data as Device | null
  },

  async create(device: Omit<Device, 'id' | 'created_at' | 'updated_at'>) {
    const { data, error } = await db
      .from('devices')
      .insert(device)
      .select()
      .single()
    if (error) throw error
    return data as Device
  },

  async update(id: string, updates: Partial<Device>) {
    const { data, error } = await db
      .from('devices')
      .update(updates)
      .eq('id', id)
      .select()
      .single()
    if (error) throw error
    return data as Device
  },

  async delete(id: string) {
    const { error } = await db.from('devices').delete().eq('id', id)
    if (error) throw error
  },

  async updateLastSync(id: string) {
    const { data, error } = await db
      .from('devices')
      .update({ last_sync_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single()
    if (error) throw error
    return data as Device
  },
}
