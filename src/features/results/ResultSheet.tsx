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
  const { exam, student, subjects, summary } = result
  return (
    <Card className="result-sheet mx-auto max-w-5xl overflow-hidden print:border-0 print:shadow-none">
      <CardContent className="p-4 sm:p-8">
        <div className="mb-6 text-center">
          <p className="text-xs font-medium uppercase tracking-[0.25em] text-muted-foreground">Axentra@Zuanshi</p>
          <h1 className="mt-1 text-2xl font-bold">Student Assessment Report</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {exam.title || exam.exam_type} · {exam.academic_year}
          </p>
          {publicView && <Badge variant="outline" className="mt-2">Guardian copy</Badge>}
        </div>

        <div className="mb-5 grid gap-3 rounded-lg border bg-muted/30 p-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <div><span className="text-muted-foreground">Student</span><p className="font-semibold">{student.full_name}</p></div>
          <div><span className="text-muted-foreground">Student ID</span><p className="font-semibold">{student.admission_number}</p></div>
          <div><span className="text-muted-foreground">Class</span><p className="font-semibold">{exam.class_name} ({exam.grade}-{exam.section})</p></div>
          <div><span className="text-muted-foreground">Roll</span><p className="font-semibold">{student.roll_number ?? '—'}</p></div>
          <div><span className="text-muted-foreground">Exam</span><p className="font-semibold">{exam.exam_type}</p></div>
          <div><span className="text-muted-foreground">Exam date</span><p className="font-semibold">{exam.exam_date}</p></div>
          <div><span className="text-muted-foreground">Session</span><p className="font-semibold">{exam.academic_year}</p></div>
          <div><span className="text-muted-foreground">Status</span><p className="font-semibold capitalize">{exam.status}</p></div>
        </div>

        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="min-w-44">Subject</TableHead>
                <TableHead className="text-center">Creative</TableHead>
                <TableHead className="text-center">MCQ</TableHead>
                <TableHead className="text-center">Practical</TableHead>
                <TableHead className="text-center">Obtained</TableHead>
                <TableHead className="text-center">Letter</TableHead>
                <TableHead className="text-center">Point</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {subjects.map(subject => (
                <TableRow key={subject.id} className={subject.passed ? undefined : 'bg-destructive/5'}>
                  <TableCell className="font-medium">
                    {subject.name}
                    <span className="ml-1 text-xs text-muted-foreground">({subject.code})</span>
                  </TableCell>
                  <TableCell className="text-center">{showMark(subject.creative_marks, subject.creative_max, subject.is_absent)}{subject.creative_max > 0 && !subject.is_absent ? ` / ${subject.creative_max}` : ''}</TableCell>
                  <TableCell className="text-center">{showMark(subject.written_marks, subject.written_max, subject.is_absent)}{subject.written_max > 0 && !subject.is_absent ? ` / ${subject.written_max}` : ''}</TableCell>
                  <TableCell className="text-center">{showMark(subject.practical_marks, subject.practical_max, subject.is_absent)}{subject.practical_max > 0 && !subject.is_absent ? ` / ${subject.practical_max}` : ''}</TableCell>
                  <TableCell className="text-center font-semibold">{subject.is_absent ? 'Absent' : `${subject.obtained} / ${subject.total_max}`}</TableCell>
                  <TableCell className="text-center"><Badge variant={subject.passed ? 'secondary' : 'destructive'}>{subject.letter_grade}</Badge></TableCell>
                  <TableCell className="text-center font-semibold">{subject.grade_point}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Summary label="Total" value={`${summary.total_obtained} / ${summary.total_max}`} />
          <Summary label="GPA" value={Number(summary.gpa).toFixed(2)} />
          <Summary label="Grade" value={summary.letter_grade} />
          <Summary label="Position" value={summary.position ? `${summary.position} of ${summary.total_students}` : '—'} />
          <Summary label="Failed subjects" value={String(summary.failed_subjects)} danger={summary.failed_subjects > 0} />
        </div>

        <div className="mt-12 hidden grid-cols-2 gap-20 text-center text-sm print:grid">
          <div className="border-t pt-2">Guardian signature</div>
          <div className="border-t pt-2">Principal / authorized signature</div>
        </div>
      </CardContent>
    </Card>
  )
}

function Summary({ label, value, danger = false }: { label: string; value: string; danger?: boolean }) {
  return (
    <div className="rounded-lg border bg-card p-3 text-center">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={danger ? 'text-lg font-bold text-destructive' : 'text-lg font-bold'}>{value}</p>
    </div>
  )
}
