import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { format, subDays, startOfMonth, endOfMonth } from 'date-fns'
import { BarChart3, Download } from 'lucide-react'
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
import type { AttendanceStatus } from '@/types/database'
import { formatDisplayDate } from '@/lib/dateTime'

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
  const text = value == null ? '' : String(value)
  return `"${text.replace(/"/g, '""')}"`
}

function useClassAttendanceReport(classId: string, startDate: string, endDate: string) {
  return useQuery<StudentReportRow[]>({
    queryKey: ['attendance_report', classId, startDate, endDate],
    queryFn: async () => {
      if (!classId) return []

      const { data: sessions, error: sErr } = await db
        .from('attendance_sessions')
        .select('id, date')
        .eq('class_id', classId)
        .gte('date', startDate)
        .lte('date', endDate)
        .order('date')

      if (sErr) throw sErr
      if (!sessions?.length) return []

      const sessionIds = (sessions as Array<{ id: string }>).map(s => s.id)

      const { data: records, error: rErr } = await db
        .from('attendance_records')
        .select('student_id, status')
        .in('session_id', sessionIds)

      if (rErr) throw rErr

      const { data: studentsData, error: stErr } = await db
        .from('students')
        .select('id, first_name, last_name, admission_number, roll_number')
        .eq('class_id', classId)

      if (stErr) throw stErr

      const studentMap = new Map<string, StudentReportRow>()

      const students = (studentsData ?? []) as Array<{ id: string; first_name: string; last_name: string; admission_number: string; roll_number: number | null }>
      students.forEach(s => {
        studentMap.set(s.id, {
          id: s.id,
          name: `${s.first_name} ${s.last_name}`,
          admission: s.admission_number,
          roll: s.roll_number,
          present: 0,
          absent: 0,
          late: 0,
          excused: 0,
          total: 0,
          percentage: 0,
        })
      })

      const recs = (records ?? []) as Array<{ student_id: string; status: string }>
      recs.forEach(r => {
        const entry = studentMap.get(r.student_id)
        if (!entry) return
        const status = r.status as AttendanceStatus
        entry[status]++
        entry.total++
      })

      return Array.from(studentMap.values()).map(row => ({
        ...row,
        percentage: row.total > 0 ? Math.round(((row.present + row.late) / row.total) * 100) : 0,
      })).sort((a, b) => (a.roll ?? 999) - (b.roll ?? 999))
    },
    enabled: !!classId && !!startDate && !!endDate,
  })
}

interface DailyPoint { date: string; present: number; absent: number; late: number }

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

      const results: DailyPoint[] = []
      for (const date of days) {
        const { data: sessions } = await db
          .from('attendance_sessions')
          .select('id')
          .eq('date', date)

        const sessionIds = ((sessions ?? []) as Array<{ id: string }>).map(s => s.id)
        if (!sessionIds.length) {
          results.push({ date: formatDisplayDate(date), present: 0, absent: 0, late: 0 })
          continue
        }

        const { data: rec } = await db
          .from('attendance_records')
          .select('status')
          .in('session_id', sessionIds)

        results.push({
          date: formatDisplayDate(date),
          present: ((rec ?? []) as Array<{ status: string }>).filter(r => r.status === 'present').length,
          absent: ((rec ?? []) as Array<{ status: string }>).filter(r => r.status === 'absent').length,
          late: ((rec ?? []) as Array<{ status: string }>).filter(r => r.status === 'late').length,
        })
      }
      return results
    },
  })
}

export function ReportsPage() {
  const { data: classes } = useClasses()
  const [selectedClass, setSelectedClass] = useState('')
  const [startDate, setStartDate] = useState(format(startOfMonth(new Date()), 'yyyy-MM-dd'))
  const [endDate, setEndDate] = useState(format(endOfMonth(new Date()), 'yyyy-MM-dd'))

  const { data: studentReport, isLoading: studentLoading, error: studentError } = useClassAttendanceReport(selectedClass, startDate, endDate)
  const selectedClassName = classes?.find(c => c.id === selectedClass)?.name ?? 'selected class'
  const { data: dailyData, isLoading: dailyLoading } = useDailyReport(
    format(subDays(new Date(), 14), 'yyyy-MM-dd'),
    format(new Date(), 'yyyy-MM-dd')
  )

  const exportStudentReport = () => {
    if (!studentReport?.length) return

    const headers = ['Roll', 'Student', 'Admission No.', 'Present', 'Absent', 'Late', 'Approved Leave', 'Total Days', 'Attendance %']
    const rows = studentReport.map(row => [
      row.roll,
      row.name,
      row.admission,
      row.present,
      row.absent,
      row.late,
      row.excused,
      row.total,
      row.percentage,
    ])
    const csv = [headers, ...rows]
      .map(row => row.map(escapeCsvCell).join(','))
      .join('\r\n')
    const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    const classSlug = selectedClassName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'class'
    link.href = url
    link.download = `attendance-${classSlug}-${startDate}-to-${endDate}.csv`
    link.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="space-y-3 sm:space-y-6">
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
            <div className="flex items-end">
              <Button
                type="button"
                variant="outline"
                onClick={exportStudentReport}
                disabled={!studentReport?.length || studentLoading}
              >
                <Download /> Export CSV
              </Button>
            </div>
          </div>

          {!selectedClass && (
            <div className="py-12 text-center text-muted-foreground text-sm">Select a class to view the report</div>
          )}

          {studentLoading && selectedClass && <LoadingState />}
          {studentError && <ErrorState message={(studentError as Error).message} />}

          {studentReport && studentReport.length > 0 && (
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
                  {studentReport.map(row => (
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

          {studentReport && studentReport.length === 0 && selectedClass && !studentLoading && (
            <div className="py-12 text-center text-muted-foreground text-sm">
              No attendance data for selected period
            </div>
          )}
        </CardContent>
      </Card>

    </div>
  )
}
