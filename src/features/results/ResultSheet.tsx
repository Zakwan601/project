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
  const priority = (subject: StudentResultPayload['subjects'][number]) => {
    const code = subject.code.split('+')[0].trim()
    if (['101', '102'].includes(code) || /^bangla\b/i.test(subject.name)) return 0
    if (['107', '108'].includes(code) || /^english\b/i.test(subject.name)) return 1
    if (code === '275' || /^(ict\b|information.*communication)/i.test(subject.name)) return 2
    return 3
  }
  const orderedSubjects = [...subjects].sort((a, b) => priority(a) - priority(b))
  const failed = !totalOnly && (summary.failed_subjects > 0 || summary.letter_grade === 'F')
  return (
    <article className={`result-sheet${subjects.length > 10 ? ' report-card-dense' : ''}`}>
      <header className="report-card-heading">
        <img src="https://ik.imagekit.io/nmdc/nmdc_logo.jpg" alt="NMDC Logo" />
        <h1>New Model Degree College</h1>
        <p>Sukrabad Rd, Dhaka 1207</p>
        <h2>Student Assessment Report</h2>
        {publicView && <p className="report-card-copy">Guardian copy</p>}
      </header>
      <dl className="report-card-details">
        <Detail label="Student Name" value={student.full_name} />
        <Detail label="Student ID" value={student.admission_number} />
        <Detail label="Class" value={`${exam.class_name} (${exam.grade}-${exam.section})`} />
        <Detail label="Academic year" value={exam.academic_year} />
        <Detail label="Examination" value={exam.title || exam.exam_type} />
        <Detail label="Exam Start Date" value={exam.exam_date} />
      </dl>

        <div className="report-card-table-wrap">
          <Table className="report-card-marks">
            <colgroup><col style={{ width: totalOnly ? '65%' : totalPass ? '32%' : '29%' }} />
              {Array.from({ length: totalOnly ? 1 : totalPass ? 5 : 6 }, (_, index) => <col key={index} />)}
            </colgroup>
            <TableHeader>
              <TableRow>
                <TableHead className="report-card-subject">Subject</TableHead>
                {!totalOnly && <><TableHead className="text-center">{totalPass ? 'CQ' : 'Creative'}</TableHead>
                <TableHead className="text-center">MCQ</TableHead>
                {!totalPass && <TableHead className="text-center">Practical</TableHead>}</>}
                <TableHead className="text-center">Obtained</TableHead>
                {!totalOnly && <><TableHead className="text-center">Letter</TableHead>
                <TableHead className="text-center">Point</TableHead></>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {orderedSubjects.map(subject => (
                <TableRow key={subject.id} className={totalOnly || subject.passed ? undefined : 'report-card-failed'}>
                  <TableCell className="report-card-subject">
                    <span className="block">{subject.name}</span>
                    <span className="mt-0.5 block text-[10px] text-muted-foreground sm:text-xs">{subject.code}{subject.subject_role === 'fourth' && <strong> · 4th subject</strong>}</span>
                  </TableCell>
                  {!totalOnly && <><SectionMark value={subject.creative_marks} maximum={subject.creative_max} passMark={subject.creative_pass_mark} absent={subject.is_absent} />
                  <SectionMark value={subject.written_marks} maximum={subject.written_max} passMark={subject.written_pass_mark} absent={subject.is_absent} />
                  {!totalPass && <SectionMark value={subject.practical_marks} maximum={subject.practical_max} passMark={subject.practical_pass_mark} absent={subject.is_absent} />}</>}
                  <TableCell className="text-center font-semibold">{subject.is_absent ? 'Absent' : `${subject.obtained} / ${subject.total_max}`}{totalPass && <span className="mt-0.5 block text-[10px] font-normal text-muted-foreground">Total pass: {subject.pass_mark}</span>}</TableCell>
                  {!totalOnly && <><TableCell className="text-center"><span>{subject.letter_grade}</span></TableCell>
                  <TableCell className="text-center font-semibold">{subject.grade_point}</TableCell></>}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

      <dl className={`report-card-summary ${totalOnly ? 'report-card-summary-ungraded' : ''}`}>
        <Detail label="Total" value={`${summary.total_obtained} / ${summary.total_max}`} />
        {!totalOnly && <><Detail label="GPA" value={Number(summary.gpa).toFixed(2)} />
          <Detail label="Grade" value={summary.letter_grade ?? '-'} /></>}
        <Detail label="Position" value={failed ? 'Failed' : summary.position ? `${summary.position} of ${summary.total_students}` : '\u2014'} danger={failed} />
        {!totalOnly && <Detail label="Failed subjects" value={String(summary.failed_subjects)} danger={summary.failed_subjects > 0} />}
      </dl>
      {attendance && <section className="report-card-attendance" data-report-attendance>
        <dl>
          <Detail label="Amount of classes" value={String(attendance.total_classes)} />
          <Detail label="Present" value={String(attendance.present_count)} />
          <Detail label="Present percentage" value={`${attendance.present_percentage}%`} />
        </dl>
        <p>Attendance period: {attendance.start_date} to {attendance.end_date}. Includes late and approved leave.</p>
      </section>}
      <ResultSignatures guardian />
    </article>
  )
}

export function ResultSignatures({ guardian = false, collector, className = '' }: { guardian?: boolean; collector?: string; className?: string }) {
  return <footer className={`result-signatures ${guardian || collector !== undefined ? 'report-card-signatures' : 'tabulation-signatures'} ${className}`}>
    {guardian && <div className="result-signature"><span>Guardian signature</span></div>}
    {collector !== undefined && <div className="result-signature"><span>Collector signature</span><strong>{collector}</strong></div>}
    <div className="result-signature">
      <svg className="result-signature-convener" viewBox="48 25 294 280" role="img" aria-label="Examination committee convener signature">
        <image href="/signatures/convener.png" width="362" height="343" />
      </svg>
      <span>Examination committee convener</span>
    </div>
    <div className="result-signature">
      <svg className="result-signature-principal" viewBox="560 465 485 210" role="img" aria-label="Principal signature">
        <image href="/signatures/principal.png" width="1600" height="1140" />
      </svg>
      <span>Principal / authorized signature</span>
    </div>
  </footer>
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

function Detail({ label, value, danger = false }: { label: string; value: string; danger?: boolean }) {
  return <div className={danger ? 'report-card-danger' : undefined}><dt>{label}</dt><dd>{value}</dd></div>
}
