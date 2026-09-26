import { useEffect, useMemo, useState } from 'react'
import { CalendarCheck, CalendarDays, CalendarOff, CheckCircle, Loader2, MessageSquareWarning, Pencil, RefreshCw, Send, Trash2, UserX, Users } from 'lucide-react'
import { StudentSearchInput } from '@/components/shared/StudentSearchInput'
import { format } from 'date-fns'
import { motion } from 'framer-motion'
import { useQuery } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import {
  useAttendanceRecords,
  useAttendanceSessions,
  useCorrectAttendance,
  useSyncDailyAttendance,
} from '@/hooks/useAttendance'
import { useDeleteHoliday, useHolidays } from '@/hooks/useHolidays'
import { useAbsenceNotificationStatus, useSendAbsenceNotifications } from '@/hooks/useAbsenceNotifications'
import { useClasses } from '@/hooks/useClasses'
import { useStudentDashboardStats } from '@/hooks/useStudentDashboard'
import { useAuth } from '@/contexts/AuthContext'
import { studentsService } from '@/services/students'
import { supabase } from '@/lib/supabase'
import { formatBangladeshDateTime, formatDisplayDate } from '@/lib/dateTime'
import { PageHeader, LoadingState, ErrorState, EmptyState } from '@/components/shared/PageHeader'
import { DateFilter } from '@/components/shared/DateFilter'
import { Button } from '@/components/ui/button'
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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import type { AttendanceSessionWithDetails, AttendanceStatus } from '@/types/database'
import { attendanceStatusLabel } from '@/lib/attendance'
import { AttendanceFineCard } from '@/components/attendance/AttendanceFineCard'

// Handwritten database types do not include all nested relationship selections.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any

const statusStyles: Record<AttendanceStatus, string> = {
  present: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
  absent: 'bg-red-500/10 text-red-700 dark:text-red-400',
  late: 'bg-amber-500/10 text-amber-700 dark:text-amber-400',
  too_late: 'bg-rose-500/15 text-rose-700 dark:text-rose-300',
  excused: 'bg-blue-500/10 text-blue-700 dark:text-blue-400',
}

const studentIdCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

export function AttendancePage() {
  const { role } = useAuth()
  return role === 'student' ? <StudentDailyAttendance /> : <StaffDailyAttendance />
}

