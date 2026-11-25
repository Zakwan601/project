import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { useClasses } from '@/hooks/useClasses'
import type { Student, SubjectCourseOption } from '@/types/database'
import { ErrorState, LoadingState } from '@/components/shared/PageHeader'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { MarkInput } from './ResultControls'
import { examSubjectAppliesToStudent, examSubjectRoleForStudent, isTotalOnlyExam, isTotalPassExam,
  type ExamSubject, type ExamWithDetails, type MarkDraft, type MarkRow, type ResultSubjectPaperGroup } from './result-model'

const db = supabase as any
const subjectName = (subject: ExamSubject) => subject.result_subject_paper_groups?.name ?? subject.subjects.name
const markDraft = (mark?: MarkRow): MarkDraft => ({ creative: mark?.creative_marks?.toString() ?? '',
  written: mark?.written_marks?.toString() ?? '', practical: mark?.practical_marks?.toString() ?? '', absent: mark?.is_absent ?? false })

export function subjectMarkValues(subject: ExamSubject, draft: MarkDraft) {
  const parse = (value: string, max: number) => {
    if (draft.absent || max <= 0 || value.trim() === '') return null
    const number = Number(value)
    if (!Number.isFinite(number) || number < 0 || number > max) throw new Error(`Marks must be between 0 and ${max}.`)
    return number
  }
  return { creative_marks: parse(draft.creative, subject.creative_max), written_marks: parse(draft.written, subject.written_max),
    practical_marks: parse(draft.practical, subject.practical_max), is_absent: draft.absent }
}

