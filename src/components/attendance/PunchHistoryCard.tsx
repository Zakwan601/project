import { Fragment, useState } from 'react'
import { CheckCircle, ChevronDown, ChevronLeft, ChevronRight, Clock3, LogIn, LogOut, MoreHorizontal, ScanLine, UserRound } from 'lucide-react'
import { useDailyPunchesPage, useDashboardPunches } from '@/hooks/useDeviceLogs'
import type { DashboardPunch } from '@/types/database'
import type { DailyPunchGroup } from '@/services/deviceLogs'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { formatDisplayDate, splitBangladeshDateTime } from '@/lib/dateTime'
import { DateFilter } from '@/components/shared/DateFilter'

interface PunchHistoryCardProps {
  admissionNumber?: string
  title: string
  description: string
  variant?: 'list' | 'table'
}

export function PunchHistoryCard({
  admissionNumber,
  title,
  description,
  variant = 'list',
}: PunchHistoryCardProps) {
  const isTable = variant === 'table'
  const [dateFilter, setDateFilter] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)
  const punchQuery = useDashboardPunches(admissionNumber, !isTable)
  const tableQuery = useDailyPunchesPage({
    admissionNumber,
    date: dateFilter,
    page,
    pageSize,
    enabled: isTable,
  })
  const dailyPunches = isTable
    ? (tableQuery.data?.rows ?? []).map(pagedPunchToDailyPunches)
    : groupDailyPunches(punchQuery.data ?? [])
  const total = isTable ? (tableQuery.data?.total ?? 0) : dailyPunches.length
  const isLoading = isTable ? tableQuery.isLoading : punchQuery.isLoading
  const isFetching = isTable ? tableQuery.isFetching : punchQuery.isFetching
  const error = isTable ? tableQuery.error : punchQuery.error

  function changeDate(value: string) {
    setDateFilter(value)
    setPage(1)
  }

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
              {total} {variant === 'table'
                ? (total === 1 ? 'record' : 'records')
                : (dailyPunches.length === 1 ? 'day' : 'days')}
            </span>
          )}
        </div>
        {isTable && (
        <div className="mt-2 flex flex-wrap items-end justify-between gap-2 sm:mt-4 sm:gap-3">
            <DateFilter
              mode="date"
              value={dateFilter}
              onChange={changeDate}
              label="Filter by date"
              allowClear
            />
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              Rows per page
              <select
                value={pageSize}
                onChange={event => {
                  setPageSize(Number(event.target.value))
                  setPage(1)
                }}
                className="h-9 rounded-md border bg-background px-2 text-sm text-foreground shadow-xs outline-none focus:border-ring"
              >
                <option value={10}>10</option>
                <option value={25}>25</option>
                <option value={50}>50</option>
              </select>
            </label>
          </div>
        )}
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
        ) : variant === 'table' ? (
          <AdminPunchTable
            days={dailyPunches}
            total={total}
            page={page}
            pageSize={pageSize}
            isFetching={isFetching}
            onPageChange={setPage}
          />
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

function AdminPunchTable({
  days,
  total,
  page,
  pageSize,
  isFetching,
  onPageChange,
}: {
  days: DailyPunches[]
  total: number
  page: number
  pageSize: number
  isFetching: boolean
  onPageChange: (page: number) => void
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const firstRecord = total === 0 ? 0 : (page - 1) * pageSize + 1
  const lastRecord = Math.min(page * pageSize, total)

  return (
    <div>
      <div className={`transition-opacity ${isFetching ? 'opacity-60' : ''}`}>
        <Table className="min-w-[860px]">
          <TableHeader className="sticky top-0 z-10 bg-muted/95 backdrop-blur">
            <TableRow>
              <TableHead className="w-32">Date</TableHead>
              <TableHead>Student</TableHead>
              <TableHead className="w-36">Biometric ID</TableHead>
              <TableHead className="w-32">Arrival</TableHead>
              <TableHead className="w-32">Departure</TableHead>
              <TableHead className="w-28">Status</TableHead>
              <TableHead className="w-24 text-right">Punches</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {days.map(day => <AdminPunchTableRow key={day.key} day={day} />)}
          </TableBody>
        </Table>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t px-3 py-2 sm:gap-3 sm:px-4 sm:py-3">
        <p className="text-xs text-muted-foreground">
          Showing {firstRecord}-{lastRecord} of {total}
        </p>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Page {page} of {totalPages}</span>
          <Button
            variant="outline"
            size="icon-sm"
            onClick={() => onPageChange(page - 1)}
            disabled={page <= 1 || isFetching}
            aria-label="Previous page"
          >
            <ChevronLeft />
          </Button>
          <Button
            variant="outline"
            size="icon-sm"
            onClick={() => onPageChange(page + 1)}
            disabled={page >= totalPages || isFetching}
            aria-label="Next page"
          >
            <ChevronRight />
          </Button>
        </div>
      </div>
    </div>
  )
}

function AdminPunchTableRow({ day }: { day: DailyPunches }) {
  const [isExpanded, setIsExpanded] = useState(false)
  const name = day.student
    ? `${day.student.first_name} ${day.student.last_name}`.trim()
    : 'Unknown user'
  const initials = day.student
    ? `${day.student.first_name[0] ?? ''}${day.student.last_name[0] ?? ''}`
    : ''
  const arrival = splitPunchTime(day.checkIn.punched_at)
  const departure = day.checkOut ? splitPunchTime(day.checkOut.punched_at) : null
  const isPresent = isOnTimeArrival(day.checkIn.punched_at)
  const punchCount = 1 + (day.checkOut ? 1 : 0) + day.extraPunches.length

  return (
    <Fragment>
      <TableRow className="hover:bg-muted/40">
        <TableCell className="whitespace-nowrap font-medium">{formatDisplayDate(arrival.date)}</TableCell>
        <TableCell>
          <div className="flex min-w-44 items-center gap-2.5">
            <Avatar className="h-8 w-8 border">
              {day.student?.photo_url && <AvatarImage src={day.student.photo_url} alt={name} />}
              <AvatarFallback className="text-[10px]">
                {initials || <UserRound className="h-4 w-4" />}
              </AvatarFallback>
            </Avatar>
            <span className="truncate text-sm font-medium">{name}</span>
          </div>
        </TableCell>
        <TableCell className="font-mono text-xs">{day.studentBiometricId}</TableCell>
        <TableCell className="whitespace-nowrap font-mono text-sm text-emerald-700 dark:text-emerald-400">
          {arrival.time}
        </TableCell>
        <TableCell className="whitespace-nowrap font-mono text-sm">
          {departure?.time ?? '—'}
        </TableCell>
        <TableCell>
          <Badge
            variant="secondary"
            className={isPresent
              ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
              : 'bg-amber-500/10 text-amber-700 dark:text-amber-400'}
          >
            {isPresent ? 'Present' : 'Late'}
          </Badge>
        </TableCell>
        <TableCell className="text-right">
          {day.extraPunches.length > 0 ? (
            <button
              type="button"
              onClick={() => setIsExpanded(value => !value)}
              aria-expanded={isExpanded}
              aria-label={`${isExpanded ? 'Hide' : 'Show'} ${day.extraPunches.length} extra punches`}
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              {punchCount}
              <ChevronDown className={`h-3.5 w-3.5 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
            </button>
          ) : (
            <span className="pr-2 text-xs text-muted-foreground">{punchCount}</span>
          )}
        </TableCell>
      </TableRow>
      {isExpanded && day.extraPunches.length > 0 && (
        <TableRow className="bg-muted/20 hover:bg-muted/20">
          <TableCell colSpan={7} className="py-2">
            <div className="flex items-center justify-end gap-2 text-xs">
              <span className="mr-1 text-muted-foreground">Extra punches</span>
              {day.extraPunches.map((punch, index) => (
                <span key={punch.id} className="rounded-md border bg-background px-2 py-1 font-mono">
                  {index + 3}: {splitPunchTime(punch.punched_at).time}
                </span>
              ))}
            </div>
          </TableCell>
        </TableRow>
      )}
    </Fragment>
  )
}

interface DailyPunches {
  key: string
  studentBiometricId: string
  student: DashboardPunch['student']
  checkIn: Pick<DashboardPunch, 'id' | 'punched_at'>
  checkOut: Pick<DashboardPunch, 'id' | 'punched_at'> | null
  extraPunches: Array<Pick<DashboardPunch, 'id' | 'punched_at'>>
}

function pagedPunchToDailyPunches(group: DailyPunchGroup): DailyPunches {
  return {
    key: group.key,
    studentBiometricId: group.studentBiometricId,
    student: group.student,
    checkIn: group.punches[0],
    checkOut: group.punches[1] ?? null,
    extraPunches: group.punches.slice(2),
  }
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
  const isPresent = isOnTimeArrival(day.checkIn.punched_at)

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
            <p className={`mt-1 flex items-center gap-1 text-xs font-medium ${
              isPresent ? 'text-emerald-600' : 'text-amber-600'
            }`}>
              {isPresent
                ? <CheckCircle className="h-3.5 w-3.5" />
                : <Clock3 className="h-3.5 w-3.5" />}
              {isPresent ? 'Present' : 'Late — after 9:00 AM'}
            </p>
          </div>
        </div>

        <div className="min-w-32 text-right">
          <p className="mb-1 text-[11px] text-muted-foreground">{formatDisplayDate(arrival.date)}</p>
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

function isOnTimeArrival(value: string) {
  const { time24 } = splitPunchTime(value)
  return /^\d{2}:\d{2}:\d{2}$/.test(time24) && time24 <= '09:00:00'
}

function splitPunchTime(value: string) {
  return splitBangladeshDateTime(value)
}