function StaffDailyAttendance() {
  const { can } = useAuth()
  const isAdmin = can('attendance', 'write')
  const [searchParams, setSearchParams] = useSearchParams()
  const requestedStatus = searchParams.get('status')
  const initialStatus = isAttendanceStatus(requestedStatus) ? requestedStatus : 'all'
  const [selectedDate, setSelectedDate] = useState(searchParams.get('date') || format(new Date(), 'yyyy-MM-dd'))
  const [selectedClassId, setSelectedClassId] = useState(searchParams.get('class_id') || 'all')
  const [statusFilter, setStatusFilter] = useState<AttendanceStatus | 'all'>(initialStatus)
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  const [absenceNotificationDialogOpen, setAbsenceNotificationDialogOpen] = useState(false)
  const [absenceSendElapsedSeconds, setAbsenceSendElapsedSeconds] = useState(0)
  const [now, setNow] = useState(() => new Date())

  const classFilter = selectedClassId === 'all' ? undefined : selectedClassId
  const { data: sessions = [], isLoading, error } = useAttendanceSessions(classFilter, selectedDate)
  const { data: classes = [] } = useClasses()
  const { data: holidays = [] } = useHolidays(selectedDate, selectedDate, classFilter)
  const syncAttendance = useSyncDailyAttendance()
  const deleteHoliday = useDeleteHoliday()
  const selectedHoliday = selectedClassId === 'all'
    ? holidays.find(holiday => holiday.class_ids == null) ?? null
    : holidays[0] ?? null
  const selectedDateIsWeekend = isWeekend(selectedDate)
  const isNonSchoolDay = selectedDateIsWeekend || Boolean(selectedHoliday)
  const afterNotificationTime = canManuallySendAbsenceNotifications(selectedDate, now)
  const absenceNotificationStatus = useAbsenceNotificationStatus(
    selectedDate,
    isAdmin && afterNotificationTime && !isNonSchoolDay && sessions.length > 0,
  )
  const sendAbsenceNotifications = useSendAbsenceNotifications()
  const absenceNotificationAvailable = afterNotificationTime
    && !absenceNotificationStatus.isLoading
    && !absenceNotificationStatus.isError
    && !absenceNotificationStatus.data?.hasSentMessage
    && !absenceNotificationStatus.data?.hasMessageInProgress

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30_000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    if (!sendAbsenceNotifications.isPending) {
      setAbsenceSendElapsedSeconds(0)
      return
    }

    const startedAt = Date.now()
    const timer = window.setInterval(() => {
      setAbsenceSendElapsedSeconds(Math.floor((Date.now() - startedAt) / 1000))
    }, 1_000)
    return () => window.clearInterval(timer)
  }, [sendAbsenceNotifications.isPending])

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
        description="One biometric result per student, per day"
        action={isAdmin ? (
          <div className="flex w-full gap-2 sm:w-auto sm:justify-end">
            {absenceNotificationAvailable && !isNonSchoolDay && (
              <Button
                size="sm"
                variant="outline"
                className="min-w-0 flex-1 sm:flex-none"
                onClick={() => {
                  sendAbsenceNotifications.reset()
                  setAbsenceNotificationDialogOpen(true)
                }}
                disabled={sendAbsenceNotifications.isPending || sessions.length === 0}
              >
                <MessageSquareWarning className="mr-1.5 h-4 w-4" />
                Send Absence SMS
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

      <section
        aria-label="Attendance filters"
        className="mb-3 grid grid-cols-3 items-start gap-3 sm:mb-4 sm:grid-cols-2 sm:gap-4 lg:grid-cols-[minmax(260px,1.35fr)_minmax(200px,1fr)_minmax(180px,1fr)]"
      >
          <DateFilter
            mode="date"
            value={selectedDate}
            onChange={value => {
              setSelectedDate(value)
              updateUrlFilter('date', value)
            }}
          />
          <div className="min-w-0 space-y-2">
            <Label className="text-xs">Class</Label>
            <Select value={selectedClassId} onValueChange={value => {
              setSelectedClassId(value)
              updateUrlFilter('class_id', value)
            }}>
              <SelectTrigger className="w-full"><SelectValue placeholder="All classes" /></SelectTrigger>
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
          <div className="min-w-0 space-y-2 sm:col-span-2 lg:col-span-1">
            <Label className="text-xs">Status</Label>
            <Select value={statusFilter} onValueChange={value => {
              const status = value as AttendanceStatus | 'all'
              setStatusFilter(status)
              updateUrlFilter('status', status)
            }}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="present">Present</SelectItem>
                <SelectItem value="absent">Absent</SelectItem>
                <SelectItem value="late">Late</SelectItem>
                <SelectItem value="too_late">Too Late</SelectItem>
                <SelectItem value="excused">Approved leave</SelectItem>
              </SelectContent>
            </Select>
          </div>
      </section>

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
        <div className=" min-w-0 gap-3 sm:gap-5 lg:grid-cols-[260px_minmax(0,1fr)] grid">
          <Card className="min-w-0 h-fit hidden md:block">
            <CardHeader className="px-3 py-3  ">
              <CardTitle className="text-base">Classes</CardTitle>
              <CardDescription className="hidden sm:block">{sessions.length} class{sessions.length === 1 ? '' : 'es'}</CardDescription>
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


      <AlertDialog
        open={absenceNotificationDialogOpen}
        onOpenChange={open => {
          if (!sendAbsenceNotifications.isPending) setAbsenceNotificationDialogOpen(open)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {sendAbsenceNotifications.isPending
                ? 'Sending absence notifications'
                : 'Send absence notifications?'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {sendAbsenceNotifications.isPending
                ? `Processing guardian SMS messages and the Discord report for ${formatDisplayDate(selectedDate)}.`
                : `No sent absence SMS was found for ${formatDisplayDate(selectedDate)}. The function will send the missing guardian messages and post the attendance result to Discord.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {sendAbsenceNotifications.isPending && (
            <div className="space-y-3 rounded-lg border bg-muted/30 p-4" aria-live="polite">
              <div className="flex items-center gap-3">
                <Loader2 className="h-5 w-5 shrink-0 animate-spin text-primary" />
                <div>
                  <p className="text-sm font-medium">Please keep this page open</p>
                  <p className="text-xs text-muted-foreground">
                    Running for {formatElapsedTime(absenceSendElapsedSeconds)}. Large batches may take a few minutes.
                  </p>
                </div>
              </div>
              <div
                className="h-2 overflow-hidden rounded-full bg-primary/15"
                role="progressbar"
                aria-label="Sending absence notifications"
                aria-valuetext="In progress"
              >
                <motion.div
                  className="h-full w-1/3 rounded-full bg-primary"
                  initial={{ x: '-100%' }}
                  animate={{ x: '300%' }}
                  transition={{ duration: 1.4, ease: 'easeInOut', repeat: Infinity }}
                />
              </div>
            </div>
          )}
          {sendAbsenceNotifications.isError && (
            <p className="rounded-md bg-destructive/10 p-3 text-sm text-destructive" role="alert">
              {sendAbsenceNotifications.error.message}
            </p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={sendAbsenceNotifications.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={event => {
                event.preventDefault()
                sendAbsenceNotifications.mutate(
                  { date: selectedDate },
                  { onSuccess: () => setAbsenceNotificationDialogOpen(false) },
                )
              }}
              disabled={sendAbsenceNotifications.isPending}
            >
              {sendAbsenceNotifications.isPending
                ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                : <Send className="mr-1.5 h-4 w-4" />}
              {sendAbsenceNotifications.isPending ? 'Sending…' : 'Send notifications'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function formatElapsedTime(seconds: number) {
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  return `${minutes}m ${seconds % 60}s`
}

function canManuallySendAbsenceNotifications(selectedDate: string, now: Date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Dhaka',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now)
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find(part => part.type === type)?.value ?? ''
  const today = `${value('year')}-${value('month')}-${value('day')}`
  const hour = Number(value('hour'))
  return selectedDate < today || (selectedDate === today && hour >= 18)
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
    queryKey: ['students_by_class', session.class_id, session.date],
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
  const [studentSearch, setStudentSearch] = useState('')

  const recordsByStudent = useMemo(
    () => new Map(records.map(record => [record.student_id, record])),
    [records],
  )
  const presentCount = records.filter(record => record.status === 'present').length
  const absentCount = students.filter(student =>
    ['absent', 'too_late'].includes(recordsByStudent.get(student.id)?.status ?? 'absent')
  ).length
  const approvedLeaveCount = students.filter(student =>
    recordsByStudent.get(student.id)?.status === 'excused'
  ).length
  const filteredStudents = useMemo(() => {
    const query = studentSearch.trim().toLocaleLowerCase()

    return students
      .filter(student => statusFilter === 'all'
        || (recordsByStudent.get(student.id)?.status ?? 'absent') === statusFilter)
      .filter(student => !query || [
        student.admission_number,
        student.roll_number?.toString(),
        student.first_name,
        student.last_name,
        `${student.first_name} ${student.last_name}`,
      ].some(value => value?.toLocaleLowerCase().includes(query)))
      .sort((left, right) => studentIdCollator.compare(left.admission_number, right.admission_number))
  }, [studentSearch, recordsByStudent, statusFilter, students])

  useEffect(() => setSelectedStudentIds(new Set()), [session.id, statusFilter, studentSearch])

  useEffect(() => {
    setStudentSearch('')
  }, [session.id])

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
    <Card className="min-w-0 gap-0 overflow-hidden py-0">
      <CardHeader className=" ">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <CardTitle className="text-base sm:text-lg pt-4">{session.classes.name} <br/><span className="text-xs sm:text-sm">Date: {databaseDate(session.date)}</span> </CardTitle>
        </div>
      </CardHeader>
      <CardContent className="space-y-2 p-2 sm:p-3">
        <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-4 sm:gap-2 py-2 md:py-0 md:pb-2">
          <Summary icon={Users} label="Students" value={students.length} />
          <Summary icon={CheckCircle} label="Present" value={presentCount} tone="present" />
          <Summary icon={UserX} label="Absent" value={absentCount} tone="absent" />
          <Summary icon={CalendarDays} label="Approved leave" value={approvedLeaveCount} />
        </div>

        <div className="flex flex-col gap-2 xl:flex-row xl:items-center">
        <StudentSearchInput value={studentSearch} onChange={setStudentSearch}
          placeholder="Search by student ID, roll number, or name" className="flex-1" />

        {isAdmin && (
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            
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
        </div>

        {filteredStudents.length === 0 && (
          <div className="rounded-lg border border-dashed py-8 text-center text-sm text-muted-foreground">
            {studentSearch.trim()
              ? 'No students match your search.'
              : 'No students match the selected status.'}
          </div>
        )}

<div className="overflow-x-auto rounded-md border">
  <Table>
    <TableHeader>
      <TableRow>
        {isAdmin && (
          <TableHead className="w-8 px-2 sm:w-10 sm:px-3">
            <Checkbox
              checked={allSelected ? true : someSelected ? 'indeterminate' : false}
              onCheckedChange={(checked) =>
                setSelectedStudentIds(
                  checked === true
                    ? new Set(filteredStudents.map((student) => student.id))
                    : new Set()
                )
              }
            />
          </TableHead>
        )}

        <TableHead className="px-2 text-xs sm:px-3 sm:text-sm">Roll</TableHead>
        <TableHead className="px-2 text-xs sm:px-3 sm:text-sm">Student</TableHead>
        <TableHead className="px-2 text-xs sm:px-3 sm:text-sm">Status</TableHead>
        <TableHead className="px-2 text-xs sm:px-3 sm:text-sm">Arrival</TableHead>
        <TableHead className="px-2 text-xs sm:px-3 sm:text-sm">Departure</TableHead>
        <TableHead className="px-2 text-xs sm:px-3 sm:text-sm">Verification</TableHead>

        {isAdmin && (
          <TableHead className="w-8 px-2 text-right sm:w-12 sm:px-3">
            <span className="sr-only">Edit</span>
          </TableHead>
        )}
      </TableRow>
    </TableHeader>

    <TableBody>
      {filteredStudents.map(student => {
        const record = recordsByStudent.get(student.id)
        const status = record?.status ?? 'absent'

        return (
          <TableRow key={student.id}>
            {isAdmin && (
              <TableCell className="px-2 py-1.5 sm:px-3 sm:py-2">
                <Checkbox
                  checked={selectedStudentIds.has(student.id)}
                  onCheckedChange={checked =>
                    toggleStudent(student.id, checked === true)
                  }
                  aria-label={`Select ${student.first_name} ${student.last_name}`}
                />
              </TableCell>
            )}

            <TableCell className="px-2 py-1.5 text-xs sm:px-3 sm:py-2 sm:text-sm">
              {student.roll_number ?? '—'}
            </TableCell>

            <TableCell className="max-w-[120px] px-2 py-1.5 font-medium text-xs sm:max-w-none sm:px-3 sm:py-2 sm:text-sm">
              <span className="block truncate">
                {student.first_name} {student.last_name}
              </span>
            </TableCell>

            <TableCell className="px-2 py-1.5 sm:px-3 sm:py-2">
              <Badge className={`${statusStyles[status]} text-[10px] px-1.5 py-0.5 sm:text-xs sm:px-2`}>
                {attendanceStatusLabel(status)}
              </Badge>
            </TableCell>

            <TableCell className="whitespace-nowrap px-2 py-1.5 font-mono text-[10px] sm:px-3 sm:py-2 sm:text-xs">
              {formatBangladeshDateTime(record?.check_in_at ?? null)}
            </TableCell>

            <TableCell className="whitespace-nowrap px-2 py-1.5 font-mono text-[10px] sm:px-3 sm:py-2 sm:text-xs">
              {formatBangladeshDateTime(record?.check_out_at ?? null)}
            </TableCell>

            <TableCell className="px-2 py-1.5 sm:px-3 sm:py-2">
              <div className="flex flex-col items-start gap-0.5">
                <Badge
                  variant={record?.biometric_verified ? 'default' : 'secondary'}
                  className="px-1.5 py-0.5 text-[10px] sm:px-2 sm:text-xs"
                >
                  {record?.biometric_verified ? 'Biometric' : 'No punch'}
                </Badge>

                {record?.manually_corrected && (
                  <span
                    className="text-[9px] text-blue-600 dark:text-blue-400 sm:text-[10px]"
                    title={record.correction_reason ?? undefined}
                  >
                    Corrected
                  </span>
                )}
              </div>
            </TableCell>

            {isAdmin && (
              <TableCell className="px-1 py-1.5 text-right sm:px-3 sm:py-2">
                <Button
                  type="button"
                  size="icon-xs"
                  variant="ghost"
                  onClick={() =>
                    openCorrection([targetForStudent(student)])
                  }
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
                <SelectItem value="too_late">Too Late</SelectItem>
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
  const { student } = useAuth()
  const {
    data: fineStats,
    isLoading: fineStatsLoading,
    error: fineStatsError,
  } = useStudentDashboardStats(student?.id)
  const [month, setMonth] = useState(format(new Date(), 'yyyy-MM'))
  const [selectedCalendarDate, setSelectedCalendarDate] = useState<string | null>(null)
  const monthStart = `${month}-01`
  const monthEnd = format(new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0), 'yyyy-MM-dd')
  const { data: calendarHolidays = [] } = useHolidays(
    monthStart,
    monthEnd,
    student?.class_id ?? undefined,
  )

  useEffect(() => setSelectedCalendarDate(null), [month])

  const { data: records = [], isLoading, error } = useQuery({
    queryKey: ['student-daily-attendance', student?.id, month],
    queryFn: async () => {
      const { data: attendanceRecords, error: recordsError } = await db
        .from('attendance_records')
        .select('id, status, biometric_verified, marked_at, check_in_at, check_out_at, attendance_sessions!inner(date)')
        .eq('student_id', student!.id)
        .gte('attendance_sessions.date', monthStart)
        .lte('attendance_sessions.date', monthEnd)
        .order('date', { referencedTable: 'attendance_sessions', ascending: false })
      if (recordsError) throw recordsError
      return (attendanceRecords ?? []) as StudentDailyAttendanceRecord[]
    },
    enabled: Boolean(student?.id),
  })

  if (isLoading) return <LoadingState />
  if (error) return <ErrorState message={(error as Error).message} />
  if (!student) {
    return <EmptyState title="Student profile not linked" description="Contact your administrator." />
  }

  const sortedRecords = [...records].sort((a, b) => {
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
  const statusDates = (status: AttendanceStatus) => records
    .filter(record => record.status === status)
    .map(record => databaseDateToDate(record.attendance_sessions.date))
  const monthlyAbsentCount = records.filter(record => record.status === 'absent' || record.status === 'too_late').length
  const monthlyLateCount = records.filter(record => record.status === 'late').length

  return (
    <div>
      <PageHeader
        title="My Attendance"
        description="Weekends and Holidays are excluded."
      />
      <DateFilter
        mode="month"
        value={month}
        onChange={setMonth}
        className="mb-3 max-w-xs sm:mb-5"
      />

      <div className="mb-3 sm:mb-5">
        <AttendanceFineCard
          absentCount={monthlyAbsentCount}
          lateCount={monthlyLateCount}
          finePerAbsentDay={Number(fineStats?.finePerAbsentDay ?? 0)}
          periodLabel={`${format(calendarMonth, 'MMMM yyyy')} fine breakdown`}
          loading={fineStatsLoading}
          error={Boolean(fineStatsError)}
        />
      </div>

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
                too_late: statusDates('too_late'),
                excused: statusDates('excused'),
                vacation: calendarHolidays.map(holiday => databaseDateToDate(holiday.date)),
                weekend: { dayOfWeek: [5, 6] },
              }}
              modifiersClassNames={{
                present: '[&>button]:bg-emerald-500/15 [&>button]:text-emerald-800 dark:[&>button]:text-emerald-300',
                absent: '[&>button]:bg-red-500/15 [&>button]:text-red-800 dark:[&>button]:text-red-300',
                late: '[&>button]:bg-amber-500/20 [&>button]:text-amber-800 dark:[&>button]:text-amber-300',
                too_late: '[&>button]:bg-rose-500/20 [&>button]:text-rose-800 dark:[&>button]:text-rose-300',
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
              <p className="py-5 text-sm text-muted-foreground md:px-3">Choose a colored day to see arrival and departure information.</p>
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
                  <CalendarDetail label="Arrival" value={formatBangladeshDateTime(selectedRecord.check_in_at)} />
                  <CalendarDetail label="Departure" value={formatBangladeshDateTime(selectedRecord.check_out_at)} />
                  <CalendarDetail label="Verification" value={selectedRecord.biometric_verified ? 'Biometric' : 'No punch'} />
                  <CalendarDetail label="Marked at" value={formatBangladeshDateTime(selectedRecord.marked_at)} />
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
                  {formatBangladeshDateTime(record.check_in_at)}
                </TableCell>
                <TableCell className="font-mono text-xs">
                  {formatBangladeshDateTime(record.check_out_at)}
                </TableCell>
                <TableCell>
                  {record.biometric_verified ? 'Biometric' : 'No punch'}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {records.length === 0 && (
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
    { label: 'Too Late', color: 'bg-rose-500' },
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
    <div className="flex min-w-0 items-center gap-2 rounded-md bg-muted/35 px-2 py-1.5 sm:px-2.5">
      <div className={`hidden rounded-md p-1.5 sm:block ${color}`}><Icon className="h-3.5 w-3.5" /></div>
      <div className="min-w-0">
        <p className="truncate text-[10px] leading-tight text-muted-foreground sm:text-xs">{label}</p>
        <p className="text-sm font-semibold leading-tight sm:text-base">{value}</p>
      </div>
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
  return value === 'present' || value === 'absent' || value === 'late' || value === 'too_late' || value === 'excused'
}

function isWeekend(value: string) {
  const [year, month, day] = value.split('-').map(Number)
  const dayOfWeek = new Date(year, month - 1, day).getDay()
  return dayOfWeek === 5 || dayOfWeek === 6
}
