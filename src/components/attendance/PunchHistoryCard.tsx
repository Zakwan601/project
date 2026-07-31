import { useState } from 'react'
import { CheckCircle, ChevronDown, Clock3, LogIn, LogOut, MoreHorizontal, ScanLine, UserRound } from 'lucide-react'
import { useDashboardPunches } from '@/hooks/useDeviceLogs'
import type { DashboardPunch } from '@/types/database'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ScrollArea } from '@/components/ui/scroll-area'

interface PunchHistoryCardProps {
  admissionNumber?: string
  title: string
  description: string
}

export function PunchHistoryCard({
  admissionNumber,
  title,
  description,
}: PunchHistoryCardProps) {
  const { data: punches = [], isLoading, error } = useDashboardPunches(admissionNumber)
  const dailyPunches = groupDailyPunches(punches)

  return (
    <Card>
      <CardHeader className="border-b">
        <div className="flex items-start justify-between gap-4">
          <div>
            <CardTitle className="flex items-center gap-2">
              <ScanLine className="h-5 w-5" />
              {title}
            </CardTitle>
            <CardDescription className="mt-1">{description}</CardDescription>
          </div>
          {!isLoading && !error && (
            <span className="shrink-0 rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">
              {dailyPunches.length} {dailyPunches.length === 1 ? 'day' : 'days'}
            </span>
          )}
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {isLoading ? (
          <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
            <Clock3 className="h-4 w-4 animate-pulse" />
            Loading punches...
          </div>
        ) : error ? (
          <p className="px-5 py-10 text-center text-sm text-destructive">
            {(error as Error).message}
          </p>
        ) : dailyPunches.length === 0 ? (
          <div className="px-5 py-12 text-center">
            <ScanLine className="mx-auto mb-3 h-8 w-8 text-muted-foreground/60" />
            <p className="text-sm font-medium">No punches found</p>
            <p className="mt-1 text-xs text-muted-foreground">
              New biometric punches will appear here automatically.
            </p>
          </div>
        ) : (
          <ScrollArea className="h-[520px]">
            <div>
              {dailyPunches.map(day => <DailyPunchRow key={day.key} day={day} />)}
            </div>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  )
}

interface DailyPunches {
  key: string
  studentBiometricId: string
  student: DashboardPunch['student']
  checkIn: DashboardPunch
  checkOut: DashboardPunch | null
  extraPunches: DashboardPunch[]
}

function DailyPunchRow({ day }: { day: DailyPunches }) {
  const [isExpanded, setIsExpanded] = useState(false)
  const name = day.student
    ? `${day.student.first_name} ${day.student.last_name}`.trim()
    : 'Unknown user'
  const initials = day.student
    ? `${day.student.first_name[0] ?? ''}${day.student.last_name[0] ?? ''}`
    : ''
  const arrival = splitPunchTime(day.checkIn.punched_at)
  const departure = day.checkOut ? splitPunchTime(day.checkOut.punched_at) : null

  return (
    <div className="border-b last:border-b-0">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 px-4 py-3 sm:px-5">
        <div className="flex min-w-0 items-center gap-3">
          <Avatar className="h-10 w-10 border">
            {day.student?.photo_url && (
              <AvatarImage src={day.student.photo_url} alt={name} />
            )}
            <AvatarFallback>
              {initials || <UserRound className="h-5 w-5" />}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{day.studentBiometricId}</p>
            <p className="truncate text-sm text-muted-foreground">{name}</p>
            <p className="mt-1 flex items-center gap-1 text-xs font-medium text-emerald-600">
              <CheckCircle className="h-3.5 w-3.5" />
              Present
            </p>
          </div>
        </div>

        <div className="min-w-32 text-right">
          <p className="mb-1 text-[11px] text-muted-foreground">{arrival.date}</p>
          <p className="flex items-center justify-end gap-1.5 font-mono text-sm">
            <LogIn className="h-3.5 w-3.5 text-emerald-600" />
            <span className="text-[11px] text-muted-foreground">Arrival</span>
            {arrival.time}
          </p>
          <p className="mt-1 flex items-center justify-end gap-1.5 font-mono text-sm">
            <LogOut className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-[11px] text-muted-foreground">Departure</span>
            {departure?.time ?? '—'}
          </p>
          {day.extraPunches.length > 0 && (
            <button
              type="button"
              onClick={() => setIsExpanded(value => !value)}
              aria-expanded={isExpanded}
              aria-label={`${isExpanded ? 'Hide' : 'Show'} ${day.extraPunches.length} extra punches`}
              title={`${isExpanded ? 'Hide' : 'Show'} extra punches`}
              className="mt-2 inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <MoreHorizontal className="h-3.5 w-3.5" />
              {day.extraPunches.length}
              <ChevronDown className={`h-3.5 w-3.5 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
            </button>
          )}
        </div>
      </div>

      {isExpanded && day.extraPunches.length > 0 && (
        <div className="border-t bg-muted/20 px-4 py-3 sm:px-5">
          <div className="ml-auto max-w-xs space-y-2">
            {day.extraPunches.map((punch, index) => (
              <div key={punch.id} className="flex items-center justify-between gap-4 text-xs">
                <span className="text-muted-foreground">Extra punch {index + 1}</span>
                <span className="font-mono">{splitPunchTime(punch.punched_at).time}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function groupDailyPunches(punches: DashboardPunch[]): DailyPunches[] {
  const groups = new Map<string, DashboardPunch[]>()

  for (const punch of punches) {
    const date = splitPunchTime(punch.punched_at).date
    const key = `${punch.student_biometric_id}:${date}`
    const group = groups.get(key)
    if (group) group.push(punch)
    else groups.set(key, [punch])
  }

  return Array.from(groups, ([key, group]) => {
    const ordered = [...group].sort((a, b) => punchTime(a.punched_at) - punchTime(b.punched_at))
    return {
      key,
      studentBiometricId: ordered[0].student_biometric_id,
      student: ordered[0].student,
      checkIn: ordered[0],
      checkOut: ordered.length >= 2 ? ordered[1] : null,
      extraPunches: ordered.slice(2),
    }
  }).sort((a, b) => punchTime(b.checkIn.punched_at) - punchTime(a.checkIn.punched_at))
}

function punchTime(value: string) {
  const timestamp = new Date(value).getTime()
  return Number.isNaN(timestamp) ? 0 : timestamp
}

function splitPunchTime(value: string) {
  const match = value.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})/)
  if (match) return { date: match[1], time: match[2] }

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return { date: '', time: value }
  return {
    date: date.toLocaleDateString(),
    time: date.toLocaleTimeString([], { hour12: false }),
  }
}
