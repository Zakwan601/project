import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Copy, Download, Eye, FilePlus2, Link2, Pencil, Plus, Power, Printer, Send, Settings2, Trash2 } from 'lucide-react'
import { format } from 'date-fns'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { useClasses } from '@/hooks/useClasses'
import { PageHeader, EmptyState, ErrorState, LoadingState } from '@/components/shared/PageHeader'
import { ResultSheet } from '@/features/results/ResultSheet'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import type { ResultExam, ResultExamType, StudentResultPayload, Student } from '@/types/database'
import { downloadCsv } from '@/lib/csv'

// Result tables/RPCs are introduced by the accompanying migration.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any

interface ExamWithDetails extends ResultExam {
  result_exam_types: { name: string }
  academic_years: { name: string }
  classes: { name: string; grade: string; section: string }
}

interface ExamSubject {
  id: string
  exam_id: string
  subject_id: string
  creative_max: number
  written_max: number
  practical_max: number
  pass_mark: number
  sort_order: number
  subjects: { id: string; name: string; code: string }
}

interface MarkRow {
  id: string
  exam_subject_id: string
  student_id: string
  creative_marks: number | null
  written_marks: number | null
  practical_marks: number | null
  is_absent: boolean
  remarks: string | null
}

interface ExamResultSubjectCell {
  obtained: number
  totalMax: number
  absent: boolean
  complete: boolean
  passed: boolean
  gradePoint: number
}

interface ExamResultReportRow {
  id: string
  name: string
  admission: string
  roll: number | null
  subjects: Record<string, ExamResultSubjectCell>
  totalObtained: number
  totalMax: number
  failedSubjects: number
  gpa: number | null
  grade: string
  complete: boolean
  position: number | null
}

interface MarkDraft {
  creative: string
  written: string
  practical: string
  absent: boolean
}

interface ClassSubject {
  id: string
  name: string
  code: string
  is_active: boolean
}

interface ExamSubjectConfigDraft {
  selected: boolean
  creative: string
  written: string
  practical: string
  pass: string
  total: string
}

interface ResultSmsSummary {
  submitted: number
  skipped: number
  failed: number
  missingPhone: number
}

interface ResultShareLink {
  id: string
  token: string
  expires_at: string | null
}

function gradeSubject(obtained: number, totalMax: number, passMark: number, absent: boolean) {
  if (absent || obtained < passMark) return { passed: false, gradePoint: 0 }
  const percentage = totalMax > 0 ? obtained * 100 / totalMax : 0
  if (percentage >= 80) return { passed: true, gradePoint: 5 }
  if (percentage >= 70) return { passed: true, gradePoint: 4 }
  if (percentage >= 60) return { passed: true, gradePoint: 3.5 }
  if (percentage >= 50) return { passed: true, gradePoint: 3 }
  if (percentage >= 40) return { passed: true, gradePoint: 2 }
  if (percentage >= 33) return { passed: true, gradePoint: 1 }
  return { passed: false, gradePoint: 0 }
}

function overallGrade(gpa: number, failedSubjects: number) {
  if (failedSubjects > 0 || gpa < 1) return 'F'
  if (gpa >= 5) return 'A+'
  if (gpa >= 4) return 'A'
  if (gpa >= 3.5) return 'A-'
  if (gpa >= 3) return 'B'
  if (gpa >= 2) return 'C'
  return 'D'
}

function examSubjectTotal(subject: ExamSubject) {
  return subject.creative_max + subject.written_max + subject.practical_max
}

export function ResultsPage() {
  const { role } = useAuth()
  return role === 'student' ? <StudentResults /> : <StaffResults />
}

function StudentResults() {
  const { student } = useAuth()
  const [examId, setExamId] = useState('')
  const examsQuery = useQuery<ExamWithDetails[]>({
    queryKey: ['student-result-exams', student?.id],
    enabled: Boolean(student?.id),
    queryFn: async () => {
      const { data, error } = await db.from('result_exams')
        .select('*, result_exam_types(name), academic_years(name), classes(name, grade, section)')
        .eq('status', 'published').order('exam_date', { ascending: false })
      if (error) throw error
      return data as ExamWithDetails[]
    },
  })

  useEffect(() => {
    if (!examId && examsQuery.data?.[0]) setExamId(examsQuery.data[0].id)
  }, [examId, examsQuery.data])

  const resultQuery = useQuery<StudentResultPayload>({
    queryKey: ['student-result', examId, student?.id],
    enabled: Boolean(examId && student?.id),
    queryFn: async () => {
      const { data, error } = await db.rpc('get_student_result', { p_exam_id: examId, p_student_id: student!.id })
      if (error) throw error
      return data as StudentResultPayload
    },
  })

  if (examsQuery.isLoading) return <LoadingState />
  if (examsQuery.error) return <ErrorState message={(examsQuery.error as Error).message} />
  return (
    <div>
      <PageHeader title="My Results" description="Published examination results are read-only." action={resultQuery.data ? (
        <Button variant="outline" onClick={() => window.print()}><Printer className="mr-2 h-4 w-4" /> Print</Button>
      ) : undefined} />
      {!examsQuery.data?.length ? <EmptyState title="No published results" description="Your results will appear here after publication." /> : (
        <>
          <div className="mb-5 max-w-md">
            <Label>Examination</Label>
            <Select value={examId} onValueChange={setExamId}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>{examsQuery.data.map(exam => (
                <SelectItem key={exam.id} value={exam.id}>{exam.result_exam_types.name} · {exam.classes.name} · {exam.exam_date}</SelectItem>
              ))}</SelectContent>
            </Select>
          </div>
          {resultQuery.isLoading ? <LoadingState /> : resultQuery.error ? <ErrorState message={(resultQuery.error as Error).message} /> : resultQuery.data ? <ResultSheet result={resultQuery.data} /> : null}
        </>
      )}
    </div>
  )
}

