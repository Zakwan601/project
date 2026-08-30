import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { format, subDays, startOfMonth, endOfMonth } from 'date-fns'
import { BarChart3, Download, Printer } from 'lucide-react'
import { supabase } from '@/lib/supabase'
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any

import { useClasses } from '@/hooks/useClasses'
import { PageHeader, LoadingState, ErrorState } from '@/components/shared/PageHeader'
import { DateFilter } from '@/components/shared/DateFilter'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid } from 'recharts'
import type { ChartConfig } from '@/components/ui/chart'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { formatDisplayDate } from '@/lib/dateTime'
import type { AttendanceStatus } from '@/types/database'

const chartConfig: ChartConfig = {
  present: { label: 'Present', color: 'var(--chart-2)' },
  absent: { label: 'Absent', color: 'var(--chart-5)' },
  late: { label: 'Late', color: 'var(--chart-4)' },
}

interface StudentReportRow {
  id: string
  name: string
  admission: string
  roll: number | null
  present: number
  absent: number
  late: number
  excused: number
  total: number
  percentage: number
}

function escapeCsvCell(value: string | number | null) {
  let text = value == null ? '' : String(value)
  // Prevent spreadsheet applications from interpreting user-controlled values as formulas.
  if (/^[=+\-@]/.test(text)) text = String.fromCharCode(39) + text
  return `"${text.replace(/"/g, '""')}"`
}

function chunkDates(dates: string[], size: number) {
  const chunks: string[][] = []
  for (let index = 0; index < dates.length; index += size) {
    chunks.push(dates.slice(index, index + size))
  }
  return chunks
}

function useClassAttendanceReport(classId: string, startDate: string, endDate: string) {
  return useQuery<StudentReportRow[]>({
    queryKey: ['attendance_report', classId, startDate, endDate],
    queryFn: async () => {
      if (!classId) return []

      const { data, error } = await db.rpc('get_class_attendance_report', {
        p_class_id: classId,
        p_start_date: startDate,
        p_end_date: endDate,
      })

      if (error) throw error
      return (data ?? []) as StudentReportRow[]
    },
    enabled: !!classId && !!startDate && !!endDate,
  })
}

interface DailyStudentAttendance {
  dates: string[]
  statuses: Record<string, AttendanceStatus>
}

interface AttendanceSessionDate {
  date: string
}

interface AttendanceRecordStatus {
  student_id: string
  status: AttendanceStatus
  attendance_sessions: { date: string } | Array<{ date: string }>
}

