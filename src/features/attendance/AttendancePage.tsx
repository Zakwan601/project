import { useEffect, useMemo, useState } from 'react'
import { CalendarOff, CheckCircle, RefreshCw, Trash2, UserX, Users } from 'lucide-react'
import { format } from 'date-fns'
import { useQuery } from '@tanstack/react-query'
import {
  useAttendanceRecords,
  useAttendanceSessions,
  useMarkAttendanceVacation,
  useSyncDailyAttendance,
} from '@/hooks/useAttendance'
import { useDeleteHoliday, useHolidays } from '@/hooks/useHolidays'
import { useClasses } from '@/hooks/useClasses'
import { useAuth } from '@/contexts/AuthContext'
import { studentsService } from '@/services/students'
import { supabase } from '@/lib/supabase'
import { formatDatabaseWallClock } from '@/lib/dateTime'
import { PageHeader, LoadingState, ErrorState, EmptyState } from '@/components/shared/PageHeader'
import { DesktopSyncLastSync } from '@/components/shared/DesktopSyncLastSync'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import type { AttendanceSessionWithDetails, AttendanceStatus } from '@/types/database'

// Handwritten database types do not include all nested relationship selections.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any

const statusStyles: Record<AttendanceStatus, string> = {
  present: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
  absent: 'bg-red-500/10 text-red-700 dark:text-red-400',
  late: 'bg-amber-500/10 text-amber-700 dark:text-amber-400',
  excused: 'bg-blue-500/10 text-blue-700 dark:text-blue-400',
}

export function AttendancePage() {
  const { role } = useAuth()
  return role === 'student' ? <StudentDailyAttendance /> : <StaffDailyAttendance />
}

