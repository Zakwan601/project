import { supabase } from '@/lib/supabase'

const DEPARTURE_ANOMALY_ENDPOINT =
  'https://cswkotivlmtaegaiyxdm.supabase.co/functions/v1/analyze-departure-anomalies'

export interface DepartureAnalysisInput {
  class_id: string
  date: string
  departure_time: string
}

export type DepartureRiskLevel = 'High' | 'Medium' | 'Low'
export type DepartureConfidence = 'High' | 'Medium' | 'Low'
export type DepartureAnomalyCategory =
  | 'missing_departure'
  | 'significantly_early'
  | 'statistical_outlier'

export interface DepartureRiskReason {
  code: string
  category: DepartureAnomalyCategory | 'history'
  message: string
  evidence: Record<string, string | number | boolean | null>
}

export interface FlaggedDepartureStudent {
  student_id: string
  admission_number: string
  roll_number: number | null
  student_name: string
  photo_url: string | null
  arrival_at: string
  departure_at: string | null
  arrival_time: string
  departure_time: string | null
  scan_count: number
  categories: DepartureAnomalyCategory[]
  risk_score: number
  risk_level: DepartureRiskLevel
  confidence: DepartureConfidence
  reasons: DepartureRiskReason[]
  evidence: {
    minutes_before_dismissal: number | null
    minutes_before_cohort_median: number | null
    modified_z_score: number | null
    outlier_method: string
  }
  history: {
    window_days: number
    observed_days: number
    comparable_early_departure_days: number
    missing_departure_days: number
    early_departure_days: number
  }
}

export interface DepartureAnalysisResponse {
  report_id: string | null
  algorithm_version: string
  generated_at: string
  date: string
  class: { id: string; name: string; grade: string; section: string }
  configuration: {
    departure_time: string
    timezone: string
    early_threshold_minutes: number
    history_window_days: number
    minimum_cohort_size: number
    cache_ttl_seconds: number
  }
  cohort: {
    total_active_students: number
    students_arrived: number
    with_departure: number
    without_departure: number
    minimum_size_for_outliers: number
    median_departure_time: string | null
    q1_departure_time: string | null
    q3_departure_time: string | null
    iqr_minutes: number | null
    mad_minutes: number | null
    statistics_reliable: boolean
  }
  summary: {
    total_flagged: number
    by_category: Record<DepartureAnomalyCategory, number>
    by_risk_level: { high: number; medium: number; low: number }
  }
  flagged_students: FlaggedDepartureStudent[]
  cached: boolean
  saved?: boolean
  cache_expires_at: string
  request_id: string
}

export const departureAnomaliesService = {
  async analyze(input: DepartureAnalysisInput): Promise<DepartureAnalysisResponse> {
    const accessToken = await getAccessToken()

    const response = await fetch(DEPARTURE_ANOMALY_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        Apikey: import.meta.env.VITE_SUPABASE_ANON_KEY as string,
      },
      body: JSON.stringify(input),
    })

    const payload = await parseResponse(response)
    if (!response.ok) throw responseError(response, payload)

    return payload as unknown as DepartureAnalysisResponse
  },

  async getSaved(classId: string, date: string): Promise<DepartureAnalysisResponse | null> {
    const accessToken = await getAccessToken()
    const url = new URL(DEPARTURE_ANOMALY_ENDPOINT)
    url.searchParams.set('class_id', classId)
    url.searchParams.set('date', date)

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Apikey: import.meta.env.VITE_SUPABASE_ANON_KEY as string,
      },
    })
    const payload = await parseResponse(response)
    if (response.status === 404 && payload.code === 'saved_analysis_not_found') return null
    if (!response.ok) throw responseError(response, payload)
    return payload as unknown as DepartureAnalysisResponse
  },
}

async function getAccessToken() {
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession()
  if (sessionError) throw sessionError
  const accessToken = sessionData.session?.access_token
  if (!accessToken) throw new Error('Your session has expired. Please sign in again.')
  return accessToken
}

function responseError(response: Response, payload: Record<string, unknown>) {
  const message = typeof payload.error === 'string'
    ? payload.error
    : `Analysis failed with status ${response.status}`
  const details = typeof payload.details === 'string' ? payload.details : null
  const requestId = typeof payload.request_id === 'string' ? payload.request_id : null
  return new Error([
    message,
    details,
    requestId ? `Request ID: ${requestId}` : null,
  ].filter(Boolean).join(' — '))
}

async function parseResponse(response: Response): Promise<Record<string, unknown>> {
  try {
    return await response.json() as Record<string, unknown>
  } catch {
    throw new Error(response.ok
      ? 'The analysis service returned an invalid response.'
      : `Analysis failed with status ${response.status}.`)
  }
}