const dailyStatusMeta: Record<AttendanceStatus, { mark: string; label: string; className: string }> = {
  present: { mark: 'P', label: 'Present', className: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300' },
  absent: { mark: 'A', label: 'Absent', className: 'bg-red-500/15 text-red-700 dark:text-red-300' },
  late: { mark: 'L', label: 'Late', className: 'bg-amber-500/20 text-amber-700 dark:text-amber-300' },
  excused: { mark: 'E', label: 'Approved Leave', className: 'bg-blue-500/15 text-blue-700 dark:text-blue-300' },
}

function dailyStatusKey(studentId: string, date: string) {
  return studentId + ':' + date
}

function useDailyStudentAttendance(classId: string, startDate: string, endDate: string) {
  return useQuery<DailyStudentAttendance>({
    queryKey: ['daily_student_attendance_report', classId, startDate, endDate],
    queryFn: async () => {
      if (!classId) return { dates: [], statuses: {} }

      const { data: sessionData, error: sessionError } = await db
        .from('attendance_sessions')
        .select('date')
        .eq('class_id', classId)
        .gte('date', startDate)
        .lte('date', endDate)
        .order('date', { ascending: true })
      if (sessionError) throw sessionError

      const sessions = (sessionData ?? []) as AttendanceSessionDate[]
      const dates = [...new Set(sessions.map(session => session.date))]
      if (sessions.length === 0) return { dates, statuses: {} }

      const records: AttendanceRecordStatus[] = []
      const pageSize = 1000
      for (let from = 0; ; from += pageSize) {
        const { data: recordData, error: recordError } = await db
          .from('attendance_records')
          .select('student_id, status, attendance_sessions!inner(date)')
          .eq('attendance_sessions.class_id', classId)
          .gte('attendance_sessions.date', startDate)
          .lte('attendance_sessions.date', endDate)
          .order('id', { ascending: true })
          .range(from, from + pageSize - 1)
        if (recordError) throw recordError

        const page = (recordData ?? []) as AttendanceRecordStatus[]
        records.push(...page)
        if (page.length < pageSize) break
      }

      const statuses: Record<string, AttendanceStatus> = {}
      for (const record of records) {
        const relation = record.attendance_sessions
        const date = Array.isArray(relation) ? relation[0]?.date : relation.date
        if (date) statuses[dailyStatusKey(record.student_id, date)] = record.status
      }

      return { dates, statuses }
    },
    enabled: !!classId && !!startDate && !!endDate,
  })
}

interface DailyPoint { date: string; present: number; absent: number; late: number }

interface DailyAttendanceSummary {
  attendance_date: string
  present_count: number | string
  absent_count: number | string
  late_count: number | string
}

function useDailyReport(startDate: string, endDate: string) {
  return useQuery<DailyPoint[]>({
    queryKey: ['daily_report', startDate, endDate],
    queryFn: async () => {
      const days: string[] = []
      const d = new Date(startDate)
      const end = new Date(endDate)
      while (d <= end) {
        days.push(format(d, 'yyyy-MM-dd'))
        d.setDate(d.getDate() + 1)
      }

      const { data, error } = await db.rpc('get_daily_attendance_report', {
        p_start_date: startDate,
        p_end_date: endDate,
      })

      if (error) throw error

      const resultsByDate = new Map<string, DailyPoint>(days.map(date => [date, {
        date: formatDisplayDate(date),
        present: 0,
        absent: 0,
        late: 0,
      }]))

      for (const summary of (data ?? []) as DailyAttendanceSummary[]) {
        const result = resultsByDate.get(summary.attendance_date)
        if (!result) continue

        result.present = Number(summary.present_count)
        result.absent = Number(summary.absent_count)
        result.late = Number(summary.late_count)
      }

      return days.map(date => resultsByDate.get(date)!)
    },
  })
}

export function ReportsPage() {
  const { data: classes } = useClasses()
  const [selectedClass, setSelectedClass] = useState('')
  const [studentScope, setStudentScope] = useState<'all' | 'below'>('all')
  const [percentageThreshold, setPercentageThreshold] = useState('75')
  const [startDate, setStartDate] = useState(format(startOfMonth(new Date()), 'yyyy-MM-dd'))
  const [endDate, setEndDate] = useState(format(endOfMonth(new Date()), 'yyyy-MM-dd'))

  const { data: studentReport, isLoading: studentLoading, error: studentError } = useClassAttendanceReport(selectedClass, startDate, endDate)
  const {
    data: dailyStudentAttendance,
    isLoading: dailyStudentLoading,
    error: dailyStudentError,
  } = useDailyStudentAttendance(selectedClass, startDate, endDate)
  const selectedClassName = classes?.find(c => c.id === selectedClass)?.name ?? 'selected class'
  const parsedPercentageThreshold = Number(percentageThreshold)
  const percentageFilterValid = percentageThreshold.trim() !== ''
    && Number.isFinite(parsedPercentageThreshold)
    && parsedPercentageThreshold >= 0
    && parsedPercentageThreshold <= 100
  const reportRows = (studentReport ?? []).filter(row =>
    studentScope === 'all'
      || (percentageFilterValid && Number(row.percentage) < parsedPercentageThreshold)
  )
  const studentFilterDescription = studentScope === 'all'
    ? 'All students'
    : percentageFilterValid
      ? 'Attendance below ' + parsedPercentageThreshold + '%'
      : 'Invalid percentage filter'
  const { data: dailyData, isLoading: dailyLoading } = useDailyReport(
    format(subDays(new Date(), 14), 'yyyy-MM-dd'),
    format(new Date(), 'yyyy-MM-dd')
  )

  const exportStudentReport = () => {
    if (!reportRows.length || !dailyStudentAttendance) return

    const dailyHeaders = dailyStudentAttendance.dates.map(date => formatDisplayDate(date))
    const headers = [
      'SN',
      'Class',
      'Report From',
      'Report To',
      'Student Filter',
      'Roll',
      'Student Name',
      'Admission Number',
      ...dailyHeaders,
      'Present',
      'Absent',
      'Late',
      'Approved Leave',
      'Total Days',
      'Attendance %',
    ]
    const rows = reportRows.map((row, index) => [
      index + 1,
      selectedClassName,
      startDate,
      endDate,
      studentFilterDescription,
      row.roll,
      row.name,
      row.admission,
      ...dailyStudentAttendance.dates.map(date => {
        const status = dailyStudentAttendance.statuses[dailyStatusKey(row.id, date)]
        return status ? dailyStatusMeta[status].label : ''
      }),
      row.present,
      row.absent,
      row.late,
      row.excused,
      row.total,
      Number(row.percentage.toFixed(2)),
    ])
    const csv = [headers, ...rows]
      .map(row => row.map(escapeCsvCell).join(','))
      .join('\r\n')
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    const classSlug = selectedClassName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'class'
    link.href = url
    link.download = 'attendance-' + classSlug + '-' + startDate + '-to-' + endDate + '.csv'
    document.body.appendChild(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(url)
  }

  const printStudentReport = () => {
    if (!reportRows.length || !dailyStudentAttendance) return

    const pageStyle = document.createElement('style')
    pageStyle.id = 'student-report-page-style'
    pageStyle.textContent = '@page { size: A4 landscape; margin: 10mm; }'
    document.head.appendChild(pageStyle)
    const cleanup = () => {
      document.body.classList.remove('student-report-printing')
      pageStyle.remove()
    }
    document.body.classList.add('student-report-printing')
    window.addEventListener('afterprint', cleanup, { once: true })
    window.print()
  }

  return (
    <div className="student-report-screen space-y-3 sm:space-y-6">
      <PageHeader
        title="Reports"
        description="Attendance analytics and insights"
      />

      <Card>
        <CardHeader>
          <CardTitle>14-Day Attendance Trend</CardTitle>
          <CardDescription>Daily attendance breakdown over the last 2 weeks</CardDescription>
        </CardHeader>
        <CardContent>
          {dailyLoading ? (
            <LoadingState />
          ) : (
            <ChartContainer config={chartConfig} className="h-[190px] w-full aspect-auto sm:h-[280px]">
              <BarChart accessibilityLayer data={dailyData}>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="date" tickLine={false} axisLine={false} tickMargin={8} tick={{ fontSize: 11 }} />
                <YAxis tickLine={false} axisLine={false} />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Bar dataKey="present" fill="var(--color-present)" radius={[4, 4, 0, 0]} />
                <Bar dataKey="absent" fill="var(--color-absent)" radius={[4, 4, 0, 0]} />
                <Bar dataKey="late" fill="var(--color-late)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ChartContainer>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BarChart3 className="h-5 w-5" /> Student Attendance Report
          </CardTitle>
          <CardDescription>Individual student attendance summary by class and date range</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="mb-3 grid grid-cols-2 gap-2 sm:mb-4 sm:flex sm:flex-wrap sm:gap-4">
            <div className="col-span-2 min-w-0 space-y-1.5 sm:min-w-[200px]">
              <Label className="text-xs">Class</Label>
              <Select value={selectedClass} onValueChange={setSelectedClass}>
                <SelectTrigger>
                  <SelectValue placeholder="Select class" />
                </SelectTrigger>
                <SelectContent>
                  {classes?.map(c => (
                    <SelectItem key={c.id} value={c.id}>{c.name} ({c.grade}-{c.section})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="col-span-2 min-w-0 space-y-1.5 sm:col-span-1 sm:min-w-[190px]">
              <Label className="text-xs">Students</Label>
              <Select value={studentScope} onValueChange={value => setStudentScope(value as 'all' | 'below')}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All students</SelectItem>
                  <SelectItem value="below">Below attendance percentage</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {studentScope === 'below' && (
              <div className="col-span-1 min-w-0 space-y-1.5 sm:w-36">
                <Label className="text-xs" htmlFor="attendance-percentage-filter">Below percentage</Label>
                <div className="relative">
                  <Input
                    id="attendance-percentage-filter"
                    type="number"
                    min="0"
                    max="100"
                    step="1"
                    inputMode="decimal"
                    value={percentageThreshold}
                    onChange={event => setPercentageThreshold(event.target.value)}
                    aria-invalid={!percentageFilterValid}
                    className="pr-8"
                  />
                  <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-muted-foreground">%</span>
                </div>
                {!percentageFilterValid && <p className="text-xs text-destructive">Enter a value from 0 to 100.</p>}
              </div>
            )}
            <DateFilter
              mode="range"
              startDate={startDate}
              endDate={endDate}
              onChange={(start, end) => {
                setStartDate(start)
                setEndDate(end)
              }}
              className="col-span-2 sm:w-72"
            />
            <div className="col-span-2 flex items-end gap-2 sm:col-span-1">
              <Button
                type="button"
                variant="outline"
                onClick={exportStudentReport}
                disabled={!reportRows.length || studentLoading || dailyStudentLoading || !dailyStudentAttendance}
              >
                <Download /> Export CSV
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={printStudentReport}
                disabled={!reportRows.length || studentLoading || dailyStudentLoading || !dailyStudentAttendance}
              >
                <Printer /> Print Report
              </Button>
            </div>
          </div>

          {!selectedClass && (
            <div className="py-12 text-center text-muted-foreground text-sm">Select a class to view the report</div>
          )}

          {studentLoading && selectedClass && <LoadingState />}
          {studentError && <ErrorState message={(studentError as Error).message} />}
          {dailyStudentError && <ErrorState message={(dailyStudentError as Error).message} />}
          {reportRows.length > 0 && dailyStudentLoading && (
            <LoadingState message="Loading daily attendance..." />
          )}

          {reportRows.length > 0 && (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Roll</TableHead>
                    <TableHead>Student</TableHead>
                    <TableHead>Admission No.</TableHead>
                    <TableHead className="text-center">Present</TableHead>
                    <TableHead className="text-center">Absent</TableHead>
                    <TableHead className="text-center">Late</TableHead>
                    <TableHead className="text-center">Approved Leave</TableHead>
                    <TableHead className="text-center">Total Days</TableHead>
                    <TableHead className="text-center">%</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {reportRows.map(row => (
                    <TableRow key={row.id}>
                      <TableCell>{row.roll ?? '—'}</TableCell>
                      <TableCell className="font-medium">{row.name}</TableCell>
                      <TableCell className="font-mono text-sm">{row.admission}</TableCell>
                      <TableCell className="text-center text-emerald-600 dark:text-emerald-400">{row.present}</TableCell>
                      <TableCell className="text-center text-red-600 dark:text-red-400">{row.absent}</TableCell>
                      <TableCell className="text-center text-amber-600 dark:text-amber-400">{row.late}</TableCell>
                      <TableCell className="text-center text-blue-600 dark:text-blue-400">{row.excused}</TableCell>
                      <TableCell className="text-center">{row.total}</TableCell>
                      <TableCell className="text-center">
                        <Badge
                          variant={row.percentage >= 75 ? 'default' : 'destructive'}
                          className="text-xs"
                        >
                          {row.percentage}%
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          {reportRows.length > 0 && dailyStudentAttendance && (
            <div className="mt-6 space-y-3 border-t pt-5">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <h3 className="font-semibold">Daily Attendance</h3>
                  <p className="text-sm text-muted-foreground">
                    One status per student for each attendance day in the selected range.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2 text-xs">
                  {(Object.keys(dailyStatusMeta) as AttendanceStatus[]).map(status => (
                    <span key={status} className="flex items-center gap-1.5">
                      <span className={'inline-flex h-6 w-6 items-center justify-center rounded font-semibold ' + dailyStatusMeta[status].className}>
                        {dailyStatusMeta[status].mark}
                      </span>
                      <span className="text-muted-foreground">{dailyStatusMeta[status].label}</span>
                    </span>
                  ))}
                </div>
              </div>

              <div className="overflow-x-auto rounded-lg border">
                <Table className="min-w-max">
                  <TableHeader>
                    <TableRow>
                      <TableHead className="sticky left-0 z-20 w-12 min-w-12 bg-background text-center">SN</TableHead>
                      <TableHead className="sticky left-12 z-20 w-16 min-w-16 bg-background">Roll</TableHead>
                      <TableHead className="sticky left-28 z-20 min-w-48 bg-background">Student</TableHead>
                      {dailyStudentAttendance.dates.map(date => (
                        <TableHead key={date} className="min-w-20 px-2 text-center">
                          <span className="block font-semibold">{date.slice(8, 10)}</span>
                          <span className="block text-[10px] font-normal text-muted-foreground">
                            {date.slice(5, 7)}-{date.slice(2, 4)}
                          </span>
                        </TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {reportRows.map((row, index) => (
                      <TableRow key={row.id}>
                        <TableCell className="sticky left-0 z-10 bg-card text-center text-muted-foreground">
                          {index + 1}
                        </TableCell>
                        <TableCell className="sticky left-12 z-10 bg-card">{row.roll ?? '-'}</TableCell>
                        <TableCell className="sticky left-28 z-10 min-w-48 bg-card font-medium">
                          {row.name}
                        </TableCell>
                        {dailyStudentAttendance.dates.map(date => {
                          const status = dailyStudentAttendance.statuses[dailyStatusKey(row.id, date)]
                          const meta = status ? dailyStatusMeta[status] : null
                          return (
                            <TableCell key={date} className="px-2 text-center">
                              {meta ? (
                                <span
                                  title={meta.label}
                                  aria-label={formatDisplayDate(date) + ': ' + meta.label}
                                  className={'inline-flex h-7 w-7 items-center justify-center rounded font-semibold ' + meta.className}
                                >
                                  {meta.mark}
                                </span>
                              ) : (
                                <span className="text-muted-foreground" title="No attendance record">-</span>
                              )}
                            </TableCell>
                          )
                        })}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}
          {studentReport && studentReport.length === 0 && selectedClass && !studentLoading && (
            <div className="py-12 text-center text-muted-foreground text-sm">
              No attendance data for selected period
            </div>
          )}
          {studentReport && studentReport.length > 0 && reportRows.length === 0 && studentScope === 'below' && percentageFilterValid && !studentLoading && (
            <div className="py-12 text-center text-muted-foreground text-sm">
              No students have attendance below {parsedPercentageThreshold}% for the selected period.
            </div>
          )}
        </CardContent>
      </Card>

      {reportRows.length > 0 && dailyStudentAttendance && (
        <div className="student-report-print" aria-hidden="true">
          <header className="print-report-header">
            <div>
              <h1>Student Attendance Report</h1>
              <p>{selectedClassName}</p>
            </div>
            <dl>
              <dt>Reporting period</dt>
              <dd>{formatDisplayDate(startDate)} to {formatDisplayDate(endDate)}</dd>
              <dt>Students</dt>
              <dd>{reportRows.length}</dd>
              <dt>Student filter</dt>
              <dd>{studentFilterDescription}</dd>
              <dt>Generated</dt>
              <dd>{format(new Date(), 'dd MMM yyyy, hh:mm a')}</dd>
            </dl>
          </header>

          <section className="print-summary-section">
            <div className="print-section-heading">
              <h2>Attendance Summary</h2>
              <p>Consolidated attendance performance for the selected period</p>
            </div>
            <table className="print-summary-table">
              <thead>
                <tr>
                  <th>SN</th><th>Roll</th><th>Student</th><th>Admission No.</th>
                  <th>Present</th><th>Absent</th><th>Late</th><th>Leave</th>
                  <th>Total</th><th>Attendance</th>
                </tr>
              </thead>
              <tbody>
                {reportRows.map((row, index) => (
                  <tr key={row.id}>
                    <td>{index + 1}</td><td>{row.roll ?? '-'}</td><td>{row.name}</td><td>{row.admission}</td>
                    <td>{row.present}</td><td>{row.absent}</td><td>{row.late}</td><td>{row.excused}</td>
                    <td>{row.total}</td><td>{Number(row.percentage.toFixed(2))}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="print-footnote">Attendance percentage is based on recorded attendance days in the selected reporting period.</p>
          </section>

          {chunkDates(dailyStudentAttendance.dates, 12).map(dates => (
            <section className="print-daily-section" key={dates[0]}>
              <div className="print-section-heading print-daily-heading">
                <div>
                  <h2>Daily Attendance</h2>
                  <p>{formatDisplayDate(dates[0])} to {formatDisplayDate(dates[dates.length - 1])}</p>
                </div>
                <p className="print-legend">P Present | A Absent | L Late | E Approved Leave | - No Record</p>
              </div>
              <table className="print-daily-table">
                <thead>
                  <tr>
                    <th>SN</th><th>Roll</th><th>Student</th>
                    {dates.map(date => <th key={date}>{format(new Date(date + 'T00:00:00'), 'dd MMM')}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {reportRows.map((row, index) => (
                    <tr key={row.id}>
                      <td>{index + 1}</td><td>{row.roll ?? '-'}</td><td>{row.name}</td>
                      {dates.map(date => {
                        const status = dailyStudentAttendance.statuses[dailyStatusKey(row.id, date)]
                        return <td className={status ? 'status-' + status : 'status-none'} key={date}>{status ? dailyStatusMeta[status].mark : '-'}</td>
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          ))}
        </div>
      )}
    </div>
  )
}