export function SubjectMarksEntry({ exam }: { exam: ExamWithDetails }) {
  const { data: classes = [] } = useClasses()
  const [classId, setClassId] = useState(exam.class_id)
  const [subjectId, setSubjectId] = useState('')
  const [search, setSearch] = useState('')
  const exams = useQuery<ExamWithDetails[]>({
    queryKey: ['marks-entry-exams', exam.exam_group_id ?? exam.id],
    queryFn: async () => {
      if (!exam.exam_group_id) return [exam]
      const { data, error } = await db.from('result_exams')
        .select('*,result_exam_types(name,marks_mode),classes(name,grade,section,class_group),academic_years(name)')
        .eq('exam_group_id', exam.exam_group_id)
      if (error) throw error
      return data
    },
  })
  const availableExams = (exams.data ?? [exam]).filter(item => classes.some(cls => cls.id === item.class_id))
  const selectedExam = availableExams.find(item => item.class_id === classId)
  const group = selectedExam?.classes.class_group
  const subjects = useQuery<ExamSubject[]>({
    queryKey: ['result-exam-subjects', selectedExam?.id], enabled: Boolean(selectedExam),
    queryFn: async () => {
      const { data, error } = await db.from('result_exam_subjects')
        .select('*,subjects(id,name,code,is_fourth_subject),result_subject_paper_groups(name,code)')
        .eq('exam_id', selectedExam!.id).order('sort_order')
      if (error) throw error
      return data
    },
  })
  const subject = subjects.data?.find(item => item.id === subjectId)
  const roster = useQuery<Student[]>({
    queryKey: ['result-roster', selectedExam?.class_id, selectedExam?.exam_date], enabled: Boolean(selectedExam && subject),
    queryFn: async () => {
      const { data, error } = await db.rpc('get_class_students_for_period', {
        p_class_id: selectedExam!.class_id, p_start_date: selectedExam!.exam_date, p_end_date: selectedExam!.exam_date,
      })
      if (error) throw error
      return (data as Student[]).sort((a, b) => (a.roll_number ?? 99999) - (b.roll_number ?? 99999) || a.admission_number.localeCompare(b.admission_number))
    },
  })
  const curriculum = useQuery<Student[]>({
    queryKey: ['result-roster-curriculum', selectedExam?.id, roster.data?.map(item => item.id).join(',')],
    enabled: Boolean(subject && roster.data?.length),
    queryFn: async () => {
      const { data, error } = await db.from('students')
        .select('id,class_group,fourth_subject_id,optional_subject_2_id,group_elective_option_id,group_fourth_option_id,humanities_main_option_1_id,humanities_main_option_2_id,humanities_main_option_3_id,humanities_fourth_option_id')
        .in('id', roster.data!.map(item => item.id))
      if (error) throw error
      return data
    },
  })
  const options = useQuery<SubjectCourseOption[]>({
    queryKey: ['result-subject-course-options', group], enabled: Boolean(subject && group),
    queryFn: async () => {
      const { data, error } = await db.from('subject_course_options').select('*').eq('class_group', group)
      if (error) throw error
      return data
    },
  })
  const paperGroups = useQuery<ResultSubjectPaperGroup[]>({
    queryKey: ['result-subject-paper-groups', group], enabled: Boolean(subject && group),
    queryFn: async () => {
      const { data, error } = await db.from('result_subject_paper_groups').select('*').eq('class_group', group).order('name')
      if (error) throw error
      return data
    },
  })
  const marks = useQuery<MarkRow[]>({
    queryKey: ['result-subject-marks', selectedExam?.id, subject?.id], enabled: Boolean(subject),
    queryFn: async () => {
      const { data, error } = await db.from('result_marks').select('*').eq('exam_subject_id', subject!.id)
      if (error) throw error
      return data
    },
  })
  const queries = [roster, ...(roster.data?.length ? [curriculum] : []), options, paperGroups, marks]
  const error = [exams, subjects, ...(subject ? queries : [])].find(query => query.error)?.error
  const loading = subject && queries.some(query => query.isPending)
  const curriculumById = new Map((curriculum.data ?? []).map(item => [item.id, item]))
  const eligible = (roster.data ?? []).filter(student => {
    const selection = curriculumById.get(student.id)
    return subject && selection && examSubjectAppliesToStudent(subject, selection, options.data ?? [], paperGroups.data ?? [])
  })
  const visible = eligible.filter(student => `${student.first_name} ${student.last_name} ${student.roll_number ?? ''} ${student.admission_number}`.toLowerCase().includes(search.trim().toLowerCase()))
  const marksByStudent = new Map((marks.data ?? []).map(mark => [mark.student_id, mark]))
  const totalOnly = isTotalOnlyExam(selectedExam)
  const totalPass = isTotalPassExam(selectedExam)

  return <div className="min-w-0 space-y-3">
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="space-y-1"><Label htmlFor="marks-class">Class</Label><Select value={classId} onValueChange={value => { setClassId(value); setSubjectId(''); setSearch('') }}><SelectTrigger id="marks-class" className="w-full"><SelectValue placeholder="Choose class" /></SelectTrigger><SelectContent>
        {availableExams.map(item => <SelectItem key={item.id} value={item.class_id}>{item.classes.name}</SelectItem>)}
      </SelectContent></Select></div>
      <div className="space-y-1"><Label htmlFor="marks-subject">Subject</Label><Select value={subjectId} disabled={!selectedExam || subjects.isPending} onValueChange={value => { setSubjectId(value); setSearch('') }}><SelectTrigger id="marks-subject" className="w-full"><SelectValue placeholder="Choose subject" /></SelectTrigger><SelectContent>
        {subjects.data?.map(item => <SelectItem key={item.id} value={item.id}>{subjectName(item)} · {item.result_subject_paper_groups?.code ?? item.subjects.code}</SelectItem>)}
      </SelectContent></Select></div>
    </div>
    {error ? <ErrorState message={(error as Error).message} /> : subjects.isPending ? <LoadingState message="Loading subjects…" />
      : !subjects.data?.length ? <p className="py-6 text-sm text-muted-foreground">Configure subjects for this examination first.</p>
      : !subject ? <p className="py-6 text-sm text-muted-foreground">Choose a subject to enter marks for the class.</p>
      : loading ? <LoadingState message="Loading students and marks…" /> : <>
        <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-xs text-muted-foreground">{eligible.length} students · {selectedExam?.status === 'published' ? 'Published results are read-only.' : 'Changes save automatically.'}{totalPass && ` Total pass: ${subject.pass_mark}/${subject.creative_max + subject.written_max}. No separate CQ or MCQ pass marks.`}</p><Input aria-label="Search marks roster" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search name, roll or ID" className="h-8 w-full sm:w-64" /></div>
        <div className="border"><Table className="text-xs [&_td]:px-2 [&_th]:px-2 sm:text-sm"><TableHeader><TableRow>
          <TableHead className="w-12">Roll</TableHead><TableHead className="min-w-36">Student</TableHead>
          {!totalOnly && <TableHead>{totalPass ? 'CQ' : 'Creative'} / {subject.creative_max}</TableHead>}<TableHead>{totalOnly ? 'Marks' : 'MCQ'} / {subject.written_max}</TableHead>{!totalOnly && !totalPass && <TableHead>Practical / {subject.practical_max}</TableHead>}<TableHead>Total</TableHead><TableHead>Absent</TableHead><TableHead className="w-20">Status</TableHead>
        </TableRow></TableHeader><TableBody>{visible.map(student => <SubjectMarkRow key={`${subject.id}:${student.id}`} student={student} subject={subject} exam={selectedExam!} mark={marksByStudent.get(student.id)} totalOnly={totalOnly}
          fourth={examSubjectRoleForStudent(subject, curriculumById.get(student.id)!, options.data ?? [], paperGroups.data ?? []) === 'fourth'} />)}
          {!visible.length && <TableRow><TableCell colSpan={totalOnly ? 6 : totalPass ? 7 : 8} className="py-8 text-center text-muted-foreground">{eligible.length ? 'No students match your search.' : 'No students take this subject.'}</TableCell></TableRow>}
        </TableBody></Table></div>
      </>}
  </div>
}

