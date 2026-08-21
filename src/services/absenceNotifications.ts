import { supabase } from '@/lib/supabase'

// The handwritten database types do not include this RPC yet.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any

export interface SendAbsenceNotificationsInput {
  date: string
}

export interface AbsenceNotificationStatus {
  hasSentMessage: boolean
  hasMessageInProgress: boolean
}

export interface SendAbsenceNotificationsResult {
  success?: boolean
  message?: string
  submitted?: number
  failed?: number
  skipped?: number
  discord_sent?: boolean
  [key: string]: unknown
}

export const absenceNotificationsService = {
  async getStatus(date: string): Promise<AbsenceNotificationStatus> {
    const { data, error } = await db.rpc('get_absence_notification_status', {
      p_date: date,
    })

    if (error) {
      throw new Error(error.message || 'Absence notification status could not be checked.')
    }

    const status = data as {
      has_sent_message?: boolean
      has_message_in_progress?: boolean
    } | null

    return {
      hasSentMessage: status?.has_sent_message === true,
      hasMessageInProgress: status?.has_message_in_progress === true,
    }
  },

  async send(input: SendAbsenceNotificationsInput): Promise<SendAbsenceNotificationsResult> {
    const { data, error } = await supabase.functions.invoke<SendAbsenceNotificationsResult>(
      'absent-students',
      { body: input },
    )

    if (error) {
      const responseMessage = await readFunctionError(error)
      throw new Error(responseMessage || error.message || 'Absence notifications could not be sent.')
    }

    if (data?.success === false) {
      if (typeof data.error === 'string') throw new Error(data.error)
      const failed = typeof data.failed === 'number' ? data.failed : 0
      throw new Error(
        failed > 0
          ? `${failed} absence notification${failed === 1 ? '' : 's'} failed. Check SMS Messages for details.`
          : 'Absence notifications could not be completed.',
      )
    }
    return data ?? {}
  },
}

async function readFunctionError(error: unknown) {
  if (!hasResponseContext(error)) return null

  try {
    const payload = await error.context.json() as Record<string, unknown>
    if (typeof payload.error === 'string') return payload.error
    if (typeof payload.message === 'string') return payload.message
  } catch {
    // The generic function error below is still useful when the response is not JSON.
  }

  return null
}

function hasResponseContext(error: unknown): error is { context: Response } {
  return typeof error === 'object'
    && error !== null
    && 'context' in error
    && error.context instanceof Response
}
