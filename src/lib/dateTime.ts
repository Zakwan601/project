export const BANGLADESH_TIME_ZONE = 'Asia/Dhaka'

const bangladeshDateTimePartsFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: BANGLADESH_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
})

const bangladeshTimeFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: BANGLADESH_TIME_ZONE,
  hour: 'numeric',
  minute: '2-digit',
  second: '2-digit',
  hour12: true,
})

const bangladeshDateFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: BANGLADESH_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

export function formatTimeWithPeriod(value: string) {
  const match = value.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?(\.\d+)?$/)
  if (!match) return value

  const hour = Number(match[1])
  if (hour < 0 || hour > 23) return value

  const displayHour = hour % 12 || 12
  const seconds = match[3] == null ? '' : `:${match[3]}`
  const fraction = match[4] ?? ''
  return `${displayHour}:${match[2]}${seconds}${fraction} ${hour < 12 ? 'AM' : 'PM'}`
}

/** Splits an instant into its calendar and clock fields in Bangladesh time. */
export function splitBangladeshDateTime(value: string | Date) {
  const date = toDate(value)
  if (!date) {
    return { date: '', time24: '', time: String(value) }
  }

  const parts = Object.fromEntries(
    bangladeshDateTimePartsFormatter
      .formatToParts(date)
      .filter(part => part.type !== 'literal')
      .map(part => [part.type, part.value]),
  )

  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time24: `${parts.hour}:${parts.minute}:${parts.second}`,
    time: bangladeshTimeFormatter.format(date),
  }
}

/** Formats a Supabase timestamptz instant in Asia/Dhaka. */
export function formatBangladeshDateTime(value: string | Date | null | undefined) {
  if (!value) return '—'

  const parsed = splitBangladeshDateTime(value)
  if (!parsed.date) return parsed.time
  return `${formatDateOnly(parsed.date)} ${parsed.time}`
}

export function formatDisplayDate(value: string | Date | null | undefined) {
  if (!value) return '—'

  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return formatDateOnly(value)
  }

  const date = toDate(value)
  return date ? bangladeshDateFormatter.format(date).replaceAll('/', '-') : String(value)
}

export function formatDisplayDateTime(value: string | Date | null | undefined) {
  if (!value) return '—'
  return formatBangladeshDateTime(value)
}

function formatDateOnly(value: string) {
  const [year, month, day] = value.split('-')
  return `${day}-${month}-${year}`
}

function toDate(value: string | Date) {
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}
