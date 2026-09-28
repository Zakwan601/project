import type { Session } from '@supabase/supabase-js'

export type BulkStudentLoginResult = {
  export_id: string
  file_name: string
  created: number
  skipped: number
  failed: number
  failures: Array<{ student_id: string; name: string; error: string }>
  expires_in_hours: number
}

function functionUrl() {
  return `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/bulk-student-logins`
}

function headers(session: Session) {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${session.access_token}`,
    apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
  }
}

async function readError(response: Response) {
  const result = await response.json().catch(() => null) as { error?: string } | null
  return result?.error || 'Student login request failed'
}

export async function createBulkStudentLogins(
  session: Session,
  studentIds: string[],
  domain: string,
) {
  const response = await fetch(functionUrl(), {
    method: 'POST',
    headers: headers(session),
    body: JSON.stringify({
      action: 'create',
      student_ids: studentIds,
      domain,
    }),
  })
  if (!response.ok) throw new Error(await readError(response))
  return response.json() as Promise<BulkStudentLoginResult>
}

export async function downloadStudentLoginExport(
  session: Session,
  exportId: string,
  fallbackFileName: string,
) {
  const response = await fetch(functionUrl(), {
    method: 'POST',
    headers: headers(session),
    body: JSON.stringify({ action: 'download', export_id: exportId }),
  })
  if (!response.ok) throw new Error(await readError(response))

  const blob = await response.blob()
  const disposition = response.headers.get('Content-Disposition')
  const headerName = disposition?.match(/filename="([^"]+)"/)?.[1]
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = headerName || fallbackFileName
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000)
}