function StaffDailyAttendance() {
  const { role } = useAuth()
  const isAdmin = role === 'admin'
  const [selectedDate, setSelectedDate] = useState(format(new Date(), 'yyyy-MM-dd'))
  const [selectedClassId, setSelectedClassId] = useState('all')
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  const [vacationDialogOpen, setVacationDialogOpen] = useState(false)
  const [vacationName, setVacationName] = useState('')
  const [vacationDescription, setVacationDescription] = useState('')

  const classFilter = selectedClassId === 'all' ? undefined : selectedClassId
  const { data: sessions = [], isLoading, error } = useAttendanceSessions(classFilter, selectedDate)
  const { data: classes = [] } = useClasses()
  const { data: holidays = [] } = useHolidays(selectedDate, selectedDate)
  const syncAttendance = useSyncDailyAttendance()
  const markVacation = useMarkAttendanceVacation()
  const deleteHoliday = useDeleteHoliday()
  const selectedHoliday = holidays[0] ?? null
  const selectedDateIsWeekend = isWeekend(selectedDate)
  const isNonSchoolDay = selectedDateIsWeekend || Boolean(selectedHoliday)

  useEffect(() => {
    if (sessions.length === 0) {
      setActiveSessionId(null)
      return
    }
    if (!sessions.some(session => session.id === activeSessionId)) {
      setActiveSessionId(sessions[0].id)
    }
  }, [sessions, activeSessionId])

  const activeSession = sessions.find(session => session.id === activeSessionId) ?? null

  if (isLoading) return <LoadingState />
  if (error) return <ErrorState message={(error as Error).message} />

  return (
    <div>
      <PageHeader
        title="Daily Attendance"
        description="One biometric attendance result per student, per day"
        action={isAdmin ? (
          <div className="flex w-full gap-2 sm:w-auto sm:justify-end">
            {!isNonSchoolDay && (
              <Button
                size="sm"
                variant="outline"
                className="min-w-0 flex-1 sm:flex-none"
                onClick={() => setVacationDialogOpen(true)}
              >
                <CalendarOff className="mr-1.5 h-4 w-4" />
                Add Vacation
              </Button>
            )}
            <Button
              size="sm"
              className="min-w-0 flex-1 sm:flex-none"
              onClick={() => syncAttendance.mutate(selectedDate)}
              disabled={syncAttendance.isPending || isNonSchoolDay}
            >
              <RefreshCw className={`mr-1.5 h-4 w-4 ${syncAttendance.isPending ? 'animate-spin' : ''}`} />
              {syncAttendance.isPending ? 'Syncing…' : 'Sync Attendance'}
            </Button>
          </div>
        ) : undefined}
      />
      <DesktopSyncLastSync className="-mt-2 mb-3 sm:-mt-3 sm:mb-5" />

      <Card className="mb-3 sm:mb-5">
        <CardContent className="grid grid-cols-2 gap-2 p-3 sm:gap-4 sm:p-4">
          <div className="min-w-0 space-y-1.5 sm:space-y-2">
            <Label htmlFor="attendance-date" className="text-xs sm:text-sm">Date</Label>
            <Input
              id="attendance-date"
              type="date"
              value={selectedDate}
              onChange={event => setSelectedDate(event.target.value)}
            />
          </div>
          <div className="min-w-0 space-y-1.5 sm:space-y-2">
            <Label className="text-xs sm:text-sm">Class</Label>
            <Select value={selectedClassId} onValueChange={setSelectedClassId}>
              <SelectTrigger><SelectValue placeholder="All classes" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Classes</SelectItem>
                {classes.map(classItem => (
                  <SelectItem key={classItem.id} value={classItem.id}>
                    {classItem.name} — Grade {classItem.grade} {classItem.section}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {isNonSchoolDay && (
        <div className="mb-3 flex flex-col gap-2 rounded-xl border border-blue-500/20 bg-blue-500/5 p-3 sm:mb-5 sm:flex-row sm:items-center sm:gap-3 sm:p-4">
          <div className="flex min-w-0 flex-1 items-start gap-3">
            <div className="rounded-lg bg-blue-500/10 p-2 text-blue-600 dark:text-blue-400">
              <CalendarOff className="h-5 w-5" />
            </div>
            <div>
              <p className="font-semibold">
                {selectedDateIsWeekend ? 'Weekend' : selectedHoliday?.name}
              </p>
              <p className="mt-0.5 text-sm text-muted-foreground">
                {selectedDateIsWeekend
                  ? 'Friday and Saturday are automatic non-attendance days.'
                  : selectedHoliday?.description || 'This date is marked as a vacation.'}
                {' '}Attendance is not counted for this date.
              </p>
            </div>
          </div>
          {isAdmin && selectedHoliday && !selectedDateIsWeekend && (
            <Button
              size="sm"
              variant="outline"
              className="shrink-0"
              onClick={() => deleteHoliday.mutate(selectedHoliday.id)}
              disabled={deleteHoliday.isPending}
            >
              <Trash2 className="mr-1.5 h-4 w-4" />
              Remove Vacation
            </Button>
          )}
        </div>
      )}

      {isNonSchoolDay ? (
        <EmptyState
          title={selectedDateIsWeekend ? 'Weekend — no attendance' : 'Vacation — no attendance'}
          description="This date is excluded from attendance totals and percentages."
        />
      ) : sessions.length === 0 ? (
        <EmptyState
          title="No daily attendance yet"
          description={isAdmin
            ? 'Click Sync Attendance to create and calculate attendance for this date.'
            : 'An administrator has not synchronized this date yet.'}
        />
      ) : (
        <div className="grid min-w-0 gap-3 sm:gap-5 lg:grid-cols-[260px_minmax(0,1fr)]">
          <Card className="min-w-0 h-fit">
            <CardHeader className="px-3 py-3 sm:px-6 sm:pb-3 sm:pt-6">
              <CardTitle className="text-base">Classes</CardTitle>
              <CardDescription className="hidden sm:block">{sessions.length} daily attendance sheet{sessions.length === 1 ? '' : 's'}</CardDescription>
            </CardHeader>
            <CardContent className="flex gap-2 overflow-x-auto px-3 pb-3 lg:block lg:space-y-2 lg:overflow-visible lg:px-6 lg:pb-6">
              {sessions.map(session => (
                <button
                  key={session.id}
                  type="button"
                  onClick={() => setActiveSessionId(session.id)}
                  className={`min-w-36 shrink-0 rounded-lg border px-3 py-2 text-left transition-colors sm:min-w-44 sm:p-3 lg:w-full lg:min-w-0 ${
                    activeSessionId === session.id
                      ? 'border-primary bg-primary/5'
                      : 'hover:bg-muted/50'
                  }`}
                >
                  <p className="truncate text-sm font-medium sm:text-base">{session.classes.name}</p>
                  <p className="truncate text-[11px] text-muted-foreground sm:mt-0.5 sm:text-xs">
                    Grade {session.classes.grade}-{session.classes.section}
                  </p>
                </button>
              ))}
            </CardContent>
          </Card>

          {activeSession && <DailyAttendanceSheet session={activeSession} />}
        </div>
      )}

      <Dialog open={vacationDialogOpen} onOpenChange={setVacationDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Vacation</DialogTitle>
            <DialogDescription>
              Mark {databaseDate(selectedDate)} as a non-attendance day. Any attendance
              already synchronized for this date will be removed.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="vacation-name">Vacation name</Label>
              <Input
                id="vacation-name"
                value={vacationName}
                onChange={event => setVacationName(event.target.value)}
                placeholder="e.g. Summer Vacation"
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="vacation-description">Description (optional)</Label>
              <Textarea
                id="vacation-description"
                value={vacationDescription}
                onChange={event => setVacationDescription(event.target.value)}
                placeholder="Reason or additional details"
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setVacationDialogOpen(false)}
              disabled={markVacation.isPending}
            >
              Cancel
            </Button>
            <Button
              onClick={() => markVacation.mutate(
                {
                  date: selectedDate,
                  name: vacationName.trim(),
                  description: vacationDescription.trim() || undefined,
                },
                {
                  onSuccess: () => {
                    setVacationDialogOpen(false)
                    setVacationName('')
                    setVacationDescription('')
                  },
                },
              )}
              disabled={!vacationName.trim() || markVacation.isPending}
            >
              <CalendarOff className="mr-1.5 h-4 w-4" />
              {markVacation.isPending ? 'Adding…' : 'Add Vacation'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function DailyAttendanceSheet({ session }: { session: AttendanceSessionWithDetails }) {
  const { data: records = [], isLoading, error } = useAttendanceRecords(session.id)
  const { data: students = [] } = useQuery({
    queryKey: ['students_by_class', session.class_id],
    queryFn: () => studentsService.getByClass(session.class_id),
  })

  const recordsByStudent = useMemo(
    () => new Map(records.map(record => [record.student_id, record])),
    [records],
  )
  const presentCount = records.filter(record => record.status === 'present').length
  const absentCount = students.filter(student =>
    (recordsByStudent.get(student.id)?.status ?? 'absent') === 'absent'
  ).length

  if (isLoading) return <LoadingState />
  if (error) return <ErrorState message={(error as Error).message} />

  return (
    <Card className="min-w-0 overflow-hidden">
      <CardHeader className="border-b px-3 py-3 sm:px-6 sm:py-6">
        <CardTitle className="text-lg sm:text-xl">{session.classes.name}</CardTitle>
        <CardDescription className="text-xs sm:text-sm">
          {databaseDate(session.date)} · Daily biometric attendance
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 p-2 sm:space-y-4 sm:p-5">
        <div className="grid grid-cols-3 gap-1.5 sm:gap-3">
          <Summary icon={Users} label="Students" value={students.length} />
          <Summary icon={CheckCircle} label="Present" value={presentCount} tone="present" />
          <Summary icon={UserX} label="Absent" value={absentCount} tone="absent" />
        </div>

        <div className="space-y-2 md:hidden">
          {students.map(student => {
            const record = recordsByStudent.get(student.id)
            const status = record?.status ?? 'absent'
            return (
              <article key={student.id} className="rounded-lg border bg-card p-2.5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">
                      {student.first_name} {student.last_name}
                    </p>
                    <p className="truncate font-mono text-[10px] text-muted-foreground">
                      {student.admission_number}
                      {student.roll_number !== null ? ` · Roll ${student.roll_number}` : ''}
                    </p>
                  </div>
                  <Badge className={`shrink-0 ${statusStyles[status]}`}>
                    {status.charAt(0).toUpperCase() + status.slice(1)}
                  </Badge>
                </div>
                <div className="mt-2 grid grid-cols-[1fr_1fr_auto] items-end gap-2 border-t pt-2">
                  <MobileAttendanceDetail
                    label="Arrival"
                    value={formatDatabaseWallClock(record?.check_in_at ?? null)}
                  />
                  <MobileAttendanceDetail
                    label="Departure"
                    value={formatDatabaseWallClock(record?.check_out_at ?? null)}
                  />
                  <Badge
                    variant={record?.biometric_verified ? 'default' : 'secondary'}
                    className="mb-0.5 whitespace-nowrap px-1.5 text-[10px]"
                  >
                    {record?.biometric_verified ? 'Biometric' : 'No punch'}
                  </Badge>
                </div>
              </article>
            )
          })}
        </div>

        <div className="hidden overflow-x-auto rounded-md border md:block">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Roll</TableHead>
                <TableHead>Student</TableHead>
                <TableHead>Admission No.</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Arrival</TableHead>
                <TableHead>Departure</TableHead>
                <TableHead>Verification</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {students.map(student => {
                const record = recordsByStudent.get(student.id)
                const status = record?.status ?? 'absent'
                return (
                  <TableRow key={student.id}>
                    <TableCell>{student.roll_number ?? '—'}</TableCell>
                    <TableCell className="font-medium">
                      {student.first_name} {student.last_name}
                    </TableCell>
                    <TableCell className="font-mono text-xs">{student.admission_number}</TableCell>
                    <TableCell>
                      <Badge className={statusStyles[status]}>
                        {status.charAt(0).toUpperCase() + status.slice(1)}
                      </Badge>
                    </TableCell>
                    <TableCell className="whitespace-nowrap font-mono text-xs">
                      {formatDatabaseWallClock(record?.check_in_at ?? null)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap font-mono text-xs">
                      {formatDatabaseWallClock(record?.check_out_at ?? null)}
                    </TableCell>
                    <TableCell>
                      <Badge variant={record?.biometric_verified ? 'default' : 'secondary'}>
                        {record?.biometric_verified ? 'Biometric' : 'No punch'}
                      </Badge>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  )
}

function StudentDailyAttendance() {
  const { user } = useAuth()
  const [month, setMonth] = useState(format(new Date(), 'yyyy-MM'))
  const monthStart = `${month}-01`
  const monthEnd = format(new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0), 'yyyy-MM-dd')

  const { data, isLoading, error } = useQuery({
    queryKey: ['student-daily-attendance', user?.id, month],
    queryFn: async () => {
      const { data: student, error: studentError } = await db
        .from('students')
        .select('id, first_name, last_name, admission_number')
        .eq('profile_id', user!.id)
        .maybeSingle()
      if (studentError) throw studentError
      if (!student) return { student: null, records: [] }

      const { data: records, error: recordsError } = await db
        .from('attendance_records')
        .select('id, status, biometric_verified, marked_at, check_in_at, check_out_at, attendance_sessions!inner(date)')
        .eq('student_id', student.id)
        .gte('attendance_sessions.date', monthStart)
        .lte('attendance_sessions.date', monthEnd)
        .order('date', { referencedTable: 'attendance_sessions', ascending: false })
      if (recordsError) throw recordsError
      return {
        student,
        records: (records ?? []) as StudentDailyAttendanceRecord[],
      }
    },
    enabled: Boolean(user),
  })

  if (isLoading) return <LoadingState />
  if (error) return <ErrorState message={(error as Error).message} />
  if (!data?.student) {
    return <EmptyState title="Student profile not linked" description="Contact your administrator." />
  }

  const sortedRecords = [...data.records].sort((a, b) => {
    const dateOrder = b.attendance_sessions.date.localeCompare(a.attendance_sessions.date)
    if (dateOrder !== 0) return dateOrder
    return b.marked_at.localeCompare(a.marked_at)
  })

  return (
    <div>
      <PageHeader
        title="My Attendance"
        description="Weekends and Holidays are excluded."
      />
      <DesktopSyncLastSync className="-mt-2 mb-3 sm:-mt-3 sm:mb-5" label="Attendance last updated" />
      <div className="mb-3 max-w-xs space-y-1.5 sm:mb-5 sm:space-y-2">
        <Label htmlFor="student-month">Month</Label>
        <Input
          id="student-month"
          type="month"
          value={month}
          onChange={event => setMonth(event.target.value)}
        />
      </div>

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Arrival</TableHead>
              <TableHead>Departure</TableHead>
              <TableHead>Verification</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sortedRecords.map(record => (
              <TableRow key={record.id}>
                <TableCell>{databaseDate(record.attendance_sessions.date)}</TableCell>
                <TableCell>
                  <Badge className={statusStyles[record.status]}>
                    {record.status.charAt(0).toUpperCase() + record.status.slice(1)}
                  </Badge>
                </TableCell>
                <TableCell className="font-mono text-xs">
                  {formatDatabaseWallClock(record.check_in_at)}
                </TableCell>
                <TableCell className="font-mono text-xs">
                  {formatDatabaseWallClock(record.check_out_at)}
                </TableCell>
                <TableCell>
                  {record.biometric_verified ? 'Biometric' : 'No punch'}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {data.records.length === 0 && (
          <EmptyState title="No attendance records" description="No daily attendance is available for this month." />
        )}
      </Card>
    </div>
  )
}

interface StudentDailyAttendanceRecord {
  id: string
  status: AttendanceStatus
  biometric_verified: boolean
  marked_at: string
  check_in_at: string | null
  check_out_at: string | null
  attendance_sessions: { date: string }
}

function Summary({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: React.ElementType
  label: string
  value: number
  tone?: 'present' | 'absent'
}) {
  const color = tone === 'present'
    ? 'text-emerald-600 bg-emerald-500/10'
    : tone === 'absent'
      ? 'text-red-600 bg-red-500/10'
      : 'text-primary bg-primary/10'
  return (
    <div className="flex min-w-0 items-center gap-1.5 rounded-lg border p-2 sm:gap-3 sm:p-3">
      <div className={`hidden rounded-lg p-2 sm:block ${color}`}><Icon className="h-4 w-4" /></div>
      <div className="min-w-0">
        <p className="truncate text-[10px] text-muted-foreground sm:text-xs">{label}</p>
        <p className="text-base font-semibold sm:text-xl">{value}</p>
      </div>
    </div>
  )
}

function MobileAttendanceDetail({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] text-muted-foreground">{label}</p>
      <p className="truncate font-mono text-[11px] font-medium">{value}</p>
    </div>
  )
}

function databaseDate(value: string) {
  const [year, month, day] = value.split('-').map(Number)
  return format(new Date(year, month - 1, day), 'EEEE, MMMM d, yyyy')
}

function isWeekend(value: string) {
  const [year, month, day] = value.split('-').map(Number)
  const dayOfWeek = new Date(year, month - 1, day).getDay()
  return dayOfWeek === 5 || dayOfWeek === 6
}
