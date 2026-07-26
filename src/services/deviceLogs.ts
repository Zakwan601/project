import { supabase } from '@/lib/supabase'
import type { DeviceLogWithDevice } from '@/types/database'

// The handwritten database types do not describe relationship selections.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any

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
}
