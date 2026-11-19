import { useRef, useState } from 'react'
import { Printer } from 'lucide-react'
import { format, parseISO } from 'date-fns'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { studentDashboardService, type StudentAttendanceBreakdown } from '@/services/studentDashboard'
import type { StudentResultPayload, StudentWithClass, SubjectCourseOption } from '@/types/database'
import { AttendanceFineCard } from '@/components/attendance/AttendanceFineCard'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Skeleton } from '@/components/ui/skeleton'
import { formatFine } from '@/lib/attendanceFine'
import { printReportCards } from '@/lib/printReportCard'

// Database types are maintained manually in this project.
const db = supabase as any

export function StudentInformation({ student, courseOptions }: { student: StudentWithClass; courseOptions: SubjectCourseOption[] }) {
  const subjectIds = [student.group_elective_option_id, student.group_fourth_option_id,
    student.humanities_main_option_1_id, student.humanities_main_option_2_id,
    student.humanities_main_option_3_id, student.humanities_fourth_option_id]
  const subjects = courseOptions.filter(option => subjectIds.includes(option.id))
  const sections = [
    { title: 'Student', values: [['Student ID', student.admission_number], ['Roll number', student.roll_number],
      ['Class', student.classes?.name], ['Status', student.is_active ? 'Active' : 'Inactive'],
      ['Student phone', student.student_phone], ['Guardian phone', student.guardian_phone],
      ['Biometric ID', student.biometric_id]] },
    { title: 'Personal information', values: [["Father's name", student.father_name], ["Mother's name", student.mother_name],
      ['Blood group', student.blood_group], ['Secondary phone', student.secondary_phone],
      ['Present address', student.present_address], ['Permanent address', student.permanent_address]] },
  ]
  return <div className="space-y-6">
    {sections.map(section => <section key={section.title}>
      <h3 className="mb-3 text-sm font-semibold">{section.title}</h3>
      <dl className="grid gap-x-8 gap-y-4 sm:grid-cols-2">{section.values.map(([label, value]) =>
        <div key={String(label)} className="min-w-0"><dt className="text-xs text-muted-foreground">{label}</dt>
          <dd className="mt-1 whitespace-pre-line break-words text-sm">{value === '' || value == null ? 'Not provided' : value}</dd></div>)}</dl>
    </section>)}
    <section className="border-t pt-4"><h3 className="text-sm font-semibold">Subject choices</h3>
      <p className="mt-2 text-sm text-muted-foreground">{subjects.map(option => option.name).join(', ') || 'No elective subjects chosen'}</p>
    </section>
  </div>
}

function DetailLoading() {
  return <div role="status" aria-label="Loading student details" className="space-y-5 py-2">
    <Skeleton className="h-6 w-40" /><Skeleton className="h-12 w-full" /><Skeleton className="h-12 w-full" />
  </div>
}

function DetailError({ retry }: { retry: () => void }) {
  return <div role="alert" className="py-6 text-sm"><p className="text-destructive">Unable to load these details.</p>
    <Button variant="link" className="mt-1 h-auto p-0" onClick={retry}>Try again</Button></div>
}

function AttendanceSummary({ data }: { data: StudentAttendanceBreakdown }) {
  const { stats } = data
  return <section>
    <h3 className="text-sm font-semibold">Attendance overview</h3>
    <p className="mt-1 text-xs text-muted-foreground">Absent includes too-late arrivals.</p>
    <dl className="my-5 grid grid-cols-3 gap-x-4 gap-y-5 sm:grid-cols-5">
      {[
        ['Attendance', `${stats.attendanceRate}%`, ''],
        ['Present', stats.presentCount, 'text-emerald-600 dark:text-emerald-400'],
        ['Absent', stats.absentCount, 'text-red-600 dark:text-red-400'],
        ['Late', stats.lateCount, 'text-amber-600 dark:text-amber-400'],
        ['Approved leave', stats.excusedCount, 'text-blue-600 dark:text-blue-400'],
      ].map(([label, value, color]) => <div key={label}><dt className="text-xs text-muted-foreground">{label}</dt>
        <dd className={`mt-1 text-xl font-semibold tabular-nums ${color}`}>{value}</dd></div>)}
    </dl>
  </section>
}

