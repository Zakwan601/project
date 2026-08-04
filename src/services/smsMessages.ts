import { supabase } from '@/lib/supabase'
import type { SmsMessage, SmsMessageStatus } from '@/types/database'

export interface SmsMessagePage {
  rows: SmsMessage[]
  total: number
}

export const smsMessagesService = {
  async getPage({
    page,
    pageSize,
    status,
    date,
  }: {
    page: number
    pageSize: number
    status: SmsMessageStatus | 'all'
    date: string
  }): Promise<SmsMessagePage> {
    const from = (page - 1) * pageSize
    let query = supabase
      .from('sms_messages')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(from, from + pageSize - 1)

    if (status !== 'all') query = query.eq('status', status)
    if (date) {
      const start = new Date(`${date}T00:00:00`)
      const end = new Date(start)
      end.setDate(end.getDate() + 1)
      query = query
        .gte('created_at', start.toISOString())
        .lt('created_at', end.toISOString())
    }

    const { data, error, count } = await query
    if (error) throw error

    return { rows: data, total: count ?? 0 }
  },
}
