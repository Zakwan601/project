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
    startDate,
    endDate,
  }: {
    page: number
    pageSize: number
    status: SmsMessageStatus | 'all'
    startDate: string
    endDate: string
  }): Promise<SmsMessagePage> {
    const from = (page - 1) * pageSize
    let query = supabase
      .from('sms_messages')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(from, from + pageSize - 1)

    if (status !== 'all') query = query.eq('status', status)
    if (startDate) {
      const start = new Date(`${startDate}T00:00:00`)
      query = query.gte('created_at', start.toISOString())
    }
    if (endDate) {
      const end = new Date(`${endDate}T00:00:00`)
      end.setDate(end.getDate() + 1)
      query = query.lt('created_at', end.toISOString())
    }

    const { data, error, count } = await query
    if (error) throw error

    return { rows: data, total: count ?? 0 }
  },
}
