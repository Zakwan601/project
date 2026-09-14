import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, CheckCircle2, ChevronRight, ClipboardList, Copy, Download, EllipsisVertical, Eye, Link2, Pencil, Plus, Printer, Search, Send, Settings, Users } from 'lucide-react'
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
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import type { ClassGroup, ResultExam, ResultExamType, StudentResultPayload, Student } from '@/types/database'
import { downloadCsv } from '@/lib/csv'


const db = supabase as any

interface ExamWithDetails extends ResultExam {
  result_exam_types: { name: string }
  academic_years: { name: string }
  classes: { name: string; grade: string; section: string; class_group: ClassGroup }
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
  class_group: ClassGroup
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
  const { examId: routeExamId } = useParams<{ examId: string }>()
  const navigate = useNavigate()
  const isExamPage = Boolean(routeExamId)
  const { user, can, role } = useAuth()
  const canWrite = can('results', 'write')
  const qc = useQueryClient()
  const { data: classes = [], isLoading: classesLoading } = useClasses()
  const [activeTab, setActiveTab] = useState(isExamPage ? 'marks' : 'overview')
  const [classId, setClassId] = useState('')
  const [examId, setExamId] = useState('')
  const [selectedStudentId, setSelectedStudentId] = useState('')
  const [studentSearch, setStudentSearch] = useState('')
  const [examDialog, setExamDialog] = useState(false)
  const [subjectDialog, setSubjectDialog] = useState(false)
  const [settingsDialog, setSettingsDialog] = useState(false)
  const [configDialog, setConfigDialog] = useState(false)
  const [configureAfterCreateExamId, setConfigureAfterCreateExamId] = useState<string | null>(null)
  const [typeDialog, setTypeDialog] = useState(false)
  const [editingSubjectId, setEditingSubjectId] = useState<string | null>(null)
  const [editingTypeId, setEditingTypeId] = useState<string | null>(null)
  const [examForm, setExamForm] = useState({ classIds: [] as string[], typeId: '', title: '', date: '' })
  const [subjectForm, setSubjectForm] = useState({ name: '', code: '' })
  const [settingsGroup, setSettingsGroup] = useState<ClassGroup>('science')
  const [typeForm, setTypeForm] = useState({ name: '', sortOrder: '0', isActive: true })
  const [configRows, setConfigRows] = useState<Record<string, ExamSubjectConfigDraft>>({})
  const [drafts, setDrafts] = useState<Record<string, MarkDraft>>({})
  const [marksSaveStatus, setMarksSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const draftsRef = useRef<Record<string, MarkDraft>>({})
  const marksSaveTimerRef = useRef<number | null>(null)
  const [shareUrl, setShareUrl] = useState('')
  const [publishing, setPublishing] = useState(false)
  const [mobileRosterOpen, setMobileRosterOpen] = useState(false)

  const examClasses = useMemo(
    () => classes.filter(item => item.is_active && item.academic_year_id),
    [classes],
  )
  const selectedExamClasses = useMemo(
    () => examClasses.filter(item => examForm.classIds.includes(item.id)),
    [examClasses, examForm.classIds],
  )
  const examDateMin = selectedExamClasses.reduce<string | undefined>((latest, item) => {
    const start = item.academic_years?.start_date
    return start && (!latest || start > latest) ? start : latest
  }, undefined)
  const examDateMax = selectedExamClasses.reduce<string | undefined>((earliest, item) => {
    const end = item.academic_years?.end_date
    return end && (!earliest || end < earliest) ? end : earliest
  }, undefined)

  const examTypesQuery = useQuery<ResultExamType[]>({
    queryKey: ['result-exam-types'],
    queryFn: async () => {
      const { data, error } = await db.from('result_exam_types').select('*').order('sort_order').order('name')
      if (error) throw error
      return data as ResultExamType[]
    },
  })

  const routeExamQuery = useQuery<ExamWithDetails>({
    queryKey: ['result-exam', routeExamId],
    enabled: Boolean(routeExamId),
    queryFn: async () => {
      const { data, error } = await db.from('result_exams')
        .select('*, result_exam_types(name), academic_years(name), classes(name, grade, section, class_group)')
        .eq('id', routeExamId).single()
      if (error) throw error
      return data as ExamWithDetails
    },
  })

  useEffect(() => {
    if (!routeExamId) {
      setExamId('')
      setActiveTab('overview')
      return
    }
    if (!routeExamQuery.data) return
    setClassId(routeExamQuery.data.class_id)
    setExamId(routeExamId)
    setActiveTab('marks')
  }, [routeExamId, routeExamQuery.data])

  const selectedClassGroup = classes.find(item => item.id === classId)?.class_group
  const subjectGroup = isExamPage ? selectedClassGroup : settingsGroup
  const subjectsQuery = useQuery<ClassSubject[]>({
    queryKey: ['result-subjects', subjectGroup], enabled: Boolean(subjectGroup),
    queryFn: async () => {
      const { data, error } = await db.from('subjects').select('id,name,code,is_active,class_group').eq('class_group', subjectGroup).order('name')
      if (error) throw error
      return data
    },
  })

  const examsQuery = useQuery<ExamWithDetails[]>({
    queryKey: ['result-exams', isExamPage ? classId : classId || 'all'], enabled: !isExamPage || Boolean(classId),
    queryFn: async () => {
      let request = db.from('result_exams')
        .select('*, result_exam_types(name), academic_years(name), classes(name, grade, section, class_group)')
        .order('exam_date', { ascending: false })
      if (classId) request = request.eq('class_id', classId)
      const { data, error } = await request
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
    enabled: Boolean(examId && examSubjectsQuery.data?.length),
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
    if (!examForm.classIds.length || !examForm.typeId || !examForm.date) return toast.error('Select at least one class, exam type, and date')
    const invalidDateClass = selectedExamClasses.find(item => !item.academic_years
      || examForm.date < item.academic_years.start_date
      || examForm.date > item.academic_years.end_date)
    if (invalidDateClass) return toast.error(`Exam date is outside the session for ${invalidDateClass.name}`)
    const { data, error } = await db.rpc('create_result_exams_for_classes', {
      p_class_ids: examForm.classIds,
      p_exam_type_id: examForm.typeId,
      p_title: examForm.title.trim() || null,
      p_exam_date: examForm.date,
    })
    if (error) return toast.error(error.message)
    const created = data as Array<{ exam_id: string; class_id: string }>
    const firstExam = created.find(item => item.class_id === classId) ?? created[0]
    await qc.invalidateQueries({ queryKey: ['result-exams'] })
    setExamDialog(false); setExamForm({ classIds: [], typeId: '', title: '', date: '' }); setExamId(firstExam?.exam_id ?? ''); setActiveTab('marks')
    if (firstExam) {
      setConfigureAfterCreateExamId(firstExam.exam_id)
      navigate(`/results/${firstExam.exam_id}`)
    }
    toast.success(`${created.length} class exam${created.length === 1 ? '' : 's'} created. Configure marks separately for each exam.`)
  }

  const openExamDialog = () => {
    setExamForm(current => ({ ...current, classIds: classId ? [classId] : [] }))
    setExamDialog(true)
  }

  const saveSubject = async () => {
    if (!subjectForm.name.trim() || !subjectForm.code.trim()) return toast.error('Subject name and code are required')
    const payload = { name: subjectForm.name.trim(), code: subjectForm.code.trim().toUpperCase(), class_id: null, class_group: settingsGroup, is_active: true }
    const request = editingSubjectId
      ? db.from('subjects').update({ name: payload.name, code: payload.code }).eq('id', editingSubjectId)
      : db.from('subjects').insert(payload)
    const { error } = await request
    if (error) return toast.error(error.message)
    setSubjectDialog(false); setSubjectForm({ name: '', code: '' }); setEditingSubjectId(null)
    await qc.invalidateQueries({ queryKey: ['result-subjects', settingsGroup] }); toast.success(editingSubjectId ? 'Subject updated' : 'Subject added')
  }

  const editSubject = (subject: ClassSubject) => {
    setEditingSubjectId(subject.id)
    setSubjectForm({ name: subject.name, code: subject.code })
    setSubjectDialog(true)
  }

  const toggleSubject = async (subject: ClassSubject) => {
    const { error } = await db.from('subjects').update({ is_active: !subject.is_active }).eq('id', subject.id)
    if (error) return toast.error(error.message)
    await qc.invalidateQueries({ queryKey: ['result-subjects', settingsGroup] })
    toast.success(subject.is_active ? 'Subject disabled for new exams' : 'Subject enabled')
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

  const openSubjectConfiguration = () => {
    const configured = new Map((examSubjectsQuery.data ?? []).map(item => [item.subject_id, item]))
    setConfigRows(Object.fromEntries((subjectsQuery.data ?? []).filter(subject => subject.is_active || configured.has(subject.id)).map(subject => {
      const current = configured.get(subject.id)
      return [subject.id, {
        selected: Boolean(current),
        creative: current ? String(current.creative_max) : '',
        written: current ? String(current.written_max) : '',
        practical: current ? String(current.practical_max) : '',
        pass: current ? String(current.pass_mark) : '',
        total: current ? String(examSubjectTotal(current)) : '',
      }]
    })))
    setConfigDialog(true)
  }

  useEffect(() => {
    if (!configureAfterCreateExamId || examId !== configureAfterCreateExamId || subjectsQuery.isLoading || examSubjectsQuery.isLoading) return
    openSubjectConfiguration()
    setConfigureAfterCreateExamId(null)
  }, [configureAfterCreateExamId, examId, subjectsQuery.isLoading, examSubjectsQuery.isLoading])

  const saveExamSubjects = async () => {
    const available = (subjectsQuery.data ?? []).filter(subject => subject.is_active || examSubjectsQuery.data?.some(item => item.subject_id === subject.id))
    const selected = available.filter(subject => configRows[subject.id]?.selected)
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
    const { error } = await db.from('result_exam_subjects').upsert(rows.map(({ subject, values, index }) => ({
      exam_id: examId, subject_id: subject.id,
      creative_max: values[0], written_max: values[1], practical_max: values[2], pass_mark: values[3],
      sort_order: index * 10,
    })), { onConflict: 'exam_id,subject_id' })
    if (error) return toast.error(error.message)
    const removedIds = (examSubjectsQuery.data ?? []).filter(item => !selected.some(subject => subject.id === item.subject_id)).map(item => item.id)
    if (removedIds.length) {
      const { error: removeError } = await db.from('result_exam_subjects').delete().in('id', removedIds)
      if (removeError) return toast.error(removeError.message)
    }
    setConfigDialog(false); setConfigRows({})
    await qc.invalidateQueries({ queryKey: ['result-exam-subjects', examId] })
    toast.success(`Exam configured with ${selected.length} subject${selected.length === 1 ? '' : 's'}`)
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

  const configurableSubjects = useMemo(() => subjectsQuery.data?.filter(subject => subject.is_active || examSubjectsQuery.data?.some(item => item.subject_id === subject.id)) ?? [], [subjectsQuery.data, examSubjectsQuery.data])
  // Kept as a local alias while the compact exam-action markup is transitioned.
  const unusedSubjects = configurableSubjects
  const attachSubjects = saveExamSubjects
  const selectedStudent = studentsQuery.data?.find(student => student.id === selectedStudentId)
  const completedResults = examResultRows.filter(row => row.complete).length
  const filteredStudents = useMemo(() => {
    const query = studentSearch.trim().toLowerCase()
    if (!query) return studentsQuery.data ?? []
    return (studentsQuery.data ?? []).filter(student => `${student.first_name} ${student.last_name} ${student.admission_number} ${student.roll_number ?? ''}`.toLowerCase().includes(query))
  }, [studentSearch, studentsQuery.data])
  if (classesLoading || (isExamPage && routeExamQuery.isLoading)) return <LoadingState />
  if (isExamPage && routeExamQuery.error) return <ErrorState message="This examination could not be found or you do not have access to it." />

  return (
    <div className="student-report-screen min-w-0 max-w-full overflow-x-hidden">
      <section className="mb-3 ">
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3 lg:items-end">
          <div className="space-y-3">
            <div className="flex items-start gap-3">
              <div>
                <h1 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">{isExamPage ? routeExamQuery.data?.title || routeExamQuery.data?.result_exam_types.name : 'Examinations Results'}</h1><p className="mt-1 max-w-3xl text-sm text-muted-foreground">{isExamPage ? <>{routeExamQuery.data?.classes.name} · {routeExamQuery.data && format(new Date(`${routeExamQuery.data.exam_date}T00:00:00`), 'dd MMM yyyy')}{selectedExam && <> · <span className="capitalize">{selectedExam.status}</span> · {examSubjectsQuery.data?.length ?? 0} subjects · {completedResults}/{examResultRows.length} complete</>}</> : null}</p>
              </div>
            </div>
          </div>
          {isExamPage && <><div className="hidden flex-wrap items-center justify-end gap-2 sm:flex">{canWrite && selectedExam?.status === 'draft' && <Button size="sm" variant="outline" onClick={openSubjectConfiguration} disabled={!unusedSubjects.length || publishing}><Plus className="mr-2 h-4 w-4" /> Add subjects</Button>}<Button variant="outline" size="sm" onClick={() => navigate('/results')}><ArrowLeft className="mr-2 h-4 w-4" /> All examinations</Button>{canWrite && selectedExam && <Button size="sm" variant={selectedExam.status === 'published' ? 'outline' : 'default'} disabled={publishing} onClick={() => setStatus(selectedExam.status === 'published' ? 'draft' : 'published')}><Send className="mr-2 h-4 w-4" /> {publishing ? 'Working…' : selectedExam.status === 'published' ? 'Return to draft' : 'Publish results'}</Button>}</div><div className="sm:hidden"><DropdownMenu><DropdownMenuTrigger asChild><Button variant="outline" size="icon" className="h-9 w-9" aria-label="Exam actions"><EllipsisVertical className="h-4 w-4" /></Button></DropdownMenuTrigger><DropdownMenuContent align="end" className="w-48"><DropdownMenuItem onSelect={() => navigate('/results')}><ArrowLeft /> All examinations</DropdownMenuItem>{canWrite && selectedExam && <><DropdownMenuSeparator />{selectedExam.status === 'draft' && <DropdownMenuItem disabled={!unusedSubjects.length || publishing} onSelect={openSubjectConfiguration}><Plus /> Add subjects</DropdownMenuItem>}<DropdownMenuItem disabled={publishing} onSelect={() => void setStatus(selectedExam.status === 'published' ? 'draft' : 'published')}><Send /> {publishing ? 'Working…' : selectedExam.status === 'published' ? 'Return to draft' : 'Publish results'}</DropdownMenuItem></>}{activeTab === 'results' && <><DropdownMenuSeparator /><DropdownMenuItem disabled={!examResultRows.length || examMarksQuery.isLoading} onSelect={exportExamResults}><Download /> Export CSV</DropdownMenuItem><DropdownMenuItem disabled={!examResultRows.length || examMarksQuery.isLoading} onSelect={printExamResults}><Printer /> Print report</DropdownMenuItem></>}</DropdownMenuContent></DropdownMenu></div></>}
        </div>
      </section>
      {isExamPage && !classId ? <EmptyState title="Select a class" /> : examsQuery.isLoading ? <LoadingState /> : examsQuery.error ? <ErrorState message={(examsQuery.error as Error).message} /> : (
        <Tabs value={activeTab} onValueChange={setActiveTab} className="min-w-0 max-w-full">
          {isExamPage && <div className="mb-3 ">
            <TabsList className=" justify-start gap-1 bg-transparent p-0">
              <TabsTrigger value="marks" disabled={!selectedExam} className="rounded-none border-b-2 border-transparent px-3 py-2 shadow-none data-[state=active]:border-primary data-[state=active]:bg-transparent"> Enter marks</TabsTrigger>
              <TabsTrigger value="results" disabled={!selectedExam} className="rounded-none border-b-2 border-transparent px-3 py-2 shadow-none data-[state=active]:border-primary data-[state=active]:bg-transparent"> All results</TabsTrigger>
              <TabsTrigger value="preview" disabled={!selectedStudentId} className="rounded-none border-b-2 border-transparent px-3 py-2 shadow-none data-[state=active]:border-primary data-[state=active]:bg-transparent">Report card</TabsTrigger>
            </TabsList>
          </div>}
          <TabsContent value="overview" className="mt-0 space-y-5">
            {role === 'admin' && <div className="flex justify-end gap-3">
              {!isExamPage && 
                <div className="max-w-xl">
                  <Select value={classId || '__all__'} onValueChange={value => { setClassId(value === '__all__' ? '' : value); setExamId(''); setSelectedStudentId(''); setStudentSearch('') }}>
                      <SelectTrigger className="h-11">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                      <SelectItem value="__all__">All classes</SelectItem>
                      {classes.map(item => <SelectItem key={item.id} value={item.id}>{item.name} ({item.grade}-{item.section}) · {item.academic_years?.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                </div>
              }  
              <Button type="button" variant="outline" size="sm" onClick={() => setSettingsDialog(true)}><Settings className="mr-2 h-4 w-4" /> Subject Settings</Button>
              {canWrite && <Button size="sm" onClick={openExamDialog}><Plus className="mr-2 h-4 w-4" /> New examination</Button>}
            </div>}
            <Card className="border-0 bg-transparent shadow-none">
              <CardContent className="px-0 py-2">
                {!examsQuery.data?.length ? <EmptyState title="No examinations found" description={classId ? 'No examinations are available for this class.' : 'Create an examination to begin.'} /> : <div className="max-w-full overflow-x-auto"><Table className="min-w-[760px]"><TableHeader><TableRow><TableHead>Examination</TableHead><TableHead>Class</TableHead><TableHead>Session</TableHead><TableHead>Date</TableHead><TableHead>Status</TableHead><TableHead className="w-24 text-right">Action</TableHead></TableRow></TableHeader><TableBody>{examsQuery.data.map(exam => <TableRow key={exam.id} className="cursor-pointer" onClick={() => navigate(`/results/${exam.id}`)}><TableCell className="font-semibold">{exam.title || exam.result_exam_types.name}</TableCell><TableCell>{exam.classes.name}<span className="block text-xs text-muted-foreground">{exam.classes.grade}-{exam.classes.section}</span></TableCell><TableCell>{exam.academic_years.name}</TableCell><TableCell className="whitespace-nowrap">{format(new Date(`${exam.exam_date}T00:00:00`), 'dd MMM yyyy')}</TableCell><TableCell><Badge variant={exam.status === 'published' ? 'default' : 'secondary'} className="capitalize">{exam.status}</Badge></TableCell><TableCell className="text-right"><Button type="button" variant="ghost" size="sm" onClick={event => { event.stopPropagation(); navigate(`/results/${exam.id}`) }}>Manage<ChevronRight className="ml-1 h-4 w-4" /></Button></TableCell></TableRow>)}</TableBody></Table></div>}
              </CardContent>
            </Card>
          </TabsContent>
          <TabsContent value="marks" className="mt-0">
            {!examSubjectsQuery.data?.length ? <Card className="border-0 bg-transparent shadow-none"><CardContent className="py-14"><EmptyState title="Configure subjects first" description="Add the subjects and component maximums for this examination." />{canWrite && <div className="mt-4 flex justify-center"><Button onClick={openSubjectConfiguration} disabled={!unusedSubjects.length}><Plus className="mr-2 h-4 w-4" /> Configure subjects</Button></div>}</CardContent></Card> : <><div className="mb-3 xl:hidden"><Sheet open={mobileRosterOpen} onOpenChange={setMobileRosterOpen}><SheetTrigger asChild><Button variant="outline" className="w-full justify-between"><span className="flex items-center gap-2"><Users className="h-4 w-4" /> Students</span><span className="flex min-w-0 items-center gap-2 text-muted-foreground"><span className="max-w-48 truncate">{selectedStudent ? `${selectedStudent.first_name} ${selectedStudent.last_name}` : `${studentsQuery.data?.length ?? 0} available`}</span><ChevronRight className="h-4 w-4" /></span></Button></SheetTrigger><SheetContent side="left" className="w-[88%] gap-0 p-0"><SheetHeader className="border-b pr-12"><SheetTitle>Student roster</SheetTitle><SheetDescription>{studentsQuery.data?.length ?? 0} students in this class</SheetDescription><div className="relative pt-2"><Search className="absolute left-3 top-4.5 h-4 w-4 text-muted-foreground" /><Input value={studentSearch} onChange={event => setStudentSearch(event.target.value)} placeholder="Search name, roll, ID…" className="pl-9" /></div></SheetHeader><ScrollArea className="min-h-0 flex-1"><div className="space-y-1 p-2">{filteredStudents.map(student => { const result = examResultRows.find(row => row.id === student.id); const active = student.id === selectedStudentId; const initials = `${student.first_name[0] ?? ''}${student.last_name[0] ?? ''}`.toUpperCase(); return <button type="button" key={student.id} onClick={() => { setSelectedStudentId(student.id); setShareUrl(''); setMobileRosterOpen(false) }} className={`flex w-full items-center gap-3 rounded-lg p-2.5 text-left transition-colors ${active ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`}><Avatar className="h-9 w-9"><AvatarFallback className={active ? 'bg-primary-foreground/20 text-primary-foreground' : ''}>{initials}</AvatarFallback></Avatar><span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{student.first_name} {student.last_name}</span><span className={`block truncate text-xs ${active ? 'text-primary-foreground/75' : 'text-muted-foreground'}`}>Roll {student.roll_number ?? '—'} · {student.admission_number}</span></span>{result?.complete && <CheckCircle2 className={`h-4 w-4 ${active ? '' : 'text-emerald-600'}`} />}</button> })}{filteredStudents.length === 0 && <p className="p-6 text-center text-sm text-muted-foreground">No students match your search.</p>}</div></ScrollArea></SheetContent></Sheet></div><div className="grid min-w-0 xl:grid-cols-[300px_minmax(0,1fr)]">
              <Card className="hidden h-fit gap-0 rounded-none border-0 bg-transparent py-0 shadow-none xl:sticky xl:top-4 xl:flex xl:border-r xl:pr-5">
                <CardHeader className="border-b px-0 pb-3"><CardTitle className="flex items-center gap-2 text-base"><Users className="h-4 w-4" /> Student roster</CardTitle><CardDescription>{studentsQuery.data?.length ?? 0} students in this class</CardDescription><div className="relative pt-1"><Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" /><Input value={studentSearch} onChange={event => setStudentSearch(event.target.value)} placeholder="Search name, roll, ID…" className="h-9 pl-9" /></div></CardHeader>
                <ScrollArea className="h-[420px] xl:h-[600px]"><div className="space-y-1 p-2">{filteredStudents.map(student => {
                  const result = examResultRows.find(row => row.id === student.id)
                  const active = student.id === selectedStudentId
                  const initials = `${student.first_name[0] ?? ''}${student.last_name[0] ?? ''}`.toUpperCase()
                  return <button type="button" key={student.id} onClick={() => { setSelectedStudentId(student.id); setShareUrl('') }} className={`flex w-full items-center gap-3 rounded-lg p-2.5 text-left transition-colors ${active ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`}><Avatar className="h-9 w-9"><AvatarFallback className={active ? 'bg-primary-foreground/20 text-primary-foreground' : ''}>{initials}</AvatarFallback></Avatar><span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{student.first_name} {student.last_name}</span><span className={`block truncate text-xs ${active ? 'text-primary-foreground/75' : 'text-muted-foreground'}`}>Roll {student.roll_number ?? '—'} · {student.admission_number}</span></span>{result?.complete ? <CheckCircle2 className={`h-4 w-4 ${active ? '' : 'text-emerald-600'}`} /> : <span className={`h-2 w-2 rounded-full ${active ? 'bg-primary-foreground/70' : 'bg-amber-500'}`} />}</button>
                })}{filteredStudents.length === 0 && <p className="p-6 text-center text-sm text-muted-foreground">No students match your search.</p>}</div></ScrollArea>
              </Card>

              {!selectedStudentId ? <Card className="min-h-56 min-w-0 gap-0 rounded-none border-0 bg-transparent py-0 shadow-none xl:min-h-[420px]"><CardContent className="flex min-h-56 items-center justify-center xl:min-h-[420px]"><div className="max-w-sm text-center"><ClipboardList className="mx-auto mb-4 h-7 w-7 text-muted-foreground" /><h3 className="text-lg font-semibold">Select a student</h3><p className="mt-2 text-sm text-muted-foreground">Choose a student from the roster to enter marks across all configured subjects.</p></div></CardContent></Card> : <div className="min-w-0 space-y-2 pl-0 xl:pl-5">
                <Card className="gap-0 rounded-none border-0 border-b bg-transparent py-0 shadow-none"><CardContent className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 px-0 pb-3 pt-0"><div className="flex min-w-0 items-center gap-2 sm:gap-3"><Avatar className="h-8 w-8 shrink-0 sm:h-9 sm:w-9"><AvatarFallback>{`${selectedStudent?.first_name[0] ?? ''}${selectedStudent?.last_name[0] ?? ''}`}</AvatarFallback></Avatar><div className="min-w-0"><h3 className="truncate text-sm font-semibold sm:text-base">{selectedStudent?.first_name} {selectedStudent?.last_name}</h3><p className="truncate text-[10px] text-muted-foreground sm:text-xs">Roll {selectedStudent?.roll_number ?? '—'} · {selectedStudent?.admission_number}</p></div></div><div className="flex shrink-0 items-center gap-2"><div className="flex items-center gap-1"><span className={`whitespace-nowrap text-[10px] sm:text-xs ${marksSaveStatus === 'error' ? 'text-destructive' : 'text-muted-foreground'}`} aria-live="polite"><span className="sm:hidden">{marksSaveStatus === 'saving' ? 'Saving…' : marksSaveStatus === 'saved' ? 'Saved' : marksSaveStatus === 'error' ? 'Save failed' : 'Auto-save on'}</span><span className="hidden sm:inline">{marksSaveStatus === 'saving' ? 'Saving changes…' : marksSaveStatus === 'saved' ? 'All changes saved' : marksSaveStatus === 'error' ? 'Save failed' : 'Changes save automatically'}</span></span>{marksSaveStatus === 'saved' && <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />}</div><Button size="sm" className="whitespace-nowrap px-2.5 sm:px-3" onClick={() => setActiveTab('preview')}><Eye className="mr-1.5 h-4 w-4" /> Report card</Button></div></CardContent></Card>
                <div className="min-w-0 max-w-full overflow-hidden border-b">
                  <Table className="min-w-[520px] text-[10px] [&_td]:p-1 [&_th]:h-8 [&_th]:px-1 sm:min-w-[720px] sm:text-sm">
                    <TableHeader><TableRow><TableHead className="sticky left-0 z-20 w-28 min-w-28 border-r bg-background text-[10px] sm:w-48 sm:min-w-48 sm:text-sm">Subject</TableHead><TableHead className="w-20">Creative</TableHead><TableHead className="w-20">MCQ</TableHead><TableHead className="w-20">Practical</TableHead><TableHead className="w-14 text-center sm:w-24">Total</TableHead><TableHead className="w-12 text-center sm:w-24">Absent</TableHead></TableRow></TableHeader>
                    <TableBody>{examSubjectsQuery.data.map(examSubject => {
                      const draft = drafts[examSubject.id] ?? { creative: '', written: '', practical: '', absent: false }
                      const total = [draft.creative, draft.written, draft.practical].reduce((sum, value) => sum + (Number(value) || 0), 0)
                      const maximum = examSubject.creative_max + examSubject.written_max + examSubject.practical_max
                      const update = (field: keyof MarkDraft, value: string | boolean) => updateMarkDraft(examSubject.id, field, value)
                      const disabled = draft.absent || selectedExam?.status === 'published' || !canWrite
                      return <TableRow key={examSubject.id} className={draft.absent ? 'opacity-60' : undefined}>
                        <TableCell className="sticky left-0 z-10 w-28 min-w-28 whitespace-normal border-r bg-card text-[10px] leading-tight sm:w-48 sm:min-w-48 sm:text-sm"><p className="font-medium">{examSubject.subjects.name}</p><p className="mt-0.5 text-[9px] text-muted-foreground sm:text-xs">{examSubject.subjects.code} · Pass {examSubject.pass_mark}</p></TableCell>
                        <TableCell><MarkInput label={`${examSubject.subjects.name} creative marks`} value={draft.creative} max={examSubject.creative_max} disabled={disabled} onChange={value => update('creative', value)} /></TableCell>
                        <TableCell><MarkInput label={`${examSubject.subjects.name} MCQ marks`} value={draft.written} max={examSubject.written_max} disabled={disabled} onChange={value => update('written', value)} /></TableCell>
                        <TableCell><MarkInput label={`${examSubject.subjects.name} practical marks`} value={draft.practical} max={examSubject.practical_max} disabled={disabled} onChange={value => update('practical', value)} /></TableCell>
                        <TableCell className="text-center text-[10px]"><span className="font-semibold tabular-nums">{draft.absent ? '—' : total}</span><span className="block text-[9px] text-muted-foreground sm:text-xs">/ {maximum}</span></TableCell>
                        <TableCell className="text-center"><Checkbox aria-label={`Mark ${examSubject.subjects.name} as absent`} checked={draft.absent} disabled={selectedExam?.status === 'published' || !canWrite} onCheckedChange={checked => update('absent', Boolean(checked))} /></TableCell>
                      </TableRow>
                    })}</TableBody>
                  </Table>
                </div>
              </div>}
            </div></>}
          </TabsContent>
          <TabsContent value="results" className="mt-0 min-w-0 max-w-full overflow-hidden">
            <Card className="min-w-0 max-w-full rounded-none border-0 bg-transparent shadow-none">
              <CardHeader className="border-b px-0 pb-5 pt-0">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div><p className="text-xs font-semibold uppercase tracking-wide text-primary">Class performance</p><CardTitle className="mt-1 text-xl">All student results</CardTitle><CardDescription className="mt-1">{selectedExam?.title || selectedExam?.result_exam_types.name} · {selectedExam?.classes.name} · {selectedExam && format(new Date(`${selectedExam.exam_date}T00:00:00`), 'dd MMM yyyy')}</CardDescription></div>
                  <div className="hidden flex-wrap gap-2 sm:flex"><Button type="button" variant="outline" onClick={exportExamResults} disabled={!examResultRows.length || examMarksQuery.isLoading}><Download className="mr-2 h-4 w-4" /> Export CSV</Button><Button type="button" variant="outline" onClick={printExamResults} disabled={!examResultRows.length || examMarksQuery.isLoading}><Printer className="mr-2 h-4 w-4" /> Print report</Button></div>
                </div>
                <div className="mt-5 grid grid-cols-2 gap-3 border-t pt-5 sm:grid-cols-4"><div><p className="text-xl font-bold">{examResultRows.length}</p><p className="text-xs text-muted-foreground">Students</p></div><div><p className="text-xl font-bold text-emerald-600">{completedResults}</p><p className="text-xs text-muted-foreground">Complete</p></div><div><p className="text-xl font-bold">{examResultRows.filter(row => row.complete && row.grade !== 'F').length}</p><p className="text-xs text-muted-foreground">Passed</p></div><div><p className="text-xl font-bold text-amber-600">{examResultRows.length - completedResults}</p><p className="text-xs text-muted-foreground">Incomplete</p></div></div>
              </CardHeader>
              <CardContent className="min-w-0 max-w-full p-0">
                {examMarksQuery.isLoading || studentsQuery.isLoading ? <LoadingState message="Loading all student results..." />
                  : examMarksQuery.error ? <ErrorState message={(examMarksQuery.error as Error).message} />
                    : studentsQuery.error ? <ErrorState message={(studentsQuery.error as Error).message} />
                      : examResultRows.length === 0 ? <EmptyState title="No students found" description="No students belong to this exam roster." />
                        : <div className="min-w-0 max-w-full"><Table className="w-max min-w-full text-xs [&_th]:h-8 [&_th]:px-1 [&_td]:px-1 [&_td]:py-1.5"><TableHeader><TableRow><TableHead className="sticky left-0 z-20 w-12 min-w-12 bg-background">Roll</TableHead><TableHead className="sticky left-12 z-20 min-w-28 max-w-28 border-r bg-background sm:min-w-40 sm:max-w-40">Student</TableHead>{examSubjectsQuery.data?.map(subject => <TableHead key={subject.id} className="min-w-14 text-center"><span className="block">{subject.subjects.code}</span><span className="block text-[9px] font-normal text-muted-foreground">/{examSubjectTotal(subject)}</span></TableHead>)}<TableHead className="min-w-16 text-center">Total</TableHead><TableHead className="min-w-12 text-center">GPA</TableHead><TableHead className="min-w-14 text-center">Grade</TableHead><TableHead className="min-w-10 text-center">Pos.</TableHead></TableRow></TableHeader><TableBody>{examResultRows.map(row => <TableRow key={row.id}><TableCell className="sticky left-0 z-10 bg-card font-semibold">{row.roll ?? '—'}</TableCell><TableCell className="sticky left-12 z-10 max-w-28 truncate border-r bg-card font-medium sm:max-w-40" title={row.name}>{row.name}</TableCell>{examSubjectsQuery.data?.map(subject => <TableCell key={subject.id} className="text-center text-[11px]">{examSubjectResultText(row, subject)}</TableCell>)}<TableCell className="text-center font-semibold">{row.complete ? `${row.totalObtained}/${row.totalMax}` : '—'}</TableCell><TableCell className="text-center font-semibold">{row.gpa == null ? '—' : row.gpa.toFixed(2)}</TableCell><TableCell className="text-center"><Badge className="px-1.5 py-0 text-[10px]" variant={!row.complete ? 'secondary' : row.grade === 'F' ? 'destructive' : 'default'}>{row.grade}</Badge></TableCell><TableCell className="text-center font-semibold">{row.position ?? '—'}</TableCell></TableRow>)}</TableBody></Table></div>}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="preview" className="mt-0 space-y-4">
            <Card className="rounded-none border-0 border-b bg-transparent shadow-none"><CardContent className="flex flex-col gap-4 px-0 pb-4 pt-0 sm:flex-row sm:items-center sm:justify-between"><div className="flex items-center gap-3"><Eye className="h-5 w-5 text-muted-foreground" /><div><p className="font-semibold">Report card preview</p><p className="text-sm text-muted-foreground">{selectedStudent?.first_name} {selectedStudent?.last_name} · {selectedExam?.title || selectedExam?.result_exam_types.name}</p></div></div><div className="flex flex-wrap gap-2">{canWrite && selectedExam?.status === 'published' && <Button variant="outline" onClick={createShareLink}><Link2 className="mr-2 h-4 w-4" /> Guardian link</Button>}<Button onClick={() => window.print()}><Printer className="mr-2 h-4 w-4" /> Print report card</Button></div></CardContent></Card>
            {shareUrl && <Card className="rounded-none border-0 border-b bg-transparent shadow-none"><CardContent className="flex flex-col gap-2 px-0 pb-4 sm:flex-row sm:items-center"><div className="min-w-0 flex-1"><p className="text-sm font-medium">Guardian link copied</p><p className="truncate text-xs text-muted-foreground">{shareUrl}</p></div><Button size="sm" variant="outline" onClick={() => navigator.clipboard.writeText(shareUrl)}><Copy className="mr-2 h-4 w-4" /> Copy again</Button></CardContent></Card>}
            {previewQuery.isLoading ? <LoadingState /> : previewQuery.error ? <ErrorState message={(previewQuery.error as Error).message} /> : previewQuery.data ? <div className="overflow-hidden"><ResultSheet result={previewQuery.data} /></div> : null}
          </TabsContent>
        </Tabs>
      )}

      <SimpleDialog open={examDialog} onOpenChange={setExamDialog} title="Create examination" description="Choose every class that will have this examination." onSave={createExam} saveLabel={examForm.classIds.length > 1 ? `Create for ${examForm.classIds.length} classes` : 'Create exam'}>
        <Label>
          Classes from all sessions
        </Label>
        <div className="max-h-52 overflow-y-auto rounded-md border">
          <label className="flex cursor-pointer items-center gap-3 border-b px-3 py-2.5 text-sm font-medium">
            <Checkbox checked={examClasses.length > 0 && examForm.classIds.length === examClasses.length} onCheckedChange={checked => setExamForm(current => ({ ...current, classIds: checked ? examClasses.map(item => item.id) : [] }))} /> Select all classes</label>{examClasses.map(item => <label key={item.id} className="flex cursor-pointer items-center gap-3 border-b px-3 py-2.5 text-sm last:border-b-0"><Checkbox checked={examForm.classIds.includes(item.id)} onCheckedChange={checked => setExamForm(current => ({ ...current, classIds: checked ? [...new Set([...current.classIds, item.id])] : current.classIds.filter(id => id !== item.id) }))} /><span className="min-w-0"><span className="block truncate font-medium">{item.name} ({item.grade}-{item.section})</span><span className="block text-xs text-muted-foreground">{item.academic_years?.name}</span></span></label>)}</div><p className="text-xs text-muted-foreground">{examForm.classIds.length} class{examForm.classIds.length === 1 ? '' : 'es'} selected</p><Label>Exam type</Label><Select value={examForm.typeId} onValueChange={value => setExamForm(current => ({ ...current, typeId: value }))}><SelectTrigger><SelectValue placeholder="Select type" /></SelectTrigger><SelectContent>{examTypesQuery.data?.filter(type => type.is_active).map(type => <SelectItem key={type.id} value={type.id}>{type.name}</SelectItem>)}</SelectContent></Select><Label>Custom title (optional)</Label><Input value={examForm.title} onChange={event => setExamForm(current => ({ ...current, title: event.target.value }))} placeholder="e.g. First Monthly Exam" /><Label>Exam date</Label><Input type="date" value={examForm.date} min={examDateMin} max={examDateMax} onChange={event => setExamForm(current => ({ ...current, date: event.target.value }))} /></SimpleDialog>
      <Dialog open={settingsDialog} onOpenChange={setSettingsDialog}>
        <DialogContent className="max-h-[90vh] overflow-hidden p-0 sm:max-w-2xl">
          <DialogHeader className=" px-5 pt-4"><DialogTitle>Subject Settings</DialogTitle>
            <DialogDescription>
                Define the subjects available to each academic group.
            </DialogDescription>
          </DialogHeader>
          <div className="flex gap-1 px-5 pt-2">
            {(['humanities', 'science', 'business'] as ClassGroup[]).map(group => <Button key={group} type="button" size="sm" variant={settingsGroup === group ? 'default' : 'ghost'} className="capitalize" onClick={() => setSettingsGroup(group)}>{group}</Button>)}
          </div>
          <div className="flex items-center justify-between px-5 pt-2"><div><p className="font-semibold capitalize">{settingsGroup} subjects</p><p className="text-xs text-muted-foreground">Used by all {settingsGroup} classes and exams.</p></div><Button size="sm" onClick={() => { setEditingSubjectId(null); setSubjectForm({ name: '', code: '' }); setSubjectDialog(true) }}><Plus className="mr-2 h-4 w-4" /> Add subject</Button></div>
          <div className="min-h-0 overflow-y-auto px-5 pb-5 pt-3">
            {subjectsQuery.isLoading ? <LoadingState message="Loading subjects..." /> : !subjectsQuery.data?.length ? <EmptyState title="No subjects defined" description={`Add the first subject for ${settingsGroup}.`} /> : <div className="divide-y rounded-md border">{subjectsQuery.data.map(subject => <div key={subject.id} className="flex items-center gap-3 px-3 py-2.5"><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{subject.name}</p><p className="text-xs text-muted-foreground">{subject.code}</p></div><Badge variant={subject.is_active ? 'secondary' : 'outline'}>{subject.is_active ? 'Active' : 'Disabled'}</Badge><Button type="button" variant="ghost" size="icon-sm" onClick={() => editSubject(subject)} aria-label={`Edit ${subject.name}`}><Pencil className="h-4 w-4" /></Button><Button type="button" variant="outline" size="sm" onClick={() => void toggleSubject(subject)}>{subject.is_active ? 'Disable' : 'Enable'}</Button></div>)}</div>}
          </div>
        </DialogContent>
      </Dialog>
      <SimpleDialog open={subjectDialog} onOpenChange={open => { setSubjectDialog(open); if (!open) { setEditingSubjectId(null); setSubjectForm({ name: '', code: '' }) } }} title={editingSubjectId ? 'Edit group subject' : 'Add group subject'} description={`This subject belongs to the ${settingsGroup} group and will be available to all its exams.`} onSave={saveSubject} saveLabel={editingSubjectId ? 'Save changes' : 'Add subject'}><Label>Subject name</Label><Input value={subjectForm.name} onChange={event => setSubjectForm(current => ({ ...current, name: event.target.value }))} placeholder="Bangla" /><Label>Subject code</Label><Input value={subjectForm.code} onChange={event => setSubjectForm(current => ({ ...current, code: event.target.value }))} placeholder="BAN-101" /></SimpleDialog>
      <SimpleDialog open={typeDialog} onOpenChange={open => { setTypeDialog(open); if (!open) setEditingTypeId(null) }} title={editingTypeId ? 'Edit exam type' : 'Add exam type'} description="Examples: Mid Term, Final, Test, Monthly Exam." onSave={saveExamType} saveLabel={editingTypeId ? 'Save changes' : 'Add type'}><Label>Name</Label><Input value={typeForm.name} onChange={event => setTypeForm(current => ({ ...current, name: event.target.value }))} placeholder="Practical Test" /><NumberField label="Display order" value={typeForm.sortOrder} onChange={value => setTypeForm(current => ({ ...current, sortOrder: value }))} /><div className="flex items-center gap-2"><Checkbox checked={typeForm.isActive} onCheckedChange={checked => setTypeForm(current => ({ ...current, isActive: Boolean(checked) }))} /><Label>Active and available for new exams</Label></div></SimpleDialog>
      <Dialog open={configDialog} onOpenChange={setConfigDialog}>
        <DialogContent className="max-h-[90vh] overflow-hidden p-0 sm:max-w-5xl">
          <DialogHeader className="border-b bg-muted/30 px-6 py-5"><DialogTitle>Configure exam subjects</DialogTitle><DialogDescription>Select subjects and define their creative, MCQ, practical, and pass marks.</DialogDescription></DialogHeader>
          <div className="overflow-auto border-y">
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
          <DialogFooter className="bg-muted/20 px-6 py-4"><Button variant="outline" onClick={() => setConfigDialog(false)}>Cancel</Button><Button onClick={() => void attachSubjects()} disabled={!unusedSubjects.some(subject => configRows[subject.id]?.selected)}>Add {unusedSubjects.filter(subject => configRows[subject.id]?.selected).length || ''} selected subject{unusedSubjects.filter(subject => configRows[subject.id]?.selected).length === 1 ? '' : 's'}</Button></DialogFooter>
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

function MarkInput({ label, value, max, disabled, onChange }: { label: string; value: string; max: number; disabled: boolean; onChange: (value: string) => void }) {
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

  return <Input
    aria-label={`${label}, maximum ${max}`}
    title={`Maximum ${max}`}
    type="number"
    inputMode="decimal"
    min={0}
    max={max}
    step={0.5}
    value={value}
    disabled={disabled || max <= 0}
    className="h-8 w-16 min-w-16 px-2 text-xs font-semibold tabular-nums sm:h-9 sm:w-auto sm:min-w-24 sm:text-sm"
    placeholder={max <= 0 ? 'N/A' : `0 / ${max}`}
    onKeyDown={event => {
      if (!event.ctrlKey && !event.metaKey && !event.altKey && event.key.length === 1 && !/[0-9.]/.test(event.key)) event.preventDefault()
    }}
    onPaste={event => {
      if (!/^\d*\.?\d*$/.test(event.clipboardData.getData('text'))) event.preventDefault()
    }}
    onChange={event => onChange(normalizeMark(event.target.value))}
  />
}
function NumberField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <div className="space-y-1.5"><Label>{label}</Label><Input type="number" min={0} step="1" value={value} onChange={event => onChange(event.target.value)} /></div>
}

function SimpleDialog({ open, onOpenChange, title, description, onSave, saveLabel, children }: { open: boolean; onOpenChange: (open: boolean) => void; title: string; description: string; onSave: () => unknown | Promise<unknown>; saveLabel: string; children: React.ReactNode }) {
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="overflow-hidden p-0 sm:max-w-lg"><DialogHeader className="border-b bg-muted/30 px-6 py-3">
    <DialogTitle>{title}</DialogTitle><DialogDescription>{description}</DialogDescription></DialogHeader><div className="space-y-3 px-6 py-2  [&>label]:block">{children}</div>
    <DialogFooter className=" bg-muted/20 px-6 py-4"><Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
    <Button type="button" onClick={() => void onSave()}>{saveLabel}</Button></DialogFooter></DialogContent>
    </Dialog>
}
