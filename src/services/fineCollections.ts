import { supabase } from '@/lib/supabase'
import type { StudentFineDetails } from './studentDashboard'

const db = supabase as any
export interface FineQuote {
  from_date: string; to_date: string; gross_amount: number; eligible: boolean; fine: StudentFineDetails | null
}
export interface FineAllocation extends FineQuote { month: string; waiver_amount: number; paid_amount: number }
export interface FinePayment {
  id: string; receipt_number: number; request_id: string; student_id: string
  period_start: string; period_end: string; gross_amount: number; waiver_amount: number; paid_amount: number
  fine_snapshot: StudentFineDetails; monthly_breakdown: FineAllocation[]; collected_at: string; collector_name: string
  student_snapshot: { name: string; student_id: string; class_name: string | null; student_phone: string | null; guardian_phone: string | null }
}
export interface FineMonth {
  month: string; through: string; status: 'paid' | 'partial' | 'unpaid'; paid_through: string | null; unpaid_amount: number
  settled: { gross_amount: number; waiver_amount: number; paid_amount: number }
}
export interface FineAccount {
  student_id: string; paid_through: string | null; next_start: string; quote: FineQuote; months: FineMonth[]; payments: FinePayment[]
}
export interface FineMonthDetails {
  attendance: { id: string; date: string; status: string; class_name: string }[]
  missed_exams: { id: string; date: string; exam: string; subject: string }[]
}
export const fineCollectionsService = {
  async totals(from: string, to: string, signal?: AbortSignal): Promise<{ received: number; waived: number; assessed: number; receipts: number }> {
    const { data, error } = await db.rpc('get_fine_collection_totals', { p_from: from || null, p_to: to || null }).abortSignal(signal)
    if (error) throw error
    return data
  },
  async account(studentId: string, until: string, signal?: AbortSignal): Promise<FineAccount> {
    const { data, error } = await db.rpc('get_student_fine_account', { p_student_id: studentId, p_until: until }).abortSignal(signal)
    if (error) throw error
    return data
  },
  async month(studentId: string, month: string, signal?: AbortSignal): Promise<FineMonthDetails> {
    const { data, error } = await db.rpc('get_student_fine_month_details', { p_student_id: studentId, p_month: month }).abortSignal(signal)
    if (error) throw error
    return data
  },
  async collect(studentId: string, quote: FineQuote, waiver: number, requestId: string): Promise<FinePayment> {
    const { data, error } = await db.rpc('collect_student_fine', {
      p_student_id: studentId, p_until: quote.to_date, p_waiver: waiver,
      p_expected_start: quote.from_date, p_expected_gross: quote.gross_amount, p_request_id: requestId,
    })
    if (error) throw error
    return data
  },
}
