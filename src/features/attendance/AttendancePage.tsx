import { useEffect, useMemo, useState } from 'react'
import { CheckCircle, RefreshCw, UserX, Users } from 'lucide-react'
import { format } from 'date-fns'
import { useQuery } from '@tanstack/react-query'
import {
  useAttendanceRecords,
  useAttendanceSessions,
  useSyncDailyAttendance,
} from '@/hooks/useAttendance'
import { useClasses } from '@/hooks/useClasses'
import { useAuth } from '@/contexts/AuthContext'
import { studentsService } from '@/services/students'
import { supabase } from '@/lib/supabase'
import { PageHeader, LoadingState, ErrorState, EmptyState } from '@/components/shared/PageHeader'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
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

  const classFilter = selectedClassId === 'all' ? undefined : selectedClassId
  const { data: sessions = [], isLoading, error } = useAttendanceSessions(classFilter, selectedDate)
  const { data: classes = [] } = useClasses()
  const syncAttendance = useSyncDailyAttendance()

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
          <Button
            size="sm"
            onClick={() => syncAttendance.mutate(selectedDate)}
            disabled={syncAttendance.isPending}
          >
            <RefreshCw className={`mr-1.5 h-4 w-4 ${syncAttendance.isPending ? 'animate-spin' : ''}`} />
            {syncAttendance.isPending ? 'Syncing…' : 'Sync Attendance'}
          </Button>
        ) : undefined}
      />

      <Card className="mb-5">
        <CardContent className="grid gap-4 p-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="attendance-date">Date</Label>
            <Input
              id="attendance-date"
              type="date"
              value={selectedDate}
              onChange={event => setSelectedDate(event.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label>Class</Label>
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

      {sessions.length === 0 ? (
        <EmptyState
          title="No daily attendance yet"
          description={isAdmin
            ? 'Click Sync Attendance to create and calculate attendance for this date.'
            : 'An administrator has not synchronized this date yet.'}
        />
      ) : (
        <div className="grid gap-5 lg:grid-cols-[260px_1fr]">
          <Card className="h-fit">
            <CardHeader>
              <CardTitle className="text-base">Classes</CardTitle>
              <CardDescription>{sessions.length} daily attendance sheet{sessions.length === 1 ? '' : 's'}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {sessions.map(session => (
                <button
                  key={session.id}
                  type="button"
                  onClick={() => setActiveSessionId(session.id)}
                  className={`w-full rounded-lg border p-3 text-left transition-colors ${
                    activeSessionId === session.id
                      ? 'border-primary bg-primary/5'
                      : 'hover:bg-muted/50'
                  }`}
                >
                  <p className="font-medium">{session.classes.name}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Grade {session.classes.grade}-{session.classes.section}
                  </p>
                </button>
              ))}
            </CardContent>
          </Card>

          {activeSession && <DailyAttendanceSheet session={activeSession} />}
        </div>
      )}
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
    <Card>
      <CardHeader className="border-b">
        <CardTitle>{session.classes.name}</CardTitle>
        <CardDescription>
          {databaseDate(session.date)} · Daily biometric attendance
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 p-5">
        <div className="grid gap-3 sm:grid-cols-3">
          <Summary icon={Users} label="Students" value={students.length} />
          <Summary icon={CheckCircle} label="Present" value={presentCount} tone="present" />
          <Summary icon={UserX} label="Absent" value={absentCount} tone="absent" />
        </div>

        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Roll</TableHead>
                <TableHead>Student</TableHead>
                <TableHead>Admission No.</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>First punch</TableHead>
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
                      {record?.biometric_verified ? databaseTimestamp(record.marked_at) : '—'}
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
        .select('id, status, biometric_verified, marked_at, attendance_sessions!inner(date)')
        .eq('student_id', student.id)
        .gte('attendance_sessions.date', monthStart)
        .lte('attendance_sessions.date', monthEnd)
        .order('marked_at', { ascending: false })
      if (recordsError) throw recordsError
      return { student, records: records ?? [] }
    },
    enabled: Boolean(user),
  })

  if (isLoading) return <LoadingState />
  if (error) return <ErrorState message={(error as Error).message} />
  if (!data?.student) {
    return <EmptyState title="Student profile not linked" description="Contact your administrator." />
  }

  return (
    <div>
      <PageHeader
        title="My Attendance"
        description="One attendance result per school day"
      />
      <div className="mb-5 max-w-xs space-y-2">
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
              <TableHead>First punch</TableHead>
              <TableHead>Verification</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.records.map((record: {
              id: string
              status: AttendanceStatus
              biometric_verified: boolean
              marked_at: string
              attendance_sessions: { date: string }
            }) => (
              <TableRow key={record.id}>
                <TableCell>{databaseDate(record.attendance_sessions.date)}</TableCell>
                <TableCell>
                  <Badge className={statusStyles[record.status]}>
                    {record.status.charAt(0).toUpperCase() + record.status.slice(1)}
                  </Badge>
                </TableCell>
                <TableCell className="font-mono text-xs">
                  {record.biometric_verified ? databaseTimestamp(record.marked_at) : '—'}
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
    <div className="flex items-center gap-3 rounded-lg border p-3">
      <div className={`rounded-lg p-2 ${color}`}><Icon className="h-4 w-4" /></div>
      <div>
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-xl font-semibold">{value}</p>
      </div>
    </div>
  )
}

function databaseDate(value: string) {
  const [year, month, day] = value.split('-').map(Number)
  return format(new Date(year, month - 1, day), 'EEEE, MMMM d, yyyy')
}

function databaseTimestamp(value: string | null) {
  if (!value) return '—'
  const match = value.match(
    /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})(\.\d+)?(Z|[+-]\d{2}(?::?\d{2})?)$/,
  )
  if (!match) return value
  const [, date, time, fraction = '', rawOffset] = match
  const offset = rawOffset === 'Z' || rawOffset === '+00:00' || rawOffset === '+0000'
    ? '+00'
    : rawOffset
  return `${date} ${time}${fraction}${offset}`
}