export function StudentAttendanceReport({ student }: { student: StudentWithClass }) {
  const studentId = student.id
  const reportRef = useRef<HTMLDivElement>(null)
  const query = useQuery({ queryKey: ['staff-student-attendance-report', studentId], staleTime: 60_000,
    queryFn: async ({ signal }) => {
      const [response, fines, exceptions] = await Promise.all([
        db.rpc('get_student_attendance_breakdown', { p_student_id: studentId }).abortSignal(signal),
        studentDashboardService.getFineBreakdown(studentId, signal),
        studentDashboardService.getAttendanceExceptions(studentId, signal),
      ])
      if (response.error) throw response.error
      return { attendance: response.data as StudentAttendanceBreakdown, fines, exceptions }
    } })
  if (query.isPending) return <DetailLoading />
  if (query.isError) return <DetailError retry={() => void query.refetch()} />
  const { attendance, fines, exceptions } = query.data
  const fine = fines.total
  const attendanceByMonth = new Map(attendance.months.map(row => [row.month, row]))
  const finesByMonth = new Map(fines.months.map(row => [row.month, row]))
  const months = [...new Set([...attendanceByMonth.keys(), ...finesByMonth.keys()])].sort().reverse()
  return <div>
    <div className="mb-4 flex justify-end"><Button variant="outline" size="sm" onClick={() => {
      if (reportRef.current) printReportCards([reportRef.current])
    }}><Printer className="mr-2 h-4 w-4" />Print guardian report</Button></div>
    <div ref={reportRef} className="student-guardian-report space-y-7">
      <header className="hidden border-b pb-4 print:block">
        <p className="text-center text-lg font-semibold">New Model Degree College</p>
        <h2 className="mt-1 text-center text-base font-semibold">Attendance &amp; Fine Report</h2>
        <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-2 text-xs">
          <div><dt className="text-muted-foreground">Student</dt><dd className="font-semibold">{student.first_name} {student.last_name}</dd></div>
          <div><dt className="text-muted-foreground">Student ID / Roll</dt><dd>{student.admission_number} / {student.roll_number ?? '-'}</dd></div>
          <div><dt className="text-muted-foreground">Class</dt><dd>{student.classes?.name ?? 'Not assigned'}</dd></div>
          <div><dt className="text-muted-foreground">Guardian phone</dt><dd>{student.guardian_phone || 'Not provided'}</dd></div>
        </dl>
        <p className="mt-3 text-xs text-muted-foreground">Prepared on {new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Dhaka', day: '2-digit', month: 'short', year: 'numeric' }).format(new Date())}</p>
      </header>
    <AttendanceSummary data={attendance} />
    <AttendanceFineCard absentCount={fine.recordedAbsences} lateCount={fine.lateDays}
    finePerAbsentDay={Number(fine.finePerAbsentDay)} examMissedCount={fine.examMissedCount}
    examMissedFineAmount={Number(fine.examMissedFineAmount)} periodLabel="All-time fine breakdown" />
    <section><h3 className="mb-3 text-sm font-semibold">Monthly attendance &amp; fines</h3>
      {!months.length ? <p className="text-sm text-muted-foreground">No monthly records available.</p>
        : <><Table><TableHeader><TableRow><TableHead>Month</TableHead>
          <TableHead className="text-right">Present</TableHead>
          <TableHead className="text-right">Absent</TableHead><TableHead className="text-right">Late</TableHead>
          <TableHead className="text-right">Leave</TableHead><TableHead className="text-right">Rate</TableHead>
          <TableHead className="text-right">Attendance fine</TableHead><TableHead className="text-right">Missed exams</TableHead>
          <TableHead className="text-right">Exam fine</TableHead><TableHead className="text-right">Total fine</TableHead>
        </TableRow></TableHeader><TableBody>{months.map(month => {
          const row = attendanceByMonth.get(month)
          const monthFine = finesByMonth.get(month)
          return <TableRow key={month}>
          <TableCell className="whitespace-nowrap font-medium">{format(parseISO(month), 'MMM yyyy')}</TableCell>
          <TableCell className="text-right tabular-nums">{row?.present ?? 0}</TableCell>
          <TableCell className="text-right tabular-nums">{row?.absent ?? 0}</TableCell>
          <TableCell className="text-right tabular-nums">{row?.late ?? 0}</TableCell>
          <TableCell className="text-right tabular-nums">{row?.excused ?? 0}</TableCell>
          <TableCell className="text-right tabular-nums">{row ? `${row.percentage}%` : '-'}</TableCell>
          <TableCell className="text-right tabular-nums" title={monthFine ? `${monthFine.recordedAbsences} fineable absent days + ${monthFine.latePenaltyAbsences} late penalty days` : undefined}>{formatFine(Number(monthFine?.attendanceFine ?? 0))}</TableCell>
          <TableCell className="text-right tabular-nums">{monthFine?.examMissedCount ?? 0}</TableCell>
          <TableCell className="text-right tabular-nums">{formatFine(Number(monthFine?.examMissedFine ?? 0))}</TableCell>
          <TableCell className="text-right font-semibold tabular-nums">{formatFine(Number(monthFine?.totalFine ?? 0))}</TableCell>
        </TableRow>})}</TableBody></Table>
          <p className="mt-3 text-xs text-muted-foreground">Late-day penalties are calculated per month, so monthly totals may differ from the all-time fine.</p>        </>}
    </section>
      <section>
        <h3 className="mb-3 text-sm font-semibold">Missed exam details</h3>
        {!exceptions.missedExams.length ? <p className="text-sm text-muted-foreground">No missed exams recorded.</p>
          : <><Table><TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Examination</TableHead><TableHead>Subject</TableHead></TableRow></TableHeader>
            <TableBody>{exceptions.missedExams.map(exam => <TableRow key={exam.id}>
              <TableCell className="whitespace-nowrap">{format(parseISO(exam.date), 'dd MMM yyyy')}</TableCell>
              <TableCell className="whitespace-normal font-medium">{exam.exam}</TableCell>
              <TableCell className="whitespace-normal">{exam.subject}</TableCell>
            </TableRow>)}</TableBody></Table>
                      </>}
      </section>
      <footer className="hidden justify-between gap-8 border-t pt-8 text-xs print:flex"><span>Office signature: __________________</span><span>Guardian signature: __________________</span></footer>
    </div>
  </div>
}

interface StudentExam { id: string; title: string | null; exam_date: string; status: string; classes: { name: string } }

export function StudentResultDetails({ student }: { student: StudentWithClass }) {
  const [selectedExamId, setSelectedExamId] = useState('')
  const exams = useQuery<StudentExam[]>({
    queryKey: ['staff-student-exams', student.id, student.class_id], staleTime: 60_000,
    queryFn: async ({ signal }) => {
      const { data: history, error: historyError } = await db.from('student_enrollments').select('class_id')
        .eq('student_id', student.id).abortSignal(signal)
      if (historyError) throw historyError
      const classIds = [...new Set([student.class_id, ...(history as { class_id: string }[]).map(row => row.class_id)].filter(Boolean))]
      if (!classIds.length) return []
      const { data, error } = await db.from('result_exams').select('id,title,exam_date,status,classes(name)')
        .in('class_id', classIds).order('exam_date', { ascending: false }).abortSignal(signal)
      if (error) throw error
      return data as StudentExam[]
    },
  })
  const examId = selectedExamId || exams.data?.[0]?.id
  const result = useQuery<StudentResultPayload>({
    queryKey: ['staff-student-result', student.id, examId], enabled: Boolean(examId), staleTime: 60_000,
    queryFn: async ({ signal }) => {
      const { data, error } = await db.rpc('get_student_result', { p_exam_id: examId, p_student_id: student.id }).abortSignal(signal)
      if (error) throw error
      return data as StudentResultPayload
    },
  })
  if (exams.isPending) return <DetailLoading />
  if (exams.isError) return <DetailError retry={() => void exams.refetch()} />
  if (!exams.data.length) return <p className="py-6 text-sm text-muted-foreground">No examinations available for this student.</p>
  const selectedExam = exams.data.find(exam => exam.id === examId)
  const payload = result.data
  const totalOnly = payload?.exam.marks_mode === 'total_only'
  const hasMarks = (subject: StudentResultPayload['subjects'][number]) => subject.is_absent || (
    (subject.creative_max === 0 || subject.creative_marks != null) &&
    (subject.written_max === 0 || subject.written_marks != null) &&
    (subject.practical_max === 0 || subject.practical_marks != null))
  const complete = Boolean(payload?.subjects.length && payload.subjects.every(hasMarks))
  return <section className="space-y-5">
    <div className="space-y-2"><Label htmlFor="student-details-exam">Examination</Label>
      <Select value={examId} onValueChange={setSelectedExamId}><SelectTrigger id="student-details-exam" className="w-full"><SelectValue /></SelectTrigger>
        <SelectContent>{exams.data.map(exam => <SelectItem key={exam.id} value={exam.id}>
          {exam.title || 'Examination'} - {exam.classes.name} - {exam.exam_date}
        </SelectItem>)}</SelectContent></Select>
      {selectedExam?.status !== 'published' && <p className="text-xs text-amber-600 dark:text-amber-400">Draft results - not yet published to students.</p>}
    </div>
    {result.isPending ? <DetailLoading /> : result.isError ? <DetailError retry={() => void result.refetch()} />
      : payload && <>
        {!complete && payload.subjects.length > 0 && <p className="text-xs text-muted-foreground">Marks are incomplete. Final totals and grades will appear once all marks are entered.</p>}
        <dl className="flex flex-wrap gap-x-8 gap-y-4 border-y py-4">
          {[['Total marks', complete ? `${payload.summary.total_obtained}/${payload.summary.total_max}` : 'Pending'],
            ...(!totalOnly ? [['GPA', complete ? payload.summary.gpa?.toFixed(2) ?? '-' : '-'], ['Grade', complete ? payload.summary.letter_grade ?? '-' : '-']] : []),
            ['Position', complete ? payload.summary.position ?? '-' : '-']].map(([label, value]) => <div key={label}>
            <dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-1 text-lg font-semibold tabular-nums">{value}</dd></div>)}
        </dl>
        {!payload.subjects.length ? <p className="text-sm text-muted-foreground">No subject marks available.</p>
          : <Table><TableHeader><TableRow><TableHead>Subject</TableHead><TableHead className="text-right">Marks</TableHead>
            {!totalOnly && <TableHead className="text-right">Grade</TableHead>}</TableRow></TableHeader>
            <TableBody>{payload.subjects.map(subject => <TableRow key={subject.id}>
              <TableCell className="whitespace-normal font-medium">{subject.name}</TableCell>
              <TableCell className="text-right tabular-nums">{subject.is_absent ? 'Absent' : hasMarks(subject) ? `${subject.obtained}/${subject.total_max}` : 'Pending'}</TableCell>
              {!totalOnly && <TableCell className="text-right">{hasMarks(subject) ? subject.letter_grade ?? '-' : '-'}</TableCell>}
            </TableRow>)}</TableBody></Table>}
      </>}
  </section>
}
