import { format } from 'date-fns'

const databaseTimestampPattern =
  /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})(\.\d+)?(Z|[+-]\d{2}(?::?\d{2})?)?$/

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

export function splitDatabaseWallClock(value: string) {
  const match = value.match(databaseTimestampPattern)
  if (match) {
    return {
      date: match[1],
      time24: match[2],
      time: formatTimeWithPeriod(`${match[2]}${match[3] ?? ''}`),
      offset: normalizeOffset(match[4]),
    }
  }

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return { date: '', time24: '', time: value, offset: '' }
  }

  return {
    date: format(date, 'yyyy-MM-dd'),
    time24: [date.getHours(), date.getMinutes(), date.getSeconds()]
      .map(part => String(part).padStart(2, '0'))
      .join(':'),
    time: date.toLocaleTimeString([], {
      hour: 'numeric',
      minute: '2-digit',
      second: '2-digit',
      hour12: true,
    }),
    offset: '',
  }
}

export function formatDatabaseWallClock(value: string | null) {
  if (!value) return '—'
  const parsed = splitDatabaseWallClock(value)
  if (!parsed.date) return parsed.time
  return `${formatDisplayDate(parsed.date)} ${parsed.time}${parsed.offset ? ` ${parsed.offset}` : ''}`
}

export function formatDisplayDate(value: string | Date | null | undefined) {
  if (!value) return '—'

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? '—' : format(value, 'dd-MM-yyyy')
  }

  const dateOnly = value.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (dateOnly) return `${dateOnly[3]}-${dateOnly[2]}-${dateOnly[1]}`

  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : format(date, 'dd-MM-yyyy')
}

export function formatDisplayDateTime(value: string | Date | null | undefined) {
  if (!value) return '—'
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? String(value) : format(date, 'dd-MM-yyyy, h:mm:ss a')
}

function normalizeOffset(offset: string | undefined) {
  if (!offset) return ''
  if (offset === 'Z' || offset === '+00:00' || offset === '+0000') return '+00'
  if (/^[+-]\d{2}:00$/.test(offset)) return offset.slice(0, 3)
  return offset
}