function StaffResults() {
  const { profile, user, can } = useAuth()
  const canWrite = can('results', 'write')
  const isAdmin = profile?.role === 'admin'
  const qc = useQueryClient()
  const { data: classes = [], isLoading: classesLoading } = useClasses()
  const [activeTab, setActiveTab] = useState('exams')
  const [classId, setClassId] = useState('')
  const [examId, setExamId] = useState('')
  const [selectedStudentId, setSelectedStudentId] = useState('')
  const [examDialog, setExamDialog] = useState(false)
  const [subjectDialog, setSubjectDialog] = useState(false)
  const [configDialog, setConfigDialog] = useState(false)
  const [typeDialog, setTypeDialog] = useState(false)
  const [editingSubjectId, setEditingSubjectId] = useState<string | null>(null)
  const [editingTypeId, setEditingTypeId] = useState<string | null>(null)
  const [examForm, setExamForm] = useState({ typeId: '', title: '', date: '' })
  const [subjectForm, setSubjectForm] = useState({ name: '', code: '' })
  const [typeForm, setTypeForm] = useState({ name: '', sortOrder: '0', isActive: true })
  const [configRows, setConfigRows] = useState<Record<string, ExamSubjectConfigDraft>>({})
  const [drafts, setDrafts] = useState<Record<string, MarkDraft>>({})
  const [marksSaveStatus, setMarksSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const draftsRef = useRef<Record<string, MarkDraft>>({})
  const marksSaveTimerRef = useRef<number | null>(null)
  const [shareUrl, setShareUrl] = useState('')
  const [publishing, setPublishing] = useState(false)

  useEffect(() => {
    if (!classId && classes[0]) setClassId(classes[0].id)
  }, [classId, classes])

  const selectedClass = classes.find(item => item.id === classId)

  const examTypesQuery = useQuery<ResultExamType[]>({
    queryKey: ['result-exam-types'],
    queryFn: async () => {
      const { data, error } = await db.from('result_exam_types').select('*').order('sort_order').order('name')
      if (error) throw error
      return data as ResultExamType[]
    },
  })

  const subjectsQuery = useQuery<ClassSubject[]>({
    queryKey: ['result-subjects', classId], enabled: Boolean(classId),
    queryFn: async () => {
      const { data, error } = await db.from('subjects').select('id,name,code,is_active').eq('class_id', classId).order('name')
      if (error) throw error
      return data
    },
  })

  const examsQuery = useQuery<ExamWithDetails[]>({
    queryKey: ['result-exams', classId], enabled: Boolean(classId),
    queryFn: async () => {
      const { data, error } = await db.from('result_exams')
        .select('*, result_exam_types(name), academic_years(name), classes(name, grade, section)')
        .eq('class_id', classId).order('exam_date', { ascending: false })
      if (error) throw error
      return data as ExamWithDetails[]
    },
  })

  useEffect(() => {
    if (examId && !examsQuery.data?.some(item => item.id === examId)) setExamId('')
  }, [examId, examsQuery.data])

  const selectedExam = examsQuery.data?.find(item => item.id === examId)
  const examSubjectsQuery = useQuery<ExamSubject[]>({
    queryKey: ['result-exam-subjects', examId], enabled: Boolean(examId),
    queryFn: async () => {
      const { data, error } = await db.from('result_exam_subjects').select('*, subjects(id,name,code)').eq('exam_id', examId).order('sort_order')
      if (error) throw error
      return data as ExamSubject[]
    },
  })

  const studentsQuery = useQuery<Student[]>({
    queryKey: ['result-roster', selectedExam?.class_id, selectedExam?.exam_date], enabled: Boolean(selectedExam),
    queryFn: async () => {
      const { data, error } = await db.rpc('get_class_students_for_period', {
        p_class_id: selectedExam!.class_id, p_start_date: selectedExam!.exam_date, p_end_date: selectedExam!.exam_date,
      })
      if (error) throw error
      return (data as Student[]).sort((a, b) => (a.roll_number ?? 99999) - (b.roll_number ?? 99999) || a.admission_number.localeCompare(b.admission_number))
    },
  })

  const marksQuery = useQuery<MarkRow[]>({
    queryKey: ['result-student-marks', examId, selectedStudentId],
    enabled: Boolean(selectedStudentId && examSubjectsQuery.data?.length),
    queryFn: async () => {
      const subjectIds = examSubjectsQuery.data!.map(item => item.id)
      const { data, error } = await db.from('result_marks').select('*')
        .eq('student_id', selectedStudentId).in('exam_subject_id', subjectIds)
      if (error) throw error
      return data as MarkRow[]
    },
  })

  const examMarksQuery = useQuery<MarkRow[]>({
    queryKey: ['result-exam-marks', examId],
    enabled: Boolean(examId && activeTab === 'results' && examSubjectsQuery.data?.length),
    queryFn: async () => {
      const subjectIds = examSubjectsQuery.data!.map(item => item.id)
      const { data, error } = await db.from('result_marks').select('*')
        .in('exam_subject_id', subjectIds)
      if (error) throw error
      return data as MarkRow[]
    },
  })

  useEffect(() => {
    if (!selectedStudentId || !examSubjectsQuery.data) return
    const bySubject = new Map((marksQuery.data ?? []).map(mark => [mark.exam_subject_id, mark]))
    const nextDrafts = Object.fromEntries(examSubjectsQuery.data.map(examSubject => {
      const mark = bySubject.get(examSubject.id)
      return [examSubject.id, {
        creative: mark?.creative_marks?.toString() ?? '', written: mark?.written_marks?.toString() ?? '',
        practical: mark?.practical_marks?.toString() ?? '', absent: mark?.is_absent ?? false,
      }]
    }))
    draftsRef.current = nextDrafts
    setDrafts(nextDrafts)
  }, [selectedStudentId, examSubjectsQuery.data, marksQuery.data])

  const previewQuery = useQuery<StudentResultPayload>({
    queryKey: ['result-preview', examId, selectedStudentId], enabled: Boolean(examId && selectedStudentId),
    queryFn: async () => {
      const { data, error } = await db.rpc('get_student_result', { p_exam_id: examId, p_student_id: selectedStudentId })
      if (error) throw error
      return data as StudentResultPayload
    },
  })

  const examResultRows = useMemo<ExamResultReportRow[]>(() => {
    const roster = studentsQuery.data ?? []
    const subjects = examSubjectsQuery.data ?? []
    const marksByStudentAndSubject = new Map(
      (examMarksQuery.data ?? []).map(mark => [`${mark.student_id}:${mark.exam_subject_id}`, mark]),
    )
    const rows = roster.map(student => {
      const subjectResults = Object.fromEntries(subjects.map(subject => {
        const mark = marksByStudentAndSubject.get(`${student.id}:${subject.id}`)
        const complete = mark != null && (mark.is_absent || (
          (subject.creative_max <= 0 || mark.creative_marks != null)
          && (subject.written_max <= 0 || mark.written_marks != null)
          && (subject.practical_max <= 0 || mark.practical_marks != null)
        ))
        const obtained = Number(mark?.creative_marks ?? 0)
          + Number(mark?.written_marks ?? 0)
          + Number(mark?.practical_marks ?? 0)
        const totalMax = examSubjectTotal(subject)
        const grade = gradeSubject(obtained, totalMax, subject.pass_mark, Boolean(mark?.is_absent))
        return [subject.id, {
          obtained,
          totalMax,
          absent: Boolean(mark?.is_absent),
          complete,
          passed: complete && grade.passed,
          gradePoint: complete ? grade.gradePoint : 0,
        }]
      })) as Record<string, ExamResultSubjectCell>
      const cells = Object.values(subjectResults)
      const complete = cells.length > 0 && cells.every(cell => cell.complete)
      const failedSubjects = cells.filter(cell => cell.complete && !cell.passed).length
      const gpa = complete
        ? failedSubjects > 0 ? 0 : Number((cells.reduce((sum, cell) => sum + cell.gradePoint, 0) / cells.length).toFixed(2))
        : null
      return {
        id: student.id,
        name: `${student.first_name} ${student.last_name}`.trim(),
        admission: student.admission_number,
        roll: student.roll_number,
        subjects: subjectResults,
        totalObtained: cells.reduce((sum, cell) => sum + cell.obtained, 0),
        totalMax: cells.reduce((sum, cell) => sum + cell.totalMax, 0),
        failedSubjects,
        gpa,
        grade: gpa == null ? 'Incomplete' : overallGrade(gpa, failedSubjects),
        complete,
        position: null,
      }
    })
    const positions = new Map<string, number>()
    let previousTotal: number | null = null
    let previousPosition = 0
    rows.filter(row => row.complete)
      .sort((a, b) => b.totalObtained - a.totalObtained || a.name.localeCompare(b.name))
      .forEach((row, index) => {
        if (previousTotal == null || row.totalObtained !== previousTotal) previousPosition = index + 1
        positions.set(row.id, previousPosition)
        previousTotal = row.totalObtained
      })
    return rows.map(row => ({ ...row, position: positions.get(row.id) ?? null }))
  }, [studentsQuery.data, examSubjectsQuery.data, examMarksQuery.data])

  const examSubjectResultText = (row: ExamResultReportRow, subject: ExamSubject) => {
    const result = row.subjects[subject.id]
    if (!result?.complete) return '—'
    if (result.absent) return 'Absent'
    return `${result.obtained} / ${result.totalMax}`
  }

  const exportExamResults = () => {
    if (!selectedExam || !examResultRows.length || !examSubjectsQuery.data) return
    const headers = [
      'SN', 'Class', 'Exam', 'Exam Date', 'Roll', 'Student', 'Admission Number',
      ...examSubjectsQuery.data.map(subject => `${subject.subjects.name} (${subject.subjects.code}) / ${examSubjectTotal(subject)}`),
      'Total', 'GPA', 'Grade', 'Position', 'Failed Subjects',
    ]
    const rows = examResultRows.map((row, index) => [
      index + 1,
      selectedExam.classes.name,
      selectedExam.title || selectedExam.result_exam_types.name,
      selectedExam.exam_date,
      row.roll,
      row.name,
      row.admission,
      ...examSubjectsQuery.data!.map(subject => examSubjectResultText(row, subject)),
      row.complete ? `${row.totalObtained} / ${row.totalMax}` : '',
      row.gpa,
      row.grade,
      row.position,
      row.complete ? row.failedSubjects : '',
    ])
    const classSlug = selectedExam.classes.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'class'
    const examSlug = (selectedExam.title || selectedExam.result_exam_types.name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'exam'
    downloadCsv(`results-${classSlug}-${examSlug}-${selectedExam.exam_date}.csv`, [headers, ...rows])
  }

  const printExamResults = () => {
    if (!examResultRows.length) return
    const pageStyle = document.createElement('style')
    pageStyle.id = 'exam-results-page-style'
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

  const createExam = async () => {
    if (!selectedClass?.academic_year_id || !examForm.typeId || !examForm.date) return toast.error('Select exam type and date')
    const { data, error } = await db.from('result_exams').insert({
      class_id: selectedClass.id, academic_year_id: selectedClass.academic_year_id,
      exam_type_id: examForm.typeId, title: examForm.title.trim() || null,
      exam_date: examForm.date, created_by: user?.id,
    }).select('id').single()
    if (error) return toast.error(error.message)
    await qc.invalidateQueries({ queryKey: ['result-exams', classId] })
    setExamDialog(false); setExamForm({ typeId: '', title: '', date: '' }); setExamId(data.id); setActiveTab('workspace')
    toast.success('Exam created')
  }

  const saveSubject = async () => {
    if (!subjectForm.name.trim() || !subjectForm.code.trim()) return toast.error('Subject name and code are required')
    const payload = { name: subjectForm.name.trim(), code: subjectForm.code.trim().toUpperCase(), class_id: classId, is_active: true }
    const request = editingSubjectId
      ? db.from('subjects').update({ name: payload.name, code: payload.code }).eq('id', editingSubjectId)
      : db.from('subjects').insert(payload)
    const { error } = await request
    if (error) return toast.error(error.message)
    setSubjectDialog(false); setSubjectForm({ name: '', code: '' }); setEditingSubjectId(null)
    await qc.invalidateQueries({ queryKey: ['result-subjects', classId] }); toast.success(editingSubjectId ? 'Subject updated' : 'Subject added')
  }

  const saveExamType = async () => {
    if (!typeForm.name.trim()) return toast.error('Exam type name is required')
    const payload = { name: typeForm.name.trim(), sort_order: Number(typeForm.sortOrder) || 0, is_active: typeForm.isActive }
    const request = editingTypeId
      ? db.from('result_exam_types').update(payload).eq('id', editingTypeId)
      : db.from('result_exam_types').insert({ ...payload, created_by: user?.id })
    const { error } = await request
    if (error) return toast.error(error.message)
    setTypeForm({ name: '', sortOrder: '0', isActive: true }); setEditingTypeId(null); setTypeDialog(false)
    await qc.invalidateQueries({ queryKey: ['result-exam-types'] }); toast.success(editingTypeId ? 'Exam type updated' : 'Exam type added')
  }

  const toggleSubject = async (subject: ClassSubject) => {
    const { error } = await db.from('subjects').update({ is_active: !subject.is_active }).eq('id', subject.id)
    if (error) return toast.error(error.message)
    await qc.invalidateQueries({ queryKey: ['result-subjects', classId] })
  }

  const deleteSubject = async (subject: ClassSubject) => {
    if (!window.confirm(`Delete ${subject.name}? Subjects already used in an exam cannot be deleted.`)) return
    const { error } = await db.from('subjects').delete().eq('id', subject.id)
    if (error) return toast.error(error.message)
    await qc.invalidateQueries({ queryKey: ['result-subjects', classId] }); toast.success('Subject deleted')
  }

  const toggleExamType = async (type: ResultExamType) => {
    const { error } = await db.from('result_exam_types').update({ is_active: !type.is_active }).eq('id', type.id)
    if (error) return toast.error(error.message)
    await qc.invalidateQueries({ queryKey: ['result-exam-types'] })
  }

  const deleteExamType = async (type: ResultExamType) => {
    if (!window.confirm(`Delete ${type.name}? Types already used by an exam cannot be deleted.`)) return
    const { error } = await db.from('result_exam_types').delete().eq('id', type.id)
    if (error) return toast.error(error.message)
    await qc.invalidateQueries({ queryKey: ['result-exam-types'] }); toast.success('Exam type deleted')
  }

  const openSubjectConfiguration = () => {
    setConfigRows(Object.fromEntries(unusedSubjects.map(subject => [subject.id, {
      selected: false, creative: '40', written: '40', practical: '20', pass: '33', total: '100',
    }])))
    setConfigDialog(true)
  }

  const attachSubjects = async () => {
    const selected = unusedSubjects.filter(subject => configRows[subject.id]?.selected)
    if (!selected.length) return toast.error('Select at least one subject')
    const rows = selected.map((subject, index) => {
      const row = configRows[subject.id]
      const values = [row.creative, row.written, row.practical, row.pass, row.total].map(Number)
      return { subject, row, values, index }
    })
    const invalid = rows.find(({ values }) => values.some(value => Number.isNaN(value) || value < 0)
      || values[4] <= 0
      || Math.abs(values[0] + values[1] + values[2] - values[4]) > 0.009
      || values[3] > values[4])
    if (invalid) return toast.error(`Check the marks configuration for ${invalid.subject.name}`)
    const baseOrder = (examSubjectsQuery.data?.length ?? 0) * 10
    const { error } = await db.from('result_exam_subjects').insert(rows.map(({ subject, values, index }) => ({
      exam_id: examId, subject_id: subject.id,
      creative_max: values[0], written_max: values[1], practical_max: values[2], pass_mark: values[3],
      sort_order: baseOrder + index * 10,
    })))
    if (error) return toast.error(error.message)
    setConfigDialog(false); setConfigRows({})
    await qc.invalidateQueries({ queryKey: ['result-exam-subjects', examId] })
    toast.success(`${selected.length} subject${selected.length === 1 ? '' : 's'} added to the exam`)
  }

  const saveMarks = useMutation({
    scope: { id: 'result-marks-autosave' },
    mutationFn: async ({ marksExamId, studentId, subjects, nextDrafts }: {
      marksExamId: string
      studentId: string
      subjects: ExamSubject[]
      nextDrafts: Record<string, MarkDraft>
    }) => {
      const parseMark = (value: string, max: number, subject: string, component: string) => {
        if (value.trim() === '') return null
        const mark = Number(value)
        if (!Number.isFinite(mark) || mark < 0 || mark > max) {
          throw new Error(`${subject} ${component} marks must be between 0 and ${max}`)
        }
        return mark
      }
      const rows = subjects.map(examSubject => ({
        exam_subject_id: examSubject.id, student_id: studentId,
        creative_marks: nextDrafts[examSubject.id]?.absent ? null : parseMark(nextDrafts[examSubject.id]?.creative ?? '', examSubject.creative_max, examSubject.subjects.name, 'creative'),
        written_marks: nextDrafts[examSubject.id]?.absent ? null : parseMark(nextDrafts[examSubject.id]?.written ?? '', examSubject.written_max, examSubject.subjects.name, 'MCQ'),
        practical_marks: nextDrafts[examSubject.id]?.absent ? null : parseMark(nextDrafts[examSubject.id]?.practical ?? '', examSubject.practical_max, examSubject.subjects.name, 'practical'),
        is_absent: nextDrafts[examSubject.id]?.absent ?? false, entered_by: user?.id,
      }))
      const { error } = await db.from('result_marks')
        .upsert(rows, { onConflict: 'exam_subject_id,student_id' })
      if (error) throw error
      return { marksExamId, studentId }
    },
    onMutate: () => setMarksSaveStatus('saving'),
    onSuccess: async result => {
      await qc.invalidateQueries({
        queryKey: ['result-student-marks', result.marksExamId, result.studentId],
        exact: true,
        refetchType: 'none',
      })
      await qc.invalidateQueries({ queryKey: ['result-preview', result.marksExamId, result.studentId] })
      await qc.invalidateQueries({ queryKey: ['result-exam-marks', result.marksExamId] })
      setMarksSaveStatus('saved')
    },
    onError: error => {
      setMarksSaveStatus('error')
      toast.error((error as Error).message)
    },
  })

  const updateMarkDraft = (examSubjectId: string, field: keyof MarkDraft, value: string | boolean) => {
    const currentDraft = draftsRef.current[examSubjectId]
      ?? { creative: '', written: '', practical: '', absent: false }
    const nextDrafts = {
      ...draftsRef.current,
      [examSubjectId]: { ...currentDraft, [field]: value },
    }
    draftsRef.current = nextDrafts
    setDrafts(nextDrafts)

    if (!selectedStudentId || !examId || !examSubjectsQuery.data || selectedExam?.status !== 'draft' || !canWrite) return
    if (marksSaveTimerRef.current !== null) window.clearTimeout(marksSaveTimerRef.current)
    setMarksSaveStatus('saving')
    const subjects = examSubjectsQuery.data
    const studentId = selectedStudentId
    const marksExamId = examId
    marksSaveTimerRef.current = window.setTimeout(() => {
      marksSaveTimerRef.current = null
      saveMarks.mutate({ marksExamId, studentId, subjects, nextDrafts })
    }, 400)
  }

  const getOrCreateShareLink = async (studentId: string): Promise<ResultShareLink> => {
    const { data: links, error: linksError } = await db.from('result_share_links')
      .select('id,token,expires_at')
      .eq('exam_id', examId)
      .eq('student_id', studentId)
      .is('revoked_at', null)
      .order('created_at', { ascending: false })
      .limit(1)
    if (linksError) throw linksError

    const existing = (links?.[0] ?? null) as ResultShareLink | null
    if (existing && (!existing.expires_at || new Date(existing.expires_at).getTime() > Date.now())) return existing

    const expiresAt = new Date(Date.now() + 30 * 86400000).toISOString()
    const { data: token, error: createError } = await db.rpc('create_result_share_link', {
      p_exam_id: examId, p_student_id: studentId, p_expires_at: expiresAt,
    })
    if (createError) throw createError

    const { data: created, error: createdError } = await db.from('result_share_links')
      .select('id,token,expires_at').eq('token', token).single()
    if (createdError) throw createdError
    return created as ResultShareLink
  }

  const sendPublishedResultNotifications = async (): Promise<ResultSmsSummary> => {
    const summary: ResultSmsSummary = { submitted: 0, skipped: 0, failed: 0, missingPhone: 0 }
    const roster = studentsQuery.data ?? (await studentsQuery.refetch()).data ?? []
    if (!roster.length) return summary

    const { data: recipients, error } = await db.from('students')
      .select('id,first_name,last_name,guardian_phone')
      .in('id', roster.map(student => student.id))
    if (error) throw error

    for (const student of recipients ?? []) {
      const guardianPhone = String(student.guardian_phone ?? '').trim()
      if (!guardianPhone) {
        summary.missingPhone += 1
        continue
      }

      try {
        const shareLink = await getOrCreateShareLink(student.id)
        const studentName = `${student.first_name} ${student.last_name}`.trim()
        const url = `${window.location.origin}/shared-result/${shareLink.token}`
        const { data, error: smsError } = await supabase.functions.invoke('send-sms', {
          body: {
            contacts: guardianPhone,
            message: `Result published. See result of "${studentName}": ${url}`,
            source: 'result_published',
            studentId: student.id,
            resultExamId: examId,
            resultShareLinkId: shareLink.id,
          },
        })
        if (smsError) throw smsError
        summary.submitted += Number(data?.submitted ?? 0)
        summary.skipped += Number(data?.skipped ?? 0)
        summary.failed += Number(data?.failed ?? 0)
      } catch (notificationError) {
        console.error(`Could not notify guardian for student ${student.id}`, notificationError)
        summary.failed += 1
      }
    }
    return summary
  }

  const setStatus = async (status: 'draft' | 'published') => {
    if (publishing) return
    if (status === 'published') setPublishing(true)
    try {
      const { error } = await db.from('result_exams').update({ status }).eq('id', examId)
      if (error) return toast.error(error.message)
      await qc.invalidateQueries({ queryKey: ['result-exams', classId] })
      await qc.invalidateQueries({ queryKey: ['result-preview', examId] })

      if (status === 'draft') {
        toast.success('Result returned to draft')
        return
      }

      const summary = await sendPublishedResultNotifications()
      const details = [`${summary.submitted} SMS submitted`]
      if (summary.skipped) details.push(`${summary.skipped} already sent`)
      if (summary.missingPhone) details.push(`${summary.missingPhone} without guardian phone`)
      if (summary.failed) details.push(`${summary.failed} failed`)
      const message = `Results published. ${details.join(', ')}.`
      if (summary.failed) toast.warning(message)
      else toast.success(message)
    } catch (error) {
      toast.error(`Results were published, but guardian notification failed: ${(error as Error).message}`)
    } finally {
      setPublishing(false)
    }
  }

  const createShareLink = async () => {
    if (!selectedStudentId) return toast.error('Select a student first')
    const { data, error } = await db.rpc('create_result_share_link', {
      p_exam_id: examId, p_student_id: selectedStudentId, p_expires_at: new Date(Date.now() + 30 * 86400000).toISOString(),
    })
    if (error) return toast.error(error.message)
    const url = `${window.location.origin}/shared-result/${data}`
    setShareUrl(url)
    await navigator.clipboard.writeText(url)
    toast.success('Guardian link copied; it expires in 30 days')
  }

  const unusedSubjects = useMemo(() => subjectsQuery.data?.filter(subject => subject.is_active && !examSubjectsQuery.data?.some(item => item.subject_id === subject.id)) ?? [], [subjectsQuery.data, examSubjectsQuery.data])
  if (classesLoading) return <LoadingState />

  return (
    <div className="student-report-screen">
      <PageHeader title="Student Results" description="Configure exams, enter component marks, publish report cards, and share guardian links." />
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="w-full sm:max-w-md"><Label>Class and academic session</Label><Select value={classId} onValueChange={value => { setClassId(value); setExamId(''); setSelectedStudentId(''); setActiveTab('exams') }}><SelectTrigger className="mt-1"><SelectValue placeholder="Select class" /></SelectTrigger><SelectContent>{classes.map(item => <SelectItem key={item.id} value={item.id}>{item.name} ({item.grade}-{item.section}) · {item.academic_years?.name}</SelectItem>)}</SelectContent></Select></div>
        {canWrite && <Button onClick={() => setExamDialog(true)} disabled={!classId}><FilePlus2 className="mr-2 h-4 w-4" /> New exam</Button>}
      </div>

      {!classId ? <EmptyState title="Select a class" /> : examsQuery.isLoading ? <LoadingState /> : examsQuery.error ? <ErrorState message={(examsQuery.error as Error).message} /> : (
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="w-full justify-start overflow-x-auto sm:w-auto">
            <TabsTrigger value="exams">Examinations</TabsTrigger>
            <TabsTrigger value="workspace" disabled={!selectedExam}>Marks workspace</TabsTrigger>
            <TabsTrigger value="preview" disabled={!selectedStudentId}>Report card</TabsTrigger>
            <TabsTrigger value="results" disabled={!selectedExam}>All results</TabsTrigger>
            {isAdmin && <TabsTrigger value="catalog"><Settings2 className="h-4 w-4" /> Subjects & types</TabsTrigger>}
          </TabsList>
          <TabsContent value="exams" className="mt-4">
            {!examsQuery.data?.length ? <EmptyState title="No examinations" description="Create the first exam for this class." /> : <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{examsQuery.data.map(exam => (
              <Card key={exam.id} className={exam.id === examId ? 'border-primary' : undefined}>
                <CardHeader className="pb-3"><div className="flex items-start justify-between gap-2"><div><CardTitle className="text-base">{exam.title || exam.result_exam_types.name}</CardTitle><CardDescription>{exam.exam_date} · {exam.academic_years.name}</CardDescription></div><Badge variant={exam.status === 'published' ? 'default' : 'secondary'}>{exam.status}</Badge></div></CardHeader>
                <CardContent><Button className="w-full" variant={exam.id === examId ? 'default' : 'outline'} onClick={() => { setExamId(exam.id); setSelectedStudentId(''); setActiveTab('workspace') }}><Eye className="mr-2 h-4 w-4" /> Manage exam</Button></CardContent>
              </Card>
            ))}</div>}
          </TabsContent>

          <TabsContent value="workspace" className="mt-4 space-y-4">
            {selectedExam && <Card><CardHeader><div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div><CardTitle>{selectedExam.title || selectedExam.result_exam_types.name}</CardTitle><CardDescription>{selectedExam.classes.name} · {selectedExam.exam_date}</CardDescription></div><div className="flex flex-wrap gap-2">{canWrite && selectedExam.status === 'draft' && <Button variant="outline" onClick={openSubjectConfiguration} disabled={!unusedSubjects.length || publishing}><Plus className="mr-2 h-4 w-4" /> Configure subjects</Button>}{canWrite && <Button disabled={publishing} onClick={() => setStatus(selectedExam.status === 'published' ? 'draft' : 'published')}><Send className="mr-2 h-4 w-4" /> {publishing ? 'Publishing & sending SMS…' : selectedExam.status === 'published' ? 'Unpublish' : 'Publish results'}</Button>}</div></div></CardHeader></Card>}

            {!examSubjectsQuery.data?.length ? <EmptyState title="No subjects configured" description="Add subjects to this exam and define their component marks." /> : <>
              <Card><CardHeader><CardTitle className="text-base">Select student</CardTitle><CardDescription>All configured subjects will appear together for the selected student.</CardDescription></CardHeader><CardContent><Select value={selectedStudentId} onValueChange={value => { setSelectedStudentId(value); setShareUrl('') }}><SelectTrigger className="max-w-xl"><SelectValue placeholder="Choose student by ID, name, or roll" /></SelectTrigger><SelectContent>{studentsQuery.data?.map(student => <SelectItem key={student.id} value={student.id}>{student.admission_number} · {student.first_name} {student.last_name} · Roll {student.roll_number ?? '—'}</SelectItem>)}</SelectContent></Select></CardContent></Card>
              {!selectedStudentId ? <EmptyState title="Choose a student to enter marks" description="You will see every subject serially in one table." /> : <Card><CardHeader><CardTitle className="text-base">All subject marks</CardTitle><CardDescription>{studentsQuery.data?.find(student => student.id === selectedStudentId)?.admission_number} · {studentsQuery.data?.find(student => student.id === selectedStudentId)?.first_name} {studentsQuery.data?.find(student => student.id === selectedStudentId)?.last_name}</CardDescription></CardHeader><CardContent className="p-0"><div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead className="min-w-48">Subject</TableHead><TableHead className="w-32">Creative</TableHead><TableHead className="w-32">MCQ</TableHead><TableHead className="w-32">Practical</TableHead><TableHead className="w-24 text-center">Absent</TableHead><TableHead className="text-right">Total</TableHead></TableRow></TableHeader><TableBody>{examSubjectsQuery.data.map(examSubject => {
                const draft = drafts[examSubject.id] ?? { creative: '', written: '', practical: '', absent: false }
                const total = [draft.creative, draft.written, draft.practical].reduce((sum, value) => sum + (Number(value) || 0), 0)
                const update = (field: keyof MarkDraft, value: string | boolean) => updateMarkDraft(examSubject.id, field, value)
                return <TableRow key={examSubject.id}><TableCell><p className="font-medium">{examSubject.subjects.name}</p><p className="text-xs text-muted-foreground">{examSubject.subjects.code} · Pass {examSubject.pass_mark} / {examSubject.creative_max + examSubject.written_max + examSubject.practical_max}</p></TableCell><MarkInput value={draft.creative} max={examSubject.creative_max} disabled={draft.absent || selectedExam?.status === 'published' || !canWrite} onChange={value => update('creative', value)} /><MarkInput value={draft.written} max={examSubject.written_max} disabled={draft.absent || selectedExam?.status === 'published' || !canWrite} onChange={value => update('written', value)} /><MarkInput value={draft.practical} max={examSubject.practical_max} disabled={draft.absent || selectedExam?.status === 'published' || !canWrite} onChange={value => update('practical', value)} /><TableCell className="text-center"><Checkbox checked={draft.absent} disabled={selectedExam?.status === 'published' || !canWrite} onCheckedChange={checked => update('absent', Boolean(checked))} /></TableCell><TableCell className="text-right font-semibold">{draft.absent ? 'Absent' : total}</TableCell></TableRow>
              })}</TableBody></Table></div>{canWrite && selectedExam?.status === 'draft' && <div className="flex flex-col gap-2 border-t p-4 sm:flex-row sm:items-center sm:justify-between"><p className={`text-sm ${marksSaveStatus === 'error' ? 'text-destructive' : 'text-muted-foreground'}`} aria-live="polite">{marksSaveStatus === 'saving' ? 'Saving changes...' : marksSaveStatus === 'saved' ? 'All changes saved' : marksSaveStatus === 'error' ? 'Could not save changes' : 'Changes save automatically'}</p><Button variant="outline" onClick={() => setActiveTab('preview')}><Eye className="mr-2 h-4 w-4" /> Preview report</Button></div>}</CardContent></Card>}
            </>}

            {selectedStudentId && <Card><CardHeader><CardTitle className="text-base">Report card and guardian link</CardTitle><CardDescription>Guardian links are available after publication and expire after 30 days.</CardDescription></CardHeader><CardContent><div className="flex flex-wrap gap-2"><Button variant="outline" onClick={() => setActiveTab('preview')}><Eye className="mr-2 h-4 w-4" /> View report card</Button>{canWrite && selectedExam?.status === 'published' && <Button variant="outline" onClick={createShareLink}><Link2 className="mr-2 h-4 w-4" /> Create guardian link</Button>}</div>{shareUrl && <div className="mt-3 flex items-center gap-2 rounded-md border bg-muted/40 p-2"><Input readOnly value={shareUrl} /><Button size="icon" variant="ghost" onClick={() => navigator.clipboard.writeText(shareUrl)}><Copy className="h-4 w-4" /></Button></div>}</CardContent></Card>}
          </TabsContent>

          <TabsContent value="results" className="mt-4">
            <Card>
              <CardHeader>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <CardTitle>All student results</CardTitle>
                    <CardDescription>
                      {selectedExam?.title || selectedExam?.result_exam_types.name} · {selectedExam?.classes.name} · {selectedExam?.exam_date}
                    </CardDescription>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" variant="outline" onClick={exportExamResults} disabled={!examResultRows.length || examMarksQuery.isLoading}>
                      <Download className="mr-2 h-4 w-4" /> Export CSV
                    </Button>
                    <Button type="button" variant="outline" onClick={printExamResults} disabled={!examResultRows.length || examMarksQuery.isLoading}>
                      <Printer className="mr-2 h-4 w-4" /> Print Report
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                {examMarksQuery.isLoading || studentsQuery.isLoading ? <LoadingState message="Loading all student results..." />
                  : examMarksQuery.error ? <ErrorState message={(examMarksQuery.error as Error).message} />
                    : studentsQuery.error ? <ErrorState message={(studentsQuery.error as Error).message} />
                      : examResultRows.length === 0 ? <EmptyState title="No students found" description="No students belong to this exam roster." />
                        : <div className="overflow-x-auto"><Table className="min-w-max"><TableHeader><TableRow><TableHead className="sticky left-0 z-20 w-12 bg-background text-center">SN</TableHead><TableHead className="sticky left-12 z-20 w-16 bg-background">Roll</TableHead><TableHead className="sticky left-28 z-20 min-w-48 bg-background">Student</TableHead><TableHead className="min-w-32">Admission No.</TableHead>{examSubjectsQuery.data?.map(subject => <TableHead key={subject.id} className="min-w-28 text-center"><span className="block">{subject.subjects.code}</span><span className="block text-[10px] font-normal text-muted-foreground">/{examSubjectTotal(subject)}</span></TableHead>)}<TableHead className="min-w-24 text-center">Total</TableHead><TableHead className="min-w-20 text-center">GPA</TableHead><TableHead className="min-w-24 text-center">Grade</TableHead><TableHead className="min-w-20 text-center">Position</TableHead></TableRow></TableHeader><TableBody>{examResultRows.map((row, index) => <TableRow key={row.id}><TableCell className="sticky left-0 z-10 bg-card text-center text-muted-foreground">{index + 1}</TableCell><TableCell className="sticky left-12 z-10 bg-card">{row.roll ?? '—'}</TableCell><TableCell className="sticky left-28 z-10 bg-card font-medium">{row.name}</TableCell><TableCell className="font-mono text-sm">{row.admission}</TableCell>{examSubjectsQuery.data?.map(subject => <TableCell key={subject.id} className="text-center">{examSubjectResultText(row, subject)}</TableCell>)}<TableCell className="text-center font-semibold">{row.complete ? `${row.totalObtained} / ${row.totalMax}` : '—'}</TableCell><TableCell className="text-center font-semibold">{row.gpa == null ? '—' : row.gpa.toFixed(2)}</TableCell><TableCell className="text-center"><Badge variant={!row.complete ? 'secondary' : row.grade === 'F' ? 'destructive' : 'default'}>{row.grade}</Badge></TableCell><TableCell className="text-center font-semibold">{row.position ?? '—'}</TableCell></TableRow>)}</TableBody></Table></div>}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="preview" className="mt-4">{previewQuery.isLoading ? <LoadingState /> : previewQuery.error ? <ErrorState message={(previewQuery.error as Error).message} /> : previewQuery.data ? <><div className="mb-3 flex justify-end"><Button variant="outline" onClick={() => window.print()}><Printer className="mr-2 h-4 w-4" /> Print</Button></div><ResultSheet result={previewQuery.data} /></> : null}</TabsContent>

          {isAdmin && <TabsContent value="catalog" className="mt-4 grid gap-4 xl:grid-cols-2">
            <Card><CardHeader><div className="flex items-start justify-between gap-3"><div><CardTitle>Class subjects</CardTitle><CardDescription>{selectedClass?.name}: {subjectsQuery.data?.length ?? 0} subjects</CardDescription></div><Button size="sm" onClick={() => { setEditingSubjectId(null); setSubjectForm({ name: '', code: '' }); setSubjectDialog(true) }}><Plus className="mr-2 h-4 w-4" /> Add</Button></div></CardHeader><CardContent className="p-0">{!subjectsQuery.data?.length ? <EmptyState title="No subjects" /> : <Table><TableHeader><TableRow><TableHead>Subject</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader><TableBody>{subjectsQuery.data.map(subject => <TableRow key={subject.id}><TableCell><p className="font-medium">{subject.name}</p><p className="text-xs text-muted-foreground">{subject.code}</p></TableCell><TableCell><Badge variant={subject.is_active ? 'default' : 'secondary'}>{subject.is_active ? 'Active' : 'Inactive'}</Badge></TableCell><TableCell><div className="flex justify-end gap-1"><Button size="icon" variant="ghost" title="Edit" onClick={() => { setEditingSubjectId(subject.id); setSubjectForm({ name: subject.name, code: subject.code }); setSubjectDialog(true) }}><Pencil className="h-4 w-4" /></Button><Button size="icon" variant="ghost" title={subject.is_active ? 'Deactivate' : 'Activate'} onClick={() => toggleSubject(subject)}><Power className="h-4 w-4" /></Button><Button size="icon" variant="ghost" title="Delete" onClick={() => deleteSubject(subject)}><Trash2 className="h-4 w-4 text-destructive" /></Button></div></TableCell></TableRow>)}</TableBody></Table>}</CardContent></Card>
            <Card><CardHeader><div className="flex items-start justify-between gap-3"><div><CardTitle>Exam types</CardTitle><CardDescription>Reusable examination categories for every class.</CardDescription></div><Button size="sm" onClick={() => { setEditingTypeId(null); setTypeForm({ name: '', sortOrder: '0', isActive: true }); setTypeDialog(true) }}><Plus className="mr-2 h-4 w-4" /> Add</Button></div></CardHeader><CardContent className="p-0"><Table><TableHeader><TableRow><TableHead>Type</TableHead><TableHead>Order</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader><TableBody>{examTypesQuery.data?.map(type => <TableRow key={type.id}><TableCell className="font-medium">{type.name}</TableCell><TableCell>{type.sort_order}</TableCell><TableCell><Badge variant={type.is_active ? 'default' : 'secondary'}>{type.is_active ? 'Active' : 'Inactive'}</Badge></TableCell><TableCell><div className="flex justify-end gap-1"><Button size="icon" variant="ghost" title="Edit" onClick={() => { setEditingTypeId(type.id); setTypeForm({ name: type.name, sortOrder: String(type.sort_order), isActive: type.is_active }); setTypeDialog(true) }}><Pencil className="h-4 w-4" /></Button><Button size="icon" variant="ghost" title={type.is_active ? 'Deactivate' : 'Activate'} onClick={() => toggleExamType(type)}><Power className="h-4 w-4" /></Button><Button size="icon" variant="ghost" title="Delete" onClick={() => deleteExamType(type)}><Trash2 className="h-4 w-4 text-destructive" /></Button></div></TableCell></TableRow>)}</TableBody></Table></CardContent></Card>
          </TabsContent>}
        </Tabs>
      )}

      <SimpleDialog open={examDialog} onOpenChange={setExamDialog} title="Create examination" description="Create a draft exam for the selected class." onSave={createExam} saveLabel="Create exam"><Label>Exam type</Label><Select value={examForm.typeId} onValueChange={value => setExamForm(current => ({ ...current, typeId: value }))}><SelectTrigger><SelectValue placeholder="Select type" /></SelectTrigger><SelectContent>{examTypesQuery.data?.filter(type => type.is_active).map(type => <SelectItem key={type.id} value={type.id}>{type.name}</SelectItem>)}</SelectContent></Select><Label>Custom title (optional)</Label><Input value={examForm.title} onChange={event => setExamForm(current => ({ ...current, title: event.target.value }))} placeholder="e.g. First Monthly Exam" /><Label>Exam date</Label><Input type="date" value={examForm.date} min={selectedClass?.academic_years?.start_date} max={selectedClass?.academic_years?.end_date} onChange={event => setExamForm(current => ({ ...current, date: event.target.value }))} /></SimpleDialog>
      <SimpleDialog open={subjectDialog} onOpenChange={open => { setSubjectDialog(open); if (!open) setEditingSubjectId(null) }} title={editingSubjectId ? 'Edit class subject' : 'Add class subject'} description="Only full administrators can maintain subjects." onSave={saveSubject} saveLabel={editingSubjectId ? 'Save changes' : 'Add subject'}><Label>Subject name</Label><Input value={subjectForm.name} onChange={event => setSubjectForm(current => ({ ...current, name: event.target.value }))} placeholder="Bangla" /><Label>Subject code</Label><Input value={subjectForm.code} onChange={event => setSubjectForm(current => ({ ...current, code: event.target.value }))} placeholder="BAN-101" /></SimpleDialog>
      <SimpleDialog open={typeDialog} onOpenChange={open => { setTypeDialog(open); if (!open) setEditingTypeId(null) }} title={editingTypeId ? 'Edit exam type' : 'Add exam type'} description="Examples: Mid Term, Final, Test, Monthly Exam." onSave={saveExamType} saveLabel={editingTypeId ? 'Save changes' : 'Add type'}><Label>Name</Label><Input value={typeForm.name} onChange={event => setTypeForm(current => ({ ...current, name: event.target.value }))} placeholder="Practical Test" /><NumberField label="Display order" value={typeForm.sortOrder} onChange={value => setTypeForm(current => ({ ...current, sortOrder: value }))} /><div className="flex items-center gap-2"><Checkbox checked={typeForm.isActive} onCheckedChange={checked => setTypeForm(current => ({ ...current, isActive: Boolean(checked) }))} /><Label>Active and available for new exams</Label></div></SimpleDialog>
      <Dialog open={configDialog} onOpenChange={setConfigDialog}>
        <DialogContent className="max-h-[90vh] overflow-hidden sm:max-w-5xl">
          <DialogHeader><DialogTitle>Configure exam subjects</DialogTitle><DialogDescription>Select one or more subjects and keep separate creative, MCQ, practical, and pass marks for each.</DialogDescription></DialogHeader>
          <div className="overflow-auto rounded-md border">
            <Table>
              <TableHeader><TableRow><TableHead className="w-12"><Checkbox checked={unusedSubjects.length > 0 && unusedSubjects.every(subject => configRows[subject.id]?.selected)} onCheckedChange={checked => setConfigRows(current => Object.fromEntries(unusedSubjects.map(subject => [subject.id, { ...current[subject.id], selected: Boolean(checked) }]))) } aria-label="Select all subjects" /></TableHead><TableHead className="min-w-48">Subject</TableHead><TableHead className="w-32">Creative max</TableHead><TableHead className="w-32">MCQ max</TableHead><TableHead className="w-32">Practical max</TableHead><TableHead className="w-32">Pass mark</TableHead><TableHead className="w-32">Total max</TableHead></TableRow></TableHeader>
              <TableBody>{unusedSubjects.map(subject => {
                const row = configRows[subject.id] ?? { selected: false, creative: '40', written: '40', practical: '20', pass: '33', total: '100' }
                const update = (field: keyof ExamSubjectConfigDraft, value: string | boolean) => setConfigRows(current => ({ ...current, [subject.id]: { ...row, [field]: value } }))
                const updateComponent = (field: 'creative' | 'written' | 'practical', value: string) => {
                  const next = { ...row, [field]: value }
                  next.total = String((Number(next.creative) || 0) + (Number(next.written) || 0) + (Number(next.practical) || 0))
                  setConfigRows(current => ({ ...current, [subject.id]: next }))
                }
                const updateTotal = (value: string) => {
                  const requested = Number(value)
                  const currentValues = [Number(row.creative) || 0, Number(row.written) || 0, Number(row.practical) || 0]
                  const currentTotal = currentValues.reduce((sum, item) => sum + item, 0)
                  if (!Number.isFinite(requested) || requested < 0 || currentTotal <= 0) {
                    update('total', value)
                    return
                  }
                  const creative = Math.round((currentValues[0] / currentTotal) * requested * 100) / 100
                  const practical = Math.round((currentValues[2] / currentTotal) * requested * 100) / 100
                  const written = Math.round((requested - creative - practical) * 100) / 100
                  const pass = Math.round(((Number(row.pass) || 0) / currentTotal) * requested * 100) / 100
                  setConfigRows(current => ({ ...current, [subject.id]: {
                    ...row, total: value, creative: String(creative), written: String(written), practical: String(practical), pass: String(pass),
                  } }))
                }
                return <TableRow key={subject.id} className={row.selected ? 'bg-primary/5' : undefined}><TableCell><Checkbox checked={row.selected} onCheckedChange={checked => update('selected', Boolean(checked))} aria-label={`Select ${subject.name}`} /></TableCell><TableCell><p className="font-medium">{subject.name}</p><p className="text-xs text-muted-foreground">{subject.code}</p></TableCell><TableCell><Input type="number" min={0} step="0.01" value={row.creative} disabled={!row.selected} onChange={event => updateComponent('creative', event.target.value)} /></TableCell><TableCell><Input type="number" min={0} step="0.01" value={row.written} disabled={!row.selected} onChange={event => updateComponent('written', event.target.value)} /></TableCell><TableCell><Input type="number" min={0} step="0.01" value={row.practical} disabled={!row.selected} onChange={event => updateComponent('practical', event.target.value)} /></TableCell><TableCell><Input type="number" min={0} max={row.total} step="0.01" value={row.pass} disabled={!row.selected} onChange={event => update('pass', event.target.value)} /></TableCell><TableCell><Input type="number" min={0.01} step="0.01" value={row.total} disabled={!row.selected} onChange={event => updateTotal(event.target.value)} /></TableCell></TableRow>
              })}</TableBody>
            </Table>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setConfigDialog(false)}>Cancel</Button><Button onClick={() => void attachSubjects()} disabled={!unusedSubjects.some(subject => configRows[subject.id]?.selected)}>Add {unusedSubjects.filter(subject => configRows[subject.id]?.selected).length || ''} selected subject{unusedSubjects.filter(subject => configRows[subject.id]?.selected).length === 1 ? '' : 's'}</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      {selectedExam && examResultRows.length > 0 && examSubjectsQuery.data && (
        <div className="student-report-print" aria-hidden="true">
          <header className="print-report-header">
            <div>
              <h1>Examination Results Report</h1>
              <p>{selectedExam.title || selectedExam.result_exam_types.name} · {selectedExam.classes.name}</p>
            </div>
            <dl>
              <dt>Exam date</dt><dd>{selectedExam.exam_date}</dd>
              <dt>Students</dt><dd>{examResultRows.length}</dd>
              <dt>Complete results</dt><dd>{examResultRows.filter(row => row.complete).length}</dd>
              <dt>Generated</dt><dd>{format(new Date(), 'dd MMM yyyy, hh:mm a')}</dd>
            </dl>
          </header>
          <section className="print-summary-section">
            <div className="print-section-heading">
              <h2>Student Results</h2>
              <p>Subject totals, overall result, GPA, grade, and class position</p>
            </div>
            <table className="print-summary-table exam-results-print-table">
              <thead><tr><th>SN</th><th>Roll</th><th>Student</th><th>Admission</th>{examSubjectsQuery.data.map(subject => <th key={subject.id}>{subject.subjects.code}<br />/{examSubjectTotal(subject)}</th>)}<th>Total</th><th>GPA</th><th>Grade</th><th>Pos.</th></tr></thead>
              <tbody>{examResultRows.map((row, index) => <tr key={row.id}><td>{index + 1}</td><td>{row.roll ?? '-'}</td><td>{row.name}</td><td>{row.admission}</td>{examSubjectsQuery.data!.map(subject => <td key={subject.id}>{examSubjectResultText(row, subject)}</td>)}<td>{row.complete ? `${row.totalObtained}/${row.totalMax}` : '-'}</td><td>{row.gpa == null ? '-' : row.gpa.toFixed(2)}</td><td>{row.grade}</td><td>{row.position ?? '-'}</td></tr>)}</tbody>
            </table>
            <p className="print-footnote">A dash indicates an incomplete result. Subject columns show obtained marks over the configured maximum.</p>
          </section>
        </div>
      )}
    </div>
  )
}

function MarkInput({ value, max, disabled, onChange }: { value: string; max: number; disabled: boolean; onChange: (value: string) => void }) {
  const normalizeMark = (input: string) => {
    const digitsAndDecimal = input.replace(/[^\d.]/g, '')
    const decimalIndex = digitsAndDecimal.indexOf('.')
    const normalized = decimalIndex < 0
      ? digitsAndDecimal
      : `${digitsAndDecimal.slice(0, decimalIndex)}.${digitsAndDecimal.slice(decimalIndex + 1).replace(/\./g, '').slice(0, 2)}`
    const withLeadingZero = normalized.startsWith('.') ? `0${normalized}` : normalized
    const numericValue = Number(withLeadingZero)
    return withLeadingZero !== '' && Number.isFinite(numericValue) && numericValue > max
      ? String(max)
      : withLeadingZero
  }

  return (
    <TableCell>
      <Input
        type="number"
        inputMode="decimal"
        min={0}
        max={max}
        step={0.5}
        value={value}
        disabled={disabled || max <= 0}
        placeholder={max <= 0 ? 'N/A' : `/${max}`}
        onKeyDown={event => {
          if (!event.ctrlKey && !event.metaKey && !event.altKey && event.key.length === 1 && !/[0-9.]/.test(event.key)) event.preventDefault()
        }}
        onPaste={event => {
          if (!/^\d*\.?\d*$/.test(event.clipboardData.getData('text'))) event.preventDefault()
        }}
        onChange={event => onChange(normalizeMark(event.target.value))}
      />
    </TableCell>
  )
}

function NumberField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <div><Label>{label}</Label><Input type="number" min={0} step="0.01" value={value} onChange={event => onChange(event.target.value)} /></div>
}

function SimpleDialog({ open, onOpenChange, title, description, onSave, saveLabel, children }: { open: boolean; onOpenChange: (open: boolean) => void; title: string; description: string; onSave: () => unknown | Promise<unknown>; saveLabel: string; children: React.ReactNode }) {
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent><DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription>{description}</DialogDescription></DialogHeader><div className="space-y-3">{children}</div><DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button><Button onClick={() => void onSave()}>{saveLabel}</Button></DialogFooter></DialogContent></Dialog>
}
