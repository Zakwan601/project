import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import type { StudentResultPayload } from '@/types/database'

const showMark = (value: number | null, maximum: number, absent: boolean) => {
  if (maximum <= 0) return '—'
  if (absent) return 'Absent'
  return value ?? '—'
}

export function ResultSheet({ result, publicView = false }: { result: StudentResultPayload; publicView?: boolean }) {
  const { exam, student, subjects, summary, attendance } = result
  const totalOnly = exam.marks_mode === 'total_only'
  const totalPass = exam.marks_mode === 'total_pass'
  return (
    <Card className="result-sheet mx-auto max-w-5xl overflow-hidden print:border-0 print:shadow-none">
      <CardContent className="p-4 sm:p-8">
        <div className="mb-6 text-center print:mb-4">
          <img src="https://ik.imagekit.io/nmdc/nmdc_logo.jpg"
            alt="NMDC Logo"
            className="mx-auto h-20 w-20 object-contain mb-4"
          />
          <p className="text-xs font-medium uppercase tracking-[0.25em] text-muted-foreground">New Model Degree College</p>
          <p className="text-xs font-medium uppercase tracking-[0.25em] text-muted-foreground">Rasel Square, Sukrabad Rd, Dhaka 1207</p>
          <h1 className="mt-1 text-2xl font-bold">Student Assessment Report</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {exam.title || exam.exam_type} · {exam.academic_year}
          </p>
          {publicView && <Badge variant="outline" className="mt-2">Guardian copy</Badge>}
          
        </div>

        <div className="mb-5 grid grid-cols-2 gap-x-3 gap-y-3 rounded-lg border bg-muted/30 p-3 text-sm sm:p-4 lg:grid-cols-4 print:mb-3">
          <div className="min-w-0"><span className="text-muted-foreground">Student</span><p className="break-words font-semibold">{student.full_name}</p></div>
          <div className="min-w-0"><span className="text-muted-foreground">Student ID</span><p className="break-words font-semibold">{student.admission_number}</p></div>
          <div className="min-w-0"><span className="text-muted-foreground">Class</span><p className="break-words font-semibold">{exam.class_name} ({exam.grade}-{exam.section})</p></div>
          <div className="min-w-0"><span className="text-muted-foreground">Exam date</span><p className="break-words font-semibold">{exam.exam_date}</p></div>
        </div>

        {attendance && <div className="mb-4 grid grid-cols-3 gap-x-3 gap-y-1 text-xs print:mb-2 print:gap-y-0 print:text-[10px]" data-report-attendance>
          <div><p className="text-muted-foreground">Amount of classes</p><p className="font-semibold tabular-nums">{attendance.total_classes}</p></div>
          <div><p className="text-muted-foreground">Present</p><p className="font-semibold tabular-nums">{attendance.present_count}</p></div>
          <div><p className="text-muted-foreground">Present percentage</p><p className="font-semibold tabular-nums">{attendance.present_percentage}%</p></div>
          <p className="col-span-3 text-[10px] text-muted-foreground print:text-[8px]">Attendance period: {attendance.start_date} to {attendance.end_date}. Includes late and approved leave.</p>
        </div>}

        <div className={totalOnly ? 'my-5 grid grid-cols-2 gap-2 print:my-3' : 'my-5 grid grid-cols-2 gap-2 min-[420px]:grid-cols-3 sm:grid-cols-5 print:my-3'}>
          <Summary label="Total" value={`${summary.total_obtained} / ${summary.total_max}`} />
          {!totalOnly && <Summary label="GPA" value={Number(summary.gpa).toFixed(2)} />}
          {!totalOnly && <Summary label="Grade" value={summary.letter_grade ?? '-'} />}
          <Summary label="Position" value={summary.position ? `${summary.position} of ${summary.total_students}` : '—'} />
          {!totalOnly && <Summary label="Failed subjects" value={String(summary.failed_subjects)} danger={summary.failed_subjects > 0} />}
        </div>

        <div className="overflow-hidden rounded-lg border">
          <Table className={totalOnly ? 'text-xs sm:text-sm' : 'min-w-[680px] text-xs sm:text-sm'}>
            <TableHeader>
              <TableRow>
                <TableHead className="sticky left-0 z-20 w-32 min-w-32 border-r bg-background text-xs sm:w-44 sm:min-w-44 sm:text-sm print:static print:border-r-0">Subject</TableHead>
                {!totalOnly && <><TableHead className="text-center">{totalPass ? 'CQ' : 'Creative'}</TableHead>
                <TableHead className="text-center">MCQ</TableHead>
                {!totalPass && <TableHead className="text-center">Practical</TableHead>}</>}
                <TableHead className="text-center">Obtained</TableHead>
                {!totalOnly && <><TableHead className="text-center">Letter</TableHead>
                <TableHead className="text-center">Point</TableHead></>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {subjects.map(subject => (
                <TableRow key={subject.id} className={totalOnly || subject.passed ? undefined : 'bg-destructive/5'}>
                  <TableCell className={`sticky left-0 z-10 w-32 min-w-32 whitespace-normal border-r text-[11px] font-medium leading-tight sm:w-44 sm:min-w-44 sm:text-sm print:static print:border-r-0 ${totalOnly || subject.passed ? 'bg-card' : 'bg-destructive/5'}`}>
                    <span className="block">{subject.name}</span>
                    <span className="mt-0.5 block text-[10px] text-muted-foreground sm:text-xs">{subject.code}</span>
                  </TableCell>
                  {!totalOnly && <><SectionMark value={subject.creative_marks} maximum={subject.creative_max} passMark={subject.creative_pass_mark} absent={subject.is_absent} />
                  <SectionMark value={subject.written_marks} maximum={subject.written_max} passMark={subject.written_pass_mark} absent={subject.is_absent} />
                  {!totalPass && <SectionMark value={subject.practical_marks} maximum={subject.practical_max} passMark={subject.practical_pass_mark} absent={subject.is_absent} />}</>}
                  <TableCell className="text-center font-semibold">{subject.is_absent ? 'Absent' : `${subject.obtained} / ${subject.total_max}`}{totalPass && <span className="mt-0.5 block text-[10px] font-normal text-muted-foreground">Total pass: {subject.pass_mark}</span>}</TableCell>
                  {!totalOnly && <><TableCell className="text-center"><Badge variant={subject.passed ? 'secondary' : 'destructive'}>{subject.letter_grade}</Badge></TableCell>
                  <TableCell className="text-center font-semibold">{subject.grade_point}</TableCell></>}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        

        <div className="mt-12 hidden grid-cols-2 gap-20 text-center text-sm print:grid">
          <div className="border-t pt-2">Guardian signature</div>
          <div className="border-t pt-2">Principal / authorized signature</div>
        </div>
      </CardContent>
    </Card>
  )
}

function SectionMark({ value, maximum, passMark, absent }: { value: number | null; maximum: number; passMark: number; absent: boolean }) {
  const failed = !absent && maximum > 0 && value != null && value < passMark
  return (
    <TableCell className={`text-center ${failed ? 'font-semibold text-destructive' : ''}`}>
      {showMark(value, maximum, absent)}{maximum > 0 && !absent ? ` / ${maximum}` : ''}
      {failed && <span className="mt-0.5 block text-[10px]">Pass mark: {passMark}</span>}
    </TableCell>
  )
}

function Summary({ label, value, danger = false }: { label: string; value: string; danger?: boolean }) {
  return (
    <div className="rounded-lg border bg-card px-2 py-2.5 text-center">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={danger ? 'text-lg font-bold text-destructive' : 'text-lg font-bold'}>{value}</p>
    </div>
  )
}
