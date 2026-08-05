import { useEffect, useMemo, useState } from 'react'
import { CalendarCheck, CalendarDays, CalendarOff, CheckCircle, Pencil, RefreshCw, Trash2, UserX, Users } from 'lucide-react'
import { format } from 'date-fns'
import { useQuery } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import {
  useAttendanceRecords,
  useAttendanceSessions,
  useCorrectAttendance,
  useMarkAttendanceVacation,
  useSyncDailyAttendance,
} from '@/hooks/useAttendance'
import { useDeleteHoliday, useHolidays } from '@/hooks/useHolidays'
import { useClasses } from '@/hooks/useClasses'
import { useAuth } from '@/contexts/AuthContext'
import { studentsService } from '@/services/students'
import { supabase } from '@/lib/supabase'
import { formatDatabaseWallClock, formatDisplayDate } from '@/lib/dateTime'
import { PageHeader, LoadingState, ErrorState, EmptyState } from '@/components/shared/PageHeader'
import { DesktopSyncLastSync } from '@/components/shared/DesktopSyncLastSync'
import { DateFilter } from '@/components/shared/DateFilter'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { Calendar } from '@/components/ui/calendar'
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
import { attendanceStatusLabel } from '@/lib/attendance'

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
  const [searchParams, setSearchParams] = useSearchParams()
  const requestedStatus = searchParams.get('status')
  const initialStatus = isAttendanceStatus(requestedStatus) ? requestedStatus : 'all'
  const [selectedDate, setSelectedDate] = useState(searchParams.get('date') || format(new Date(), 'yyyy-MM-dd'))
  const [selectedClassId, setSelectedClassId] = useState(searchParams.get('class_id') || 'all')
  const [statusFilter, setStatusFilter] = useState<AttendanceStatus | 'all'>(initialStatus)
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

  const updateUrlFilter = (key: string, value: string) => {
    setSearchParams(current => {
      const next = new URLSearchParams(current)
      if (!value || value === 'all') next.delete(key)
      else next.set(key, value)
      return next
    }, { replace: true })
  }

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
        <CardContent className="grid grid-cols-2 gap-2 p-3 sm:gap-4 sm:p-4 lg:grid-cols-3">
          <DateFilter mode="date" value={selectedDate} onChange={value => {
            setSelectedDate(value)
            updateUrlFilter('date', value)
          }} />
          <div className="min-w-0 space-y-1.5 sm:space-y-2">
            <Label className="text-xs sm:text-sm">Class</Label>
            <Select value={selectedClassId} onValueChange={value => {
              setSelectedClassId(value)
              updateUrlFilter('class_id', value)
            }}>
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
          <div className="col-span-2 min-w-0 space-y-1.5 sm:space-y-2 lg:col-span-1">
            <Label className="text-xs sm:text-sm">Status</Label>
            <Select value={statusFilter} onValueChange={value => {
              const status = value as AttendanceStatus | 'all'
              setStatusFilter(status)
              updateUrlFilter('status', status)
            }}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="present">Present</SelectItem>
                <SelectItem value="absent">Absent</SelectItem>
                <SelectItem value="late">Late</SelectItem>
                <SelectItem value="excused">Approved leave</SelectItem>
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

          {activeSession && <DailyAttendanceSheet session={activeSession} isAdmin={isAdmin} statusFilter={statusFilter} />}
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