function SubjectMarkRow({ student, subject, exam, mark, totalOnly, fourth }: {
  student: Student; subject: ExamSubject; exam: ExamWithDetails; mark?: MarkRow; totalOnly: boolean; fourth: boolean
}) {
  const { user, can } = useAuth()
  const qc = useQueryClient()
  const [draft, setDraft] = useState(() => markDraft(mark))
  const [status, setStatus] = useState('')
  const draftRef = useRef(draft)
  const version = useRef(0)
  const savedVersion = useRef(0)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const writable = can('results', 'write') && exam.status === 'draft'
  const totalPass = isTotalPassExam(exam)
  const save = useMutation({
    scope: { id: `subject-marks:${subject.id}:${student.id}` },
    mutationFn: async ({ value, revision }: { value: MarkDraft; revision: number }) => {
      const { error } = await db.from('result_marks').upsert({ exam_subject_id: subject.id, student_id: student.id,
        ...subjectMarkValues(subject, value), entered_by: user?.id }, { onConflict: 'exam_subject_id,student_id' })
      if (error) throw error
      return revision
    },
    onSuccess: revision => {
      savedVersion.current = revision
      if (version.current === revision) setStatus('Saved')
      for (const key of [['result-subject-marks', exam.id, subject.id], ['result-exam-marks', exam.id], ['result-student-marks', exam.id, student.id],
        ['result-preview', exam.id, student.id], ['student_attendance_fine_details'], ['class_attendance_fine_details']]) void qc.invalidateQueries({ queryKey: key })
    },
    onError: error => { setStatus('Save failed'); toast.error((error as Error).message) },
  })
  const flush = () => {
    if (timer.current === null) return
    clearTimeout(timer.current); timer.current = null
    save.mutate({ value: { ...draftRef.current }, revision: version.current })
  }
  const flushRef = useRef(flush)
  flushRef.current = flush
  useEffect(() => () => flushRef.current(), [])
  useEffect(() => {
    if (version.current !== savedVersion.current || timer.current !== null) return
    const next = markDraft(mark); draftRef.current = next; setDraft(next)
  }, [mark])
  const update = (field: keyof MarkDraft, value: string | boolean) => {
    if (!writable) return
    const next = { ...draftRef.current, [field]: value }
    draftRef.current = next; setDraft(next); version.current++; setStatus('Saving…')
    if (timer.current !== null) clearTimeout(timer.current)
    timer.current = setTimeout(() => flushRef.current(), 500)
  }
  const name = `${student.first_name} ${student.last_name}`.trim()
  const total = [draft.creative, draft.written, draft.practical].reduce((sum, value) => sum + (Number(value) || 0), 0)
  return <TableRow onBlur={() => flush()}>
    <TableCell className="font-medium">{student.roll_number ?? '—'}</TableCell><TableCell><p className="font-medium">{name}</p><p className="text-[10px] text-muted-foreground">{student.admission_number}{fourth ? ' · Fourth subject' : ''}</p></TableCell>
    {!totalOnly && <TableCell><MarkInput label={`${name} ${totalPass ? 'CQ' : 'creative'} marks`} value={draft.creative} max={subject.creative_max} disabled={!writable || draft.absent} onChange={value => update('creative', value)} /></TableCell>}
    <TableCell><MarkInput label={`${name} ${totalOnly ? 'total' : 'MCQ'} marks`} value={draft.written} max={subject.written_max} disabled={!writable || draft.absent} onChange={value => update('written', value)} /></TableCell>
    {!totalOnly && !totalPass && <TableCell><MarkInput label={`${name} practical marks`} value={draft.practical} max={subject.practical_max} disabled={!writable || draft.absent} onChange={value => update('practical', value)} /></TableCell>}
    <TableCell className="tabular-nums">{draft.absent ? '—' : total}<span className="text-muted-foreground">/{subject.creative_max + subject.written_max + subject.practical_max}</span></TableCell>
    <TableCell><Checkbox aria-label={`Mark ${name} as absent`} checked={draft.absent} disabled={!writable} onCheckedChange={checked => update('absent', Boolean(checked))} /></TableCell>
    <TableCell className="text-[10px] text-muted-foreground" aria-live="polite">{status === 'Save failed' ? <Button variant="ghost" size="sm" className="px-0 text-destructive" onClick={() => { setStatus('Saving…'); save.mutate({ value: { ...draftRef.current }, revision: version.current }) }}>Retry save</Button> : status}</TableCell>
  </TableRow>
}