function DailyAttendanceSheet({
  session,
  isAdmin,
  statusFilter,
}: {
  session: AttendanceSessionWithDetails
  isAdmin: boolean
  statusFilter: AttendanceStatus | 'all'
}) {
  const { data: records = [], isLoading, error } = useAttendanceRecords(session.id)
  const { data: students = [] } = useQuery({
    queryKey: ['students_by_class', session.class_id],
    queryFn: async () => {
      const students = await studentsService.getByClassForPeriod(session.class_id, session.date)
      const today = format(new Date(), 'yyyy-MM-dd')
      return session.date >= today ? students.filter(student => student.is_active) : students
    },
  })
  const correctAttendance = useCorrectAttendance()
  const [selectedStudentIds, setSelectedStudentIds] = useState<Set<string>>(new Set())
  const [correctionTargets, setCorrectionTargets] = useState<CorrectionTarget[]>([])
  const [correctionStatus, setCorrectionStatus] = useState<AttendanceStatus>('present')
  const [correctionReason, setCorrectionReason] = useState('')
  const [correctionDialogOpen, setCorrectionDialogOpen] = useState(false)

  const recordsByStudent = useMemo(
    () => new Map(records.map(record => [record.student_id, record])),
    [records],
  )
  const presentCount = records.filter(record => record.status === 'present').length
  const absentCount = students.filter(student =>
    (recordsByStudent.get(student.id)?.status ?? 'absent') === 'absent'
  ).length
  const approvedLeaveCount = students.filter(student =>
    recordsByStudent.get(student.id)?.status === 'excused'
  ).length
  const filteredStudents = statusFilter === 'all'
    ? students
    : students.filter(student =>
      (recordsByStudent.get(student.id)?.status ?? 'absent') === statusFilter
    )

  useEffect(() => setSelectedStudentIds(new Set()), [session.id, statusFilter])

  const targetForStudent = (student: (typeof students)[number]): CorrectionTarget => ({
    studentId: student.id,
    name: `${student.first_name} ${student.last_name}`.trim(),
    currentStatus: recordsByStudent.get(student.id)?.status ?? 'absent',
  })

  const openCorrection = (targets: CorrectionTarget[], initialStatus?: AttendanceStatus) => {
    if (targets.length === 0) return
    setCorrectionTargets(targets)
    setCorrectionStatus(initialStatus ?? (targets.length === 1 ? targets[0].currentStatus : 'present'))
    setCorrectionReason('')
    setCorrectionDialogOpen(true)
  }

  const toggleStudent = (studentId: string, checked: boolean) => {
    setSelectedStudentIds(current => {
      const next = new Set(current)
      if (checked) next.add(studentId)
      else next.delete(studentId)
      return next
    })
  }

  const allSelected = filteredStudents.length > 0 && selectedStudentIds.size === filteredStudents.length
  const someSelected = selectedStudentIds.size > 0 && !allSelected

  if (isLoading) return <LoadingState />
  if (error) return <ErrorState message={(error as Error).message} />

  return (
    <>
    <Card className="min-w-0 overflow-hidden">
      <CardHeader className="border-b px-3 py-3 sm:px-6 sm:py-6">
        <CardTitle className="text-lg sm:text-xl">{session.classes.name}</CardTitle>
        <CardDescription className="text-xs sm:text-sm">
          {databaseDate(session.date)} · Daily biometric attendance
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 p-2 sm:space-y-4 sm:p-5">
        <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4 sm:gap-3">
          <Summary icon={Users} label="Students" value={students.length} />
          <Summary icon={CheckCircle} label="Present" value={presentCount} tone="present" />
          <Summary icon={UserX} label="Absent" value={absentCount} tone="absent" />
          <Summary icon={CalendarDays} label="Approved leave" value={approvedLeaveCount} />
        </div>

        {isAdmin && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-muted/20 px-3 py-2">
            <label className="flex cursor-pointer items-center gap-2 text-xs font-medium">
              <Checkbox
                checked={allSelected ? true : someSelected ? 'indeterminate' : false}
                onCheckedChange={checked => setSelectedStudentIds(
                  checked === true ? new Set(filteredStudents.map(student => student.id)) : new Set(),
                )}
              />
              {selectedStudentIds.size > 0 ? `${selectedStudentIds.size} selected` : 'Select all students'}
            </label>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={selectedStudentIds.size === 0}
                onClick={() => openCorrection(
                  filteredStudents.filter(student => selectedStudentIds.has(student.id)).map(targetForStudent),
                  'excused',
                )}
              >
                <CalendarCheck /> Approve leave
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={selectedStudentIds.size === 0}
                onClick={() => openCorrection(
                  filteredStudents.filter(student => selectedStudentIds.has(student.id)).map(targetForStudent),
                )}
              >
                <Pencil /> Correct selected
              </Button>
            </div>
          </div>
        )}

        {filteredStudents.length === 0 && (
          <div className="rounded-lg border border-dashed py-8 text-center text-sm text-muted-foreground">
            No students match the selected status.
          </div>
        )}

        <div className="space-y-2 md:hidden">
          {filteredStudents.map(student => {
            const record = recordsByStudent.get(student.id)
            const status = record?.status ?? 'absent'
            return (
              <article key={student.id} className="rounded-lg border bg-card p-2.5">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-start gap-2">
                    {isAdmin && (
                      <Checkbox
                        className="mt-0.5"
                        checked={selectedStudentIds.has(student.id)}
                        onCheckedChange={checked => toggleStudent(student.id, checked === true)}
                        aria-label={`Select ${student.first_name} ${student.last_name}`}
                      />
                    )}
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold">
                        {student.first_name} {student.last_name}
                      </p>
                      <p className="truncate font-mono text-[10px] text-muted-foreground">
                        {student.admission_number}
                        {student.roll_number !== null ? ` · Roll ${student.roll_number}` : ''}
                      </p>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Badge className={statusStyles[status]}>
                      {attendanceStatusLabel(status)}
                    </Badge>
                    {isAdmin && (
                      <Button
                        type="button"
                        size="icon-xs"
                        variant="ghost"
                        onClick={() => openCorrection([targetForStudent(student)])}
                        aria-label={`Correct attendance for ${student.first_name} ${student.last_name}`}
                      >
                        <Pencil />
                      </Button>
                    )}
                  </div>
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
                {record?.manually_corrected && (
                  <p className="mt-1.5 truncate text-[10px] text-blue-600 dark:text-blue-400" title={record.correction_reason ?? undefined}>
                    Corrected manually{record.correction_reason ? `: ${record.correction_reason}` : ''}
                  </p>
                )}
              </article>
            )
          })}
        </div>

        <div className="hidden overflow-x-auto rounded-md border md:block">
          <Table>
            <TableHeader>
              <TableRow>
                {isAdmin && <TableHead className="w-10"><span className="sr-only">Select</span></TableHead>}
                <TableHead>Roll</TableHead>
                <TableHead>Student</TableHead>
                <TableHead>Admission No.</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Arrival</TableHead>
                <TableHead>Departure</TableHead>
                <TableHead>Verification</TableHead>
                {isAdmin && <TableHead className="w-12 text-right">Edit</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredStudents.map(student => {
                const record = recordsByStudent.get(student.id)
                const status = record?.status ?? 'absent'
                return (
                  <TableRow key={student.id}>
                    {isAdmin && (
                      <TableCell>
                        <Checkbox
                          checked={selectedStudentIds.has(student.id)}
                          onCheckedChange={checked => toggleStudent(student.id, checked === true)}
                          aria-label={`Select ${student.first_name} ${student.last_name}`}
                        />
                      </TableCell>
                    )}
                    <TableCell>{student.roll_number ?? '—'}</TableCell>
                    <TableCell className="font-medium">
                      {student.first_name} {student.last_name}
                    </TableCell>
                    <TableCell className="font-mono text-xs">{student.admission_number}</TableCell>
                    <TableCell>
                      <Badge className={statusStyles[status]}>
                        {attendanceStatusLabel(status)}
                      </Badge>
                    </TableCell>
                    <TableCell className="whitespace-nowrap font-mono text-xs">
                      {formatDatabaseWallClock(record?.check_in_at ?? null)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap font-mono text-xs">
                      {formatDatabaseWallClock(record?.check_out_at ?? null)}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col items-start gap-1">
                        <Badge variant={record?.biometric_verified ? 'default' : 'secondary'}>
                          {record?.biometric_verified ? 'Biometric' : 'No punch'}
                        </Badge>
                        {record?.manually_corrected && (
                          <span className="text-[10px] text-blue-600 dark:text-blue-400" title={record.correction_reason ?? undefined}>Corrected</span>
                        )}
                      </div>
                    </TableCell>
                    {isAdmin && (
                      <TableCell className="text-right">
                        <Button
                          type="button"
                          size="icon-xs"
                          variant="ghost"
                          onClick={() => openCorrection([targetForStudent(student)])}
                          aria-label={`Correct attendance for ${student.first_name} ${student.last_name}`}
                        >
                          <Pencil />
                        </Button>
                      </TableCell>
                    )}
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
    <Dialog open={correctionDialogOpen} onOpenChange={setCorrectionDialogOpen}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{correctionTargets.length === 1 ? 'Correct Attendance' : 'Bulk Attendance Correction'}</DialogTitle>
          <DialogDescription>
            {correctionTargets.length === 1
              ? `Update attendance for ${correctionTargets[0]?.name}.`
              : `Apply one status to ${correctionTargets.length} selected students.`}
            {' '}This change will be recorded in the audit log.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Status</Label>
            <Select value={correctionStatus} onValueChange={value => setCorrectionStatus(value as AttendanceStatus)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="present">Present</SelectItem>
                <SelectItem value="absent">Absent</SelectItem>
                <SelectItem value="late">Late</SelectItem>
                <SelectItem value="excused">Approved leave</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="correction-reason">Reason</Label>
            <Textarea
              id="correction-reason"
              value={correctionReason}
              onChange={event => setCorrectionReason(event.target.value)}
              placeholder={correctionStatus === 'excused'
                ? 'Enter the approved leave reason'
                : 'Explain why this attendance is being corrected'}
              rows={3}
              minLength={5}
              maxLength={500}
              required
            />
            <p className="text-xs text-muted-foreground">Required, minimum 5 characters</p>
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setCorrectionDialogOpen(false)} disabled={correctAttendance.isPending}>
            Cancel
          </Button>
          <Button
            type="button"
            disabled={correctionReason.trim().length < 5 || correctAttendance.isPending}
            onClick={() => correctAttendance.mutate(
              {
                sessionId: session.id,
                corrections: correctionTargets.map(target => ({ student_id: target.studentId, status: correctionStatus })),
                reason: correctionReason.trim(),
              },
              {
                onSuccess: () => {
                  setCorrectionDialogOpen(false)
                  setSelectedStudentIds(new Set())
                },
              },
            )}
          >
            {correctAttendance.isPending ? 'Saving…' : `Correct ${correctionTargets.length === 1 ? 'attendance' : `${correctionTargets.length} records`}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
  )
}

interface CorrectionTarget {
  studentId: string
  name: string
  currentStatus: AttendanceStatus
}

function StudentDailyAttendance() {
  const { user } = useAuth()
  const [month, setMonth] = useState(format(new Date(), 'yyyy-MM'))
  const [selectedCalendarDate, setSelectedCalendarDate] = useState<string | null>(null)
  const monthStart = `${month}-01`
  const monthEnd = format(new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0), 'yyyy-MM-dd')
  const { data: calendarHolidays = [] } = useHolidays(monthStart, monthEnd)

  useEffect(() => setSelectedCalendarDate(null), [month])

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
  const recordsByDate = new Map(
    sortedRecords.map(record => [record.attendance_sessions.date, record]),
  )
  const holidaysByDate = new Map(calendarHolidays.map(holiday => [holiday.date, holiday]))
  const selectedRecord = selectedCalendarDate ? recordsByDate.get(selectedCalendarDate) ?? null : null
  const selectedHoliday = selectedCalendarDate ? holidaysByDate.get(selectedCalendarDate) ?? null : null
  const calendarMonth = databaseDateToDate(monthStart)
  const statusDates = (status: AttendanceStatus) => data.records
    .filter(record => record.status === status)
    .map(record => databaseDateToDate(record.attendance_sessions.date))

  return (
    <div>
      <PageHeader
        title="My Attendance"
        description="Weekends and Holidays are excluded."
      />
      <DesktopSyncLastSync className="-mt-2 mb-3 sm:-mt-3 sm:mb-5" label="Attendance last updated" />
      <DateFilter
        mode="month"
        value={month}
        onChange={setMonth}
        className="mb-3 max-w-xs sm:mb-5"
      />

      <div className="mb-3 grid min-w-0 gap-3 lg:grid-cols-[minmax(320px,420px)_minmax(0,1fr)] sm:mb-5">
        <Card className="min-w-0">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <CalendarDays className="h-4 w-4" /> Attendance Calendar
            </CardTitle>
            <CardDescription>Select a day to view its attendance details.</CardDescription>
          </CardHeader>
          <CardContent>
            <Calendar
              mode="single"
              month={calendarMonth}
              selected={selectedCalendarDate ? databaseDateToDate(selectedCalendarDate) : undefined}
              onSelect={date => setSelectedCalendarDate(date ? format(date, 'yyyy-MM-dd') : null)}
              onMonthChange={date => setMonth(format(date, 'yyyy-MM'))}
              showOutsideDays={false}
              modifiers={{
                present: statusDates('present'),
                absent: statusDates('absent'),
                late: statusDates('late'),
                excused: statusDates('excused'),
                vacation: calendarHolidays.map(holiday => databaseDateToDate(holiday.date)),
                weekend: { dayOfWeek: [5, 6] },
              }}
              modifiersClassNames={{
                present: '[&>button]:bg-emerald-500/15 [&>button]:text-emerald-800 dark:[&>button]:text-emerald-300',
                absent: '[&>button]:bg-red-500/15 [&>button]:text-red-800 dark:[&>button]:text-red-300',
                late: '[&>button]:bg-amber-500/20 [&>button]:text-amber-800 dark:[&>button]:text-amber-300',
                excused: '[&>button]:bg-blue-500/15 [&>button]:text-blue-800 dark:[&>button]:text-blue-300',
                vacation: '[&>button]:bg-violet-500/15 [&>button]:text-violet-800 dark:[&>button]:text-violet-300',
                weekend: '[&>button]:opacity-45',
              }}
              className="w-full p-0 [--cell-size:2.25rem] sm:[--cell-size:2.5rem]"
              classNames={{ root: 'w-full', month: 'w-full' }}
            />
            <AttendanceCalendarLegend />
          </CardContent>
        </Card>

        <Card className="min-w-0">
          <CardHeader>
            <CardTitle className="text-base">Day Details</CardTitle>
            <CardDescription>
              {selectedCalendarDate ? databaseDate(selectedCalendarDate) : 'Select a date from the calendar'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {!selectedCalendarDate ? (
              <p className="py-5 text-sm text-muted-foreground">Choose a colored day to see arrival and departure information.</p>
            ) : selectedHoliday ? (
              <div className="space-y-3">
                <Badge className="bg-violet-500/15 text-violet-800 dark:text-violet-300">Vacation</Badge>
                <div className="rounded-lg border border-violet-500/20 bg-violet-500/5 p-3">
                  <p className="font-semibold">{selectedHoliday.name}</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {selectedHoliday.description || 'This day is marked as a school vacation.'}
                  </p>
                </div>
                <p className="text-xs text-muted-foreground">Attendance is not required or counted on this date.</p>
              </div>
            ) : selectedRecord ? (
              <div className="space-y-3">
                <Badge className={statusStyles[selectedRecord.status]}>
                  {attendanceStatusLabel(selectedRecord.status)}
                </Badge>
                <div className="grid grid-cols-2 gap-2">
                  <CalendarDetail label="Arrival" value={formatDatabaseWallClock(selectedRecord.check_in_at)} />
                  <CalendarDetail label="Departure" value={formatDatabaseWallClock(selectedRecord.check_out_at)} />
                  <CalendarDetail label="Verification" value={selectedRecord.biometric_verified ? 'Biometric' : 'No punch'} />
                  <CalendarDetail label="Marked at" value={formatDatabaseWallClock(selectedRecord.marked_at)} />
                </div>
              </div>
            ) : (
              <p className="py-5 text-sm text-muted-foreground">
                No attendance record for this day. It may be a weekend, holiday, or not yet synchronized.
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="overflow-x-auto">
        <CardHeader>
          <CardTitle className="text-base">Daily Attendance History</CardTitle>
          <CardDescription>{sortedRecords.length} recorded day{sortedRecords.length === 1 ? '' : 's'} this month</CardDescription>
        </CardHeader>
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
                    {attendanceStatusLabel(record.status)}
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

function AttendanceCalendarLegend() {
  const items: Array<{ label: string; color: string }> = [
    { label: 'Present', color: 'bg-emerald-500' },
    { label: 'Absent', color: 'bg-red-500' },
    { label: 'Late', color: 'bg-amber-500' },
    { label: 'Approved leave', color: 'bg-blue-500' },
    { label: 'Vacation', color: 'bg-violet-500' },
  ]
  return (
    <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1.5 border-t pt-3">
      {items.map(item => (
        <span key={item.label} className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <span className={`h-2.5 w-2.5 rounded-sm ${item.color}`} />
          {item.label}
        </span>
      ))}
    </div>
  )
}

function CalendarDetail({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-muted/20 p-2.5">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 truncate font-mono text-xs font-medium">{value}</p>
    </div>
  )
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
  return formatDisplayDate(value)
}

function databaseDateToDate(value: string) {
  const [year, month, day = 1] = value.split('-').map(Number)
  return new Date(year, month - 1, day)
}

function isAttendanceStatus(value: string | null): value is AttendanceStatus {
  return value === 'present' || value === 'absent' || value === 'late' || value === 'excused'
}

function isWeekend(value: string) {
  const [year, month, day] = value.split('-').map(Number)
  const dayOfWeek = new Date(year, month - 1, day).getDay()
  return dayOfWeek === 5 || dayOfWeek === 6
}
