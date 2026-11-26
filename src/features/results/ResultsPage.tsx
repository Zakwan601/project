import { useEffect, useMemo, useState } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, CheckCircle2, ChevronRight, Copy, Download, EllipsisVertical, Link2, Pencil, Plus, Printer, Search, Send, Settings, Users } from 'lucide-react'
import { format } from 'date-fns'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { useClasses } from '@/hooks/useClasses'
import { EmptyState, ErrorState } from '@/components/shared/PageHeader'
import { ResultSheet } from '@/features/results/ResultSheet'
import { printReportCard, printReportCards } from '@/lib/printReportCard'
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
import { Skeleton } from '@/components/ui/skeleton'
import type { ClassGroup, ResultExamType, StudentResultPayload, Student, SubjectCourseOption } from '@/types/database'
import { downloadCsv } from '@/lib/csv'
import { SimpleDialog } from '@/features/results/ResultControls'
import { SubjectMarksEntry } from './SubjectMarksEntry'
import { ExamScheduleManager } from '@/features/results/ExamScheduleManager'
import { StudentResultsPage } from '@/features/results/StudentResultsPage'
import {
  examSubjectTotal,
  examSubjectConfigValues,
  validExamSubjectConfig,
  isTotalOnlyExam,
  isTotalPassExam,
  buildExamSubjectCatalogue,
  examSubjectAppliesToStudent,
  calculateOfficialGpa,
  gradeSubject,
  subjectSectionsPassed,
  overallGrade,
  type ClassSubject,
  type ConfigurableExamSubject,
  type ExamResultReportRow,
  type ExamResultSubjectCell,
  type ExamSubject,
  type ExamSubjectConfigDraft,
  type ExamWithDetails,
  type MarkRow,
  type ResultShareLink,
  type ResultSubjectPaperGroup,
  type ResultSmsSummary,
} from '@/features/results/result-model'


const db = supabase as any
const examSubjectName = (subject: ExamSubject) => subject.result_subject_paper_groups?.name ?? subject.subjects.name
const examSubjectCode = (subject: ExamSubject) => subject.result_subject_paper_groups?.code ?? subject.subjects.code

export function ResultsPage() {
  const { role } = useAuth()
  return role === 'student'
    ? <StudentResultsPage />
    : <StaffResults />
}

function ExaminationsPageSkeleton({ detail }: { detail: boolean }) {
  return (
    <div className="min-w-0" role="status" aria-label="Loading examinations" aria-busy="true">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{detail ? 'Examination' : 'Examinations Results'}</h1>
          <Skeleton className="mt-2 h-3 w-52 max-w-[60vw]" />
        </div>
        <div className="hidden gap-2 sm:flex">
          <Skeleton className="h-9 w-28" />
          <Skeleton className="h-9 w-32" />
        </div>
      </div>
      <ExaminationContentSkeleton detail={detail} />
      <span className="sr-only">Loading examination workspace</span>
    </div>
  )
}

function ExaminationContentSkeleton({ detail }: { detail: boolean }) {
  return (
    <div className="space-y-4">
      {detail ? (
        <div className="flex gap-2 border-b pb-2">
          {['Routine', 'Enter marks', 'All results', 'Report card'].map(label => (
            <div key={label} className="px-3 py-1.5">
              <Skeleton className="h-4 w-20" />
            </div>
          ))}
        </div>
      ) : (
        <div className="flex flex-col justify-end gap-2 sm:flex-row">
          <Skeleton className="h-10 w-full sm:w-72" />
          <Skeleton className="h-9 w-full sm:w-32" />
          <Skeleton className="h-9 w-full sm:w-36" />
        </div>
      )}
      {detail ? <ExamWorkspaceSkeleton /> : <ResultsTableSkeleton />}
    </div>
  )
}

function ResultsTableSkeleton() {
  return (
    <div className="overflow-hidden rounded-lg border">
      <div className="grid grid-cols-[minmax(10rem,1.5fr)_minmax(7rem,.8fr)_minmax(7rem,.7fr)_minmax(6rem,.5fr)] gap-4 border-b bg-muted/30 px-4 py-3">
        {Array.from({ length: 4 }, (_, index) => <Skeleton key={index} className="h-3 w-20" />)}
      </div>
      {Array.from({ length: 7 }, (_, index) => (
        <div key={index} className="grid min-h-16 grid-cols-[minmax(10rem,1.5fr)_minmax(7rem,.8fr)_minmax(7rem,.7fr)_minmax(6rem,.5fr)] items-center gap-4 border-b px-4 last:border-b-0">
          <div className="space-y-2"><Skeleton className="h-3 w-36" /><Skeleton className="h-3 w-20" /></div>
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-7 w-24 rounded-full" />
          <Skeleton className="h-8 w-16" />
        </div>
      ))}
    </div>
  )
}

function ExamWorkspaceSkeleton() {
  return (
    <div className="rounded-lg border p-4">
      <div className="flex items-start justify-between gap-3">
        <div><Skeleton className="h-4 w-40" /><Skeleton className="mt-2 h-3 w-56 max-w-full" /></div>
        <Skeleton className="h-9 w-28" />
      </div>
      <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => <Skeleton key={index} className="h-16 w-full" />)}
      </div>
      <div className="mt-4 flex gap-2">
        <Skeleton className="h-10 flex-1" />
        <Skeleton className="h-10 w-32" />
      </div>
      <div className="mt-3 space-y-2">
        {Array.from({ length: 6 }, (_, index) => <Skeleton key={index} className="h-12 w-full" />)}
      </div>
    </div>
  )
}

function ReportPreviewSkeleton() {
  return (
    <div className="rounded-lg border p-5">
      <div className="flex justify-between gap-4 border-b pb-4">
        <div><Skeleton className="h-6 w-48" /><Skeleton className="mt-2 h-3 w-36" /></div>
        <Skeleton className="h-16 w-28" />
      </div>
      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => <Skeleton key={index} className="h-16 w-full" />)}
      </div>
      <div className="mt-5 space-y-3">
        {Array.from({ length: 7 }, (_, index) => <Skeleton key={index} className="h-10 w-full" />)}
      </div>
    </div>
  )
}

function SubjectListSkeleton() {
  return (
    <div className="divide-y rounded-md border">
      {Array.from({ length: 7 }, (_, index) => (
        <div key={index} className="flex min-h-14 items-center gap-3 px-3">
          <div className="flex-1 space-y-2"><Skeleton className="h-3 w-40" /><Skeleton className="h-3 w-16" /></div>
          <Skeleton className="h-6 w-20 rounded-full" />
          <Skeleton className="h-8 w-16" />
        </div>
      ))}
    </div>
  )
}

function StaffResults() {
  const { examId: routeExamId } = useParams<{ examId: string }>()
  const navigate = useNavigate()
  const isExamPage = Boolean(routeExamId)
  const { can, role } = useAuth()
  const canWrite = can('results', 'write')
  const canPublishResults = role === 'admin'
  const canEditExamination = role === 'admin'
  const qc = useQueryClient()
  const { data: classes = [], isLoading: classesLoading } = useClasses()
  const [activeTab, setActiveTab] = useState(isExamPage ? 'routine' : 'overview')
  const [classId, setClassId] = useState('')
  const [examId, setExamId] = useState('')
  const [previewStudentId, setPreviewStudentId] = useState('')
  const [preparingReportCards, setPreparingReportCards] = useState(false)
  const [previewStudentSearch, setPreviewStudentSearch] = useState('')
  const [examDialog, setExamDialog] = useState(false)
  const [editExamDialog, setEditExamDialog] = useState(false)
  const [subjectDialog, setSubjectDialog] = useState(false)
  const [settingsDialog, setSettingsDialog] = useState(false)
  const [configDialog, setConfigDialog] = useState(false)
  const [configureAfterCreateExamId, setConfigureAfterCreateExamId] = useState<string | null>(null)
  const [editingSubjectId, setEditingSubjectId] = useState<string | null>(null)
  const [examForm, setExamForm] = useState({ classIds: [] as string[], typeId: '', title: '', date: '', hasRegularClasses: true, combineSubjectPapers: false, countFourthSubject: false })
  const [editExamForm, setEditExamForm] = useState({ typeId: '', title: '', date: '', hasRegularClasses: true, combineSubjectPapers: false, countFourthSubject: false })
  const [subjectForm, setSubjectForm] = useState({ name: '', code: '', isFourthSubject: false })
  const [settingsGroup, setSettingsGroup] = useState<ClassGroup>('science')
  const [configRows, setConfigRows] = useState<Record<string, ExamSubjectConfigDraft>>({})
  const [shareUrl, setShareUrl] = useState('')
  const [publishing, setPublishing] = useState(false)
  const [mobilePreviewRosterOpen, setMobilePreviewRosterOpen] = useState(false)
  const activeExamId = routeExamId || examId

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
    enabled: examDialog || editExamDialog,
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
        .select('*, result_exam_types(name,marks_mode), academic_years(name), classes(name, grade, section, class_group)')
        .eq('id', routeExamId).single()
      if (error) throw error
      return data as ExamWithDetails
    },
  })

  useEffect(() => {
    if (!routeExamId) {
      setClassId('')
      setExamId('')
      setActiveTab('overview')
      return
    }
    if (!routeExamQuery.data) return
    setClassId(routeExamQuery.data.class_id)
    setExamId(routeExamId)
    setActiveTab('routine')
  }, [routeExamId, routeExamQuery.data])

  useEffect(() => {
    setPreviewStudentId('')
    setPreviewStudentSearch('')
    setShareUrl('')
  }, [routeExamId])

  useEffect(() => {
    if (!canWrite && activeTab === 'marks') setActiveTab(isExamPage ? 'results' : 'overview')
  }, [activeTab, canWrite, isExamPage])

  const selectedClassGroup = classes.find(item => item.id === classId)?.class_group
  const subjectGroup = isExamPage ? selectedClassGroup : settingsGroup
  const subjectsQuery = useQuery<ClassSubject[]>({
    queryKey: ['result-subjects', subjectGroup], enabled: Boolean(subjectGroup && (isExamPage || settingsDialog)),
    queryFn: async () => {
      const { data, error } = await db.from('subjects').select('id,name,code,is_active,class_group,is_fourth_subject').eq('class_group', subjectGroup).order('name')
      if (error) throw error
      return data
    },
  })

  const paperGroupsQuery = useQuery<ResultSubjectPaperGroup[]>({
    queryKey: ['result-subject-paper-groups', subjectGroup],
    enabled: Boolean(subjectGroup && isExamPage),
    queryFn: async () => {
      const { data, error } = await db.from('result_subject_paper_groups')
        .select('*').eq('class_group', subjectGroup).order('name')
      if (error) throw error
      return data as ResultSubjectPaperGroup[]
    },
  })

  const courseOptionsQuery = useQuery<SubjectCourseOption[]>({
    queryKey: ['result-subject-course-options', subjectGroup],
    enabled: Boolean(subjectGroup && isExamPage),
    queryFn: async () => {
      const { data, error } = await db.from('subject_course_options')
        .select('*').eq('class_group', subjectGroup)
      if (error) throw error
      return data as SubjectCourseOption[]
    },
  })

  const examsQuery = useQuery<ExamWithDetails[]>({
    queryKey: ['result-exams', isExamPage ? classId : classId || 'all'], enabled: !isExamPage || Boolean(classId),
    queryFn: async () => {
      let request = db.from('result_exams')
        .select('*, result_exam_types(name,marks_mode), academic_years(name), classes(name, grade, section, class_group)')
        .order('exam_date', { ascending: false })
      if (classId) request = request.eq('class_id', classId)
      const { data, error } = await request
      if (error) throw error
      return data as ExamWithDetails[]
    },
  })

  useEffect(() => {
    if (examId && examsQuery.data && !examsQuery.data.some(item => item.id === examId)) setExamId('')
  }, [examId, examsQuery.data])

  const selectedExam = routeExamQuery.data ?? examsQuery.data?.find(item => item.id === activeExamId)
  const totalOnly = isTotalOnlyExam(selectedExam)
  const totalPass = isTotalPassExam(selectedExam)
  const examSubjectsQuery = useQuery<ExamSubject[]>({
    queryKey: ['result-exam-subjects', activeExamId], enabled: Boolean(activeExamId),
    queryFn: async () => {
      const { data, error } = await db.from('result_exam_subjects').select('*, subjects(id,name,code,is_fourth_subject), result_subject_paper_groups(name,code)').eq('exam_id', activeExamId).order('sort_order')
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

  const studentCurriculumQuery = useQuery<Student[]>({
    queryKey: ['result-roster-curriculum', selectedExam?.id, studentsQuery.data?.map(student => student.id).join(',')],
    enabled: Boolean(selectedExam && studentsQuery.data?.length),
    queryFn: async () => {
      const studentIds = studentsQuery.data!.map(student => student.id)
      const { data, error } = await db.from('students')
        .select('id,class_group,fourth_subject_id,optional_subject_2_id,group_elective_option_id,group_fourth_option_id,humanities_main_option_1_id,humanities_main_option_2_id,humanities_main_option_3_id,humanities_fourth_option_id')
        .in('id', studentIds)
      if (error) throw error
      return data as Student[]
    },
  })

  const curriculumByStudentId = useMemo(
    () => new Map((studentCurriculumQuery.data ?? []).map(student => [student.id, student])),
    [studentCurriculumQuery.data],
  )

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

  const previewQuery = useQuery<StudentResultPayload>({
    queryKey: ['result-preview', activeExamId, previewStudentId], enabled: Boolean(activeExamId && previewStudentId),
    queryFn: async () => {
      const { data, error } = await db.rpc('get_student_result', { p_exam_id: activeExamId, p_student_id: previewStudentId })
      if (error) throw error
      return data as StudentResultPayload
    },
  })

  async function printAllReportCards() {
    const roster = studentsQuery.data ?? []
    if (!activeExamId || !roster.length || preparingReportCards) return
    setPreparingReportCards(true)
    try {
      const results: StudentResultPayload[] = []
      // Limit concurrent requests for larger classes while preserving roster order.
      for (let offset = 0; offset < roster.length; offset += 5) {
        const batch = await Promise.all(roster.slice(offset, offset + 5).map(async student => {
          const { data, error } = await db.rpc('get_student_result', {
            p_exam_id: activeExamId, p_student_id: student.id,
          })
          if (error) throw error
          if (!data) throw new Error(`Report card unavailable for ${student.first_name} ${student.last_name}`)
          return data as StudentResultPayload
        }))
        results.push(...batch)
      }
      const container = document.createElement('div')
      container.innerHTML = renderToStaticMarkup(<>{results.map((result, index) => <ResultSheet key={index} result={result} />)}</>)
      printReportCards(Array.from(container.querySelectorAll<HTMLElement>('.result-sheet')))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to prepare all report cards. Please try again.')
    } finally {
      setPreparingReportCards(false)
    }
  }

  const examResultRows = useMemo<ExamResultReportRow[]>(() => {
    const roster = studentsQuery.data ?? []
    const subjects = examSubjectsQuery.data ?? []
    const marksByStudentAndSubject = new Map(
      (examMarksQuery.data ?? []).map(mark => [`${mark.student_id}:${mark.exam_subject_id}`, mark]),
    )
    const rows = roster.map(student => {
      const studentCurriculum = curriculumByStudentId.get(student.id)
      const applicableSubjects = studentCurriculum
        ? subjects.filter(subject => examSubjectAppliesToStudent(subject, studentCurriculum, courseOptionsQuery.data ?? [], paperGroupsQuery.data ?? []))
        : []
      const subjectResults = Object.fromEntries(applicableSubjects.map(subject => {
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
        const componentMarks = {
          creativeMarks: Number(mark?.creative_marks ?? 0),
          writtenMarks: Number(mark?.written_marks ?? 0),
          practicalMarks: Number(mark?.practical_marks ?? 0),
        }
        const grade = gradeSubject(obtained, totalMax, subject.pass_mark, Boolean(mark?.is_absent), subjectSectionsPassed(subject, componentMarks))
        return [subject.id, {
          obtained,
          ...componentMarks,
          totalMax,
          absent: Boolean(mark?.is_absent),
          complete,
          passed: complete && (totalOnly ? !mark?.is_absent : grade.passed),
          gradePoint: complete ? grade.gradePoint : 0,
        }]
      })) as Record<string, ExamResultSubjectCell>
      const cells = Object.values(subjectResults)
      const complete = cells.length > 0 && cells.every(cell => cell.complete)
      const officialGpa = studentCurriculum
        ? calculateOfficialGpa(
          applicableSubjects,
          subjectResults,
          studentCurriculum,
          courseOptionsQuery.data ?? [],
          paperGroupsQuery.data ?? [],
          selectedExam?.count_fourth_subject ?? false,
        )
        : { gpa: 0, failedMainSubjects: 0 }
      const failedSubjects = totalOnly ? 0 : officialGpa.failedMainSubjects
      const gpa = complete && !totalOnly ? officialGpa.gpa : null
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
        grade: totalOnly ? (complete ? 'Recorded' : 'Incomplete') : gpa == null ? 'Incomplete' : overallGrade(gpa, failedSubjects),
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
  }, [studentsQuery.data, examSubjectsQuery.data, examMarksQuery.data, curriculumByStudentId, courseOptionsQuery.data, paperGroupsQuery.data, selectedExam?.count_fourth_subject, totalOnly])

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
      ...examSubjectsQuery.data.map(subject => `${examSubjectName(subject)} (${examSubjectCode(subject)}) / ${examSubjectTotal(subject)}`),
      'Total', ...(!totalOnly ? ['GPA', 'Grade'] : []), 'Position', ...(!totalOnly ? ['Failed Subjects'] : []),
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
      ...(!totalOnly ? [row.gpa, row.grade] : []),
      row.position,
      ...(!totalOnly ? [row.complete ? row.failedSubjects : ''] : []),
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
      p_has_regular_classes: examForm.hasRegularClasses,
      p_combine_subject_papers: examForm.combineSubjectPapers,
      p_count_fourth_subject: examForm.countFourthSubject,
    })
    if (error) return toast.error(error.message)
    const created = data as Array<{ exam_id: string; class_id: string }>
    const firstExam = created.find(item => item.class_id === classId) ?? created[0]
    await qc.invalidateQueries({ queryKey: ['result-exams'] })
    setExamDialog(false); setExamForm({ classIds: [], typeId: '', title: '', date: '', hasRegularClasses: true, combineSubjectPapers: false, countFourthSubject: false }); setExamId(firstExam?.exam_id ?? ''); setActiveTab('routine')
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

  const openEditExamDialog = () => {
    if (!canEditExamination) return
    if (!selectedExam) return
    setEditExamForm({
      typeId: selectedExam.exam_type_id,
      title: selectedExam.title ?? '',
      date: selectedExam.exam_date,
      hasRegularClasses: selectedExam.has_regular_classes,
      combineSubjectPapers: selectedExam.combine_subject_papers,
      countFourthSubject: selectedExam.count_fourth_subject,
    })
    setEditExamDialog(true)
  }

  const updateExam = async () => {
    if (!canEditExamination) return toast.error('Only a full administrator can edit examination details')
    if (!selectedExam || !editExamForm.typeId || !editExamForm.date) return toast.error('Exam type and reference date are required')
    const { error } = await db.rpc('update_result_exam_group_settings', {
      p_exam_group_id: selectedExam.exam_group_id,
      p_exam_type_id: editExamForm.typeId,
      p_title: editExamForm.title.trim() || null,
      p_exam_date: editExamForm.date,
      p_has_regular_classes: editExamForm.hasRegularClasses,
      p_combine_subject_papers: editExamForm.combineSubjectPapers,
      p_count_fourth_subject: editExamForm.countFourthSubject,
    })
    if (error) return toast.error(error.message)
    setEditExamDialog(false)
    await Promise.all([
      qc.invalidateQueries({ queryKey: ['result-exam', routeExamId] }),
      qc.invalidateQueries({ queryKey: ['result-exams'] }),
      qc.invalidateQueries({ queryKey: ['result-exam-group', selectedExam.exam_group_id] }),
      qc.invalidateQueries({ queryKey: ['result-exam-routine', selectedExam.exam_group_id] }),
    ])
    toast.success('Examination updated')
  }

  const saveSubject = async () => {
    if (!subjectForm.name.trim() || !subjectForm.code.trim()) return toast.error('Subject name and code are required')
    const payload = { name: subjectForm.name.trim(), code: subjectForm.code.trim().toUpperCase(), class_id: null, class_group: settingsGroup, is_active: true, is_fourth_subject: subjectForm.isFourthSubject }
    const request = editingSubjectId
      ? db.from('subjects').update({ name: payload.name, code: payload.code, is_fourth_subject: payload.is_fourth_subject }).eq('id', editingSubjectId)
      : db.from('subjects').insert(payload)
    const { error } = await request
    if (error) return toast.error(error.message)
    setSubjectDialog(false); setSubjectForm({ name: '', code: '', isFourthSubject: false }); setEditingSubjectId(null)
    await qc.invalidateQueries({ queryKey: ['result-subjects', settingsGroup] }); toast.success(editingSubjectId ? 'Subject updated' : 'Subject added')
  }

  const editSubject = (subject: ClassSubject) => {
    setEditingSubjectId(subject.id)
    setSubjectForm({ name: subject.name, code: subject.code, isFourthSubject: subject.is_fourth_subject })
    setSubjectDialog(true)
  }

  const toggleSubject = async (subject: ClassSubject) => {
    const { error } = await db.from('subjects').update({ is_active: !subject.is_active }).eq('id', subject.id)
    if (error) return toast.error(error.message)
    await qc.invalidateQueries({ queryKey: ['result-subjects', settingsGroup] })
    toast.success(subject.is_active ? 'Subject disabled for new exams' : 'Subject enabled')
  }

  const openSubjectConfiguration = () => {
    if (subjectsQuery.isPending || paperGroupsQuery.isPending || examSubjectsQuery.isPending) return toast.info('Loading subject choices…')
    if (subjectsQuery.error || paperGroupsQuery.error || examSubjectsQuery.error) return toast.error('Subject choices could not be loaded. Please try again.')
    const configured = new Map((examSubjectsQuery.data ?? []).map(item => [item.subject_id, item]))
    setConfigRows(Object.fromEntries(configurableSubjects.map(subject => {
      const current = configured.get(subject.id)
      return [subject.id, {
        selected: Boolean(current),
        creative: current ? String(current.creative_max) : totalPass ? '10' : '',
        written: current ? String(current.written_max) : totalPass ? '10' : '',
        practical: current ? String(current.practical_max) : '',
        pass: current ? String(current.pass_mark) : totalPass ? '6.6' : '',
        creativePass: current?.creative_pass_mark ? String(current.creative_pass_mark) : '',
        writtenPass: current?.written_pass_mark ? String(current.written_pass_mark) : '',
        practicalPass: current?.practical_pass_mark ? String(current.practical_pass_mark) : '',
        total: current ? String(examSubjectTotal(current)) : totalPass ? '20' : '',
      }]
    })))
    setConfigDialog(true)
  }

  useEffect(() => {
    if (!configureAfterCreateExamId || examId !== configureAfterCreateExamId || subjectsQuery.isPending || paperGroupsQuery.isPending || examSubjectsQuery.isPending) return
    openSubjectConfiguration()
    setConfigureAfterCreateExamId(null)
  }, [configureAfterCreateExamId, examId, subjectsQuery.isPending, paperGroupsQuery.isPending, examSubjectsQuery.isPending])

  const saveExamSubjects = async () => {
    const available = configurableSubjects
    const selected = available.filter(subject => configRows[subject.id]?.selected)
    if (!selected.length) return toast.error('Select at least one subject')
    const rows = selected.map((subject, index) => {
      const row = configRows[subject.id]
      const values = examSubjectConfigValues(row, totalOnly, totalPass)
      return { subject, row, values, index }
    })
    const invalid = rows.find(({ values }) => !validExamSubjectConfig(values, totalOnly, totalPass))
    if (invalid) return toast.error(`Check the marks configuration for ${invalid.subject.name}`)
    const { error } = await db.from('result_exam_subjects').upsert(rows.map(({ subject, values, index }) => ({
      exam_id: examId, subject_id: subject.id,
      paper_group_id: subject.paper_group_id,
      creative_max: values[0], written_max: values[1], practical_max: values[2], pass_mark: values[3],
      creative_pass_mark: values[5], written_pass_mark: values[6], practical_pass_mark: values[7],
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
    if (!canPublishResults) return toast.error('Only a full administrator can publish or unpublish results')
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
    if (!previewStudentId) return toast.error('Select a student first')
    const { data, error } = await db.rpc('create_result_share_link', {
      p_exam_id: activeExamId, p_student_id: previewStudentId, p_expires_at: new Date(Date.now() + 30 * 86400000).toISOString(),
    })
    if (error) return toast.error(error.message)
    const url = `${window.location.origin}/shared-result/${data}`
    setShareUrl(url)
    await navigator.clipboard.writeText(url)
    toast.success('Guardian link copied; it expires in 30 days')
  }

  const configurableSubjects = useMemo<ConfigurableExamSubject[]>(() => {
    const configuredIds = new Set((examSubjectsQuery.data ?? []).map(item => item.subject_id))
    const catalogue = (subjectsQuery.data ?? []).filter(subject => subject.is_active || configuredIds.has(subject.id))
    return buildExamSubjectCatalogue(catalogue, paperGroupsQuery.data ?? [], Boolean(selectedExam?.combine_subject_papers))
  }, [subjectsQuery.data, examSubjectsQuery.data, paperGroupsQuery.data, selectedExam?.combine_subject_papers])
  // Kept as a local alias while the compact exam-action markup is transitioned.
  const unusedSubjects = configurableSubjects
  const attachSubjects = saveExamSubjects
  const previewStudent = studentsQuery.data?.find(student => student.id === previewStudentId)
  const completedResults = examResultRows.filter(row => row.complete).length
  const filteredPreviewStudents = useMemo(() => {
    const query = previewStudentSearch.trim().toLowerCase()
    if (!query) return studentsQuery.data ?? []
    return (studentsQuery.data ?? []).filter(student => `${student.first_name} ${student.last_name} ${student.admission_number} ${student.roll_number ?? ''}`.toLowerCase().includes(query))
  }, [previewStudentSearch, studentsQuery.data])
  if (classesLoading || (isExamPage && routeExamQuery.isLoading)) return <ExaminationsPageSkeleton detail={isExamPage} />
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
          {isExamPage && <><div className="hidden flex-wrap items-center justify-end gap-2 sm:flex">{canWrite && selectedExam?.status === 'draft' && 
            <Button size="sm" variant="outline" onClick={openSubjectConfiguration} disabled={!unusedSubjects.length || publishing}><Plus className="mr-2 h-4 w-4" /> Add subjects</Button>}
          <Button variant="outline" size="sm" onClick={() => navigate('/results')}><ArrowLeft className="mr-2 h-4 w-4" /> All examinations</Button>
          {canPublishResults && selectedExam && <Button size="sm" variant={selectedExam.status === 'published' ? 'outline' : 'default'} disabled={publishing} onClick={() => setStatus(selectedExam.status === 'published' ? 'draft' : 'published')}><Send className="mr-2 h-4 w-4" /> {publishing ? 'Working…' : selectedExam.status === 'published' ? 'Return to draft' : 'Publish results'}</Button>}</div><div className="sm:hidden"><DropdownMenu><DropdownMenuTrigger asChild><Button variant="outline" size="icon" className="h-9 w-9" aria-label="Exam actions"><EllipsisVertical className="h-4 w-4" /></Button></DropdownMenuTrigger><DropdownMenuContent align="end" className="w-48"><DropdownMenuItem onSelect={() => navigate('/results')}><ArrowLeft /> All examinations</DropdownMenuItem>{canWrite && selectedExam && <>{(selectedExam.status === 'draft' || canPublishResults) && <DropdownMenuSeparator />}{selectedExam.status === 'draft' && <DropdownMenuItem disabled={!unusedSubjects.length || publishing} onSelect={openSubjectConfiguration}><Plus /> Add subjects</DropdownMenuItem>}{canPublishResults && <DropdownMenuItem disabled={publishing} onSelect={() => void setStatus(selectedExam.status === 'published' ? 'draft' : 'published')}><Send /> {publishing ? 'Working…' : selectedExam.status === 'published' ? 'Return to draft' : 'Publish results'}</DropdownMenuItem>}</>}{activeTab === 'results' && <><DropdownMenuSeparator /><DropdownMenuItem disabled={!examResultRows.length || examMarksQuery.isLoading} onSelect={exportExamResults}><Download /> Export CSV</DropdownMenuItem><DropdownMenuItem disabled={!examResultRows.length || examMarksQuery.isLoading} onSelect={printExamResults}><Printer /> Print report</DropdownMenuItem></>}</DropdownMenuContent></DropdownMenu></div></>}
        </div>
      </section>
      {isExamPage && !classId ? <EmptyState title="Select a class" /> : examsQuery.isLoading ? <ExaminationContentSkeleton detail={isExamPage} /> : examsQuery.error ? <ErrorState message={(examsQuery.error as Error).message} /> : (
        <Tabs value={activeTab} onValueChange={setActiveTab} className="min-w-0 max-w-full">
          {isExamPage && <div className="mb-3 ">
            <TabsList className=" justify-start gap-1 bg-transparent p-0">
              <TabsTrigger value="routine" disabled={!selectedExam} className="rounded-none border-b-2 border-transparent px-3 py-2 shadow-none data-[state=active]:border-primary data-[state=active]:bg-transparent"> Routine</TabsTrigger>
              {canWrite && <TabsTrigger value="marks" disabled={!selectedExam} className="rounded-none border-b-2 border-transparent px-3 py-2 shadow-none data-[state=active]:border-primary data-[state=active]:bg-transparent"> Enter marks</TabsTrigger>}
              <TabsTrigger value="results" disabled={!selectedExam} className="rounded-none border-b-2 border-transparent px-3 py-2 shadow-none data-[state=active]:border-primary data-[state=active]:bg-transparent"> All results</TabsTrigger>
              <TabsTrigger value="preview" disabled={!selectedExam} className="rounded-none border-b-2 border-transparent px-3 py-2 shadow-none data-[state=active]:border-primary data-[state=active]:bg-transparent">Report card</TabsTrigger>
            </TabsList>
          </div>}
          <TabsContent value="overview" className="mt-0 space-y-5">
            {role === 'admin' && <div className="flex justify-end gap-3">
              {!isExamPage && 
                <div className="max-w-xl">
                  <Select value={classId || '__all__'} onValueChange={value => { setClassId(value === '__all__' ? '' : value); setExamId('') }}>
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
                {!examsQuery.data?.length ? <EmptyState title="No examinations found" description={classId ? 'No examinations are available for this class.' : 'Create an examination to begin.'} /> : <div className="max-w-full overflow-x-auto"><Table className="min-w-[820px]"><TableHeader><TableRow><TableHead>Examination</TableHead><TableHead>Class</TableHead><TableHead>Session</TableHead><TableHead>Mode</TableHead><TableHead>Reference date</TableHead><TableHead>Status</TableHead><TableHead className="w-24 text-right">Action</TableHead></TableRow></TableHeader><TableBody>{examsQuery.data.map(exam => <TableRow key={exam.id} className="cursor-pointer" onClick={() => navigate(`/results/${exam.id}`)}><TableCell className="font-semibold">{exam.title || exam.result_exam_types.name}</TableCell><TableCell>{exam.classes.name}<span className="block text-xs text-muted-foreground">{exam.classes.grade}-{exam.classes.section}</span></TableCell><TableCell>{exam.academic_years.name}</TableCell><TableCell><Badge variant={exam.has_regular_classes ? 'secondary' : 'default'}>{exam.has_regular_classes ? 'Exam + classes' : 'Exam only'}</Badge></TableCell><TableCell className="whitespace-nowrap">{format(new Date(`${exam.exam_date}T00:00:00`), 'dd MMM yyyy')}</TableCell><TableCell><Badge variant={exam.status === 'published' ? 'default' : 'secondary'} className="capitalize">{exam.status}</Badge></TableCell><TableCell className="text-right"><Button type="button" variant="ghost" size="sm" onClick={event => { event.stopPropagation(); navigate(`/results/${exam.id}`) }}>Manage<ChevronRight className="ml-1 h-4 w-4" /></Button></TableCell></TableRow>)}</TableBody></Table></div>}
              </CardContent>
            </Card>
          </TabsContent>
          <TabsContent value="routine" className="mt-0">
            {selectedExam && <>
              {canEditExamination && selectedExam.status === 'draft' && <div className="mb-3 flex justify-end"><Button type="button" variant="outline" size="sm" onClick={openEditExamDialog}><Pencil className="mr-2 h-4 w-4" /> Edit examination</Button></div>}
              <ExamScheduleManager examGroupId={selectedExam.exam_group_id} classId={selectedExam.class_id} canWrite={canWrite} hasRegularClasses={selectedExam.has_regular_classes} combineSubjectPapers={selectedExam.combine_subject_papers} />
            </>}
          </TabsContent>
          {canWrite && <TabsContent value="marks" className="mt-0">
            {selectedExam && <SubjectMarksEntry key={selectedExam.id} exam={selectedExam} />}
          </TabsContent>}
          <TabsContent value="results" className="mt-0 min-w-0 max-w-full overflow-hidden">
            <Card className="min-w-0 max-w-full rounded-none border-0 bg-transparent shadow-none">
              <CardHeader className="border-b px-0 pb-5 pt-0">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div><p className="text-xs font-semibold uppercase tracking-wide text-primary">Class performance</p><CardTitle className="mt-1 text-xl">All student results</CardTitle><CardDescription className="mt-1">{selectedExam?.title || selectedExam?.result_exam_types.name} · {selectedExam?.classes.name} · {selectedExam && format(new Date(`${selectedExam.exam_date}T00:00:00`), 'dd MMM yyyy')}</CardDescription></div>
                  <div className="hidden flex-wrap gap-2 sm:flex"><Button type="button" variant="outline" onClick={exportExamResults} disabled={!examResultRows.length || examMarksQuery.isLoading}><Download className="mr-2 h-4 w-4" /> Export CSV</Button><Button type="button" variant="outline" onClick={printExamResults} disabled={!examResultRows.length || examMarksQuery.isLoading}><Printer className="mr-2 h-4 w-4" /> Print report</Button></div>
                </div>
                <div className="mt-5 grid grid-cols-2 gap-3 border-t pt-5 sm:grid-cols-4"><div><p className="text-xl font-bold">{examResultRows.length}</p><p className="text-xs text-muted-foreground">Students</p></div><div><p className="text-xl font-bold text-emerald-600">{completedResults}</p><p className="text-xs text-muted-foreground">Complete</p></div>{!totalOnly && <div><p className="text-xl font-bold">{examResultRows.filter(row => row.complete && row.grade !== 'F').length}</p><p className="text-xs text-muted-foreground">Passed</p></div>}<div><p className="text-xl font-bold text-amber-600">{examResultRows.length - completedResults}</p><p className="text-xs text-muted-foreground">Incomplete</p></div></div>
              </CardHeader>
              <CardContent className="min-w-0 max-w-full p-0">
                {examMarksQuery.isLoading || studentsQuery.isLoading ? <ResultsTableSkeleton />
                  : examMarksQuery.error ? <ErrorState message={(examMarksQuery.error as Error).message} />
                    : studentsQuery.error ? <ErrorState message={(studentsQuery.error as Error).message} />
                      : examResultRows.length === 0 ? <EmptyState title="No students found" description="No students belong to this exam roster." />
                        : <div className="min-w-0 max-w-full"><Table className="w-max min-w-full text-xs [&_th]:h-8 [&_th]:px-1 [&_td]:px-1 [&_td]:py-1.5"><TableHeader><TableRow><TableHead className="sticky left-0 z-20 w-12 min-w-12 bg-background">Roll</TableHead><TableHead className="sticky left-12 z-20 min-w-28 max-w-28 border-r bg-background sm:min-w-40 sm:max-w-40">Student</TableHead>{examSubjectsQuery.data?.map(subject => <TableHead key={subject.id} className="min-w-14 text-center"><span className="block">{examSubjectCode(subject)}</span><span className="block text-[9px] font-normal text-muted-foreground">/{examSubjectTotal(subject)}</span></TableHead>)}<TableHead className="min-w-16 text-center">Total</TableHead>{!totalOnly && <><TableHead className="min-w-12 text-center">GPA</TableHead><TableHead className="min-w-14 text-center">Grade</TableHead></>}<TableHead className="min-w-10 text-center">Pos.</TableHead></TableRow></TableHeader><TableBody>{examResultRows.map(row => <TableRow key={row.id}><TableCell className="sticky left-0 z-10 bg-card font-semibold">{row.roll ?? '—'}</TableCell><TableCell className="sticky left-12 z-10 max-w-28 truncate border-r bg-card font-medium sm:max-w-40" title={row.name}>{row.name}</TableCell>{examSubjectsQuery.data?.map(subject => <TableCell key={subject.id} className="text-center text-[11px]">{examSubjectResultText(row, subject)}</TableCell>)}<TableCell className="text-center font-semibold">{row.complete ? `${row.totalObtained}/${row.totalMax}` : '—'}</TableCell>{!totalOnly && <><TableCell className="text-center font-semibold">{row.gpa == null ? '—' : row.gpa.toFixed(2)}</TableCell><TableCell className="text-center"><Badge className="px-1.5 py-0 text-[10px]" variant={!row.complete ? 'secondary' : row.grade === 'F' ? 'destructive' : 'default'}>{row.grade}</Badge></TableCell></>}<TableCell className="text-center font-semibold">{row.position ?? '—'}</TableCell></TableRow>)}</TableBody></Table></div>}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="preview" className="mt-0 space-y-4">
            <Card className="rounded-none border-0 border-b bg-transparent shadow-none"><CardContent className="flex flex-col gap-4 px-0 pb-4 pt-0 sm:flex-row sm:items-center sm:justify-between"><div className="flex items-center gap-3"><div><p className="font-semibold">Report card preview</p><p className="text-sm text-muted-foreground">{previewStudent ? `${previewStudent.first_name} ${previewStudent.last_name} · ` : ''}{selectedExam?.title || selectedExam?.result_exam_types.name}</p></div></div><div className="flex flex-wrap gap-2">{canWrite && previewStudentId && selectedExam?.status === 'published' && <Button variant="outline" onClick={createShareLink}><Link2 className="mr-2 h-4 w-4" /> Guardian link</Button>}<Button variant="outline" disabled={!studentsQuery.data?.length || studentsQuery.isFetching || studentsQuery.isError || preparingReportCards} onClick={() => void printAllReportCards()}><Printer className="mr-2 h-4 w-4" /> {preparingReportCards ? 'Preparing report cards…' : 'Print all report cards'}</Button><Button disabled={!previewQuery.data || previewQuery.isLoading || previewQuery.isError || preparingReportCards} onClick={printReportCard}><Printer className="mr-2 h-4 w-4" /> Print report card</Button></div></CardContent></Card>
            <div className="hidden xl:block">
              <Select value={previewStudentId} onValueChange={value => { setPreviewStudentId(value); setShareUrl('') }}>
                <SelectTrigger className="max-w-md"><SelectValue placeholder="Choose a student to preview" /></SelectTrigger>
                <SelectContent>{studentsQuery.data?.map(student => <SelectItem key={student.id} value={student.id}>{student.first_name} {student.last_name} · Roll {student.roll_number ?? '—'}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="xl:hidden">
              <Sheet open={mobilePreviewRosterOpen} onOpenChange={setMobilePreviewRosterOpen}>
                <SheetTrigger asChild><Button variant="outline" className="w-full justify-between"><span className="flex items-center gap-2"><Users className="h-4 w-4" /> Students</span><span className="flex min-w-0 items-center gap-2 text-muted-foreground"><span className="max-w-48 truncate">{previewStudent ? `${previewStudent.first_name} ${previewStudent.last_name}` : `${studentsQuery.data?.length ?? 0} available`}</span><ChevronRight className="h-4 w-4" /></span></Button></SheetTrigger>
                <SheetContent side="left" className="w-[88%] gap-0 p-0"><SheetHeader className="border-b pr-12"><SheetTitle>Student roster</SheetTitle><SheetDescription>{studentsQuery.data?.length ?? 0} students in this class</SheetDescription><div className="relative pt-2"><Search className="absolute left-3 top-4.5 h-4 w-4 text-muted-foreground" /><Input value={previewStudentSearch} onChange={event => setPreviewStudentSearch(event.target.value)} placeholder="Search name, roll, ID…" className="pl-9" /></div></SheetHeader><ScrollArea className="min-h-0 flex-1"><div className="space-y-1 p-2">{filteredPreviewStudents.map(student => { const result = examResultRows.find(row => row.id === student.id); const active = student.id === previewStudentId; const initials = `${student.first_name[0] ?? ''}${student.last_name[0] ?? ''}`.toUpperCase(); return <button type="button" key={student.id} onClick={() => { setPreviewStudentId(student.id); setShareUrl(''); setMobilePreviewRosterOpen(false) }} className={`flex w-full items-center gap-3 rounded-lg p-2.5 text-left transition-colors ${active ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`}><Avatar className="h-9 w-9"><AvatarFallback className={active ? 'bg-primary-foreground/20 text-primary-foreground' : ''}>{initials}</AvatarFallback></Avatar><span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{student.first_name} {student.last_name}</span><span className={`block truncate text-xs ${active ? 'text-primary-foreground/75' : 'text-muted-foreground'}`}>Roll {student.roll_number ?? '—'} · {student.admission_number}</span></span>{result?.complete && <CheckCircle2 className={`h-4 w-4 ${active ? '' : 'text-emerald-600'}`} />}</button> })}{filteredPreviewStudents.length === 0 && <p className="p-6 text-center text-sm text-muted-foreground">No students match your search.</p>}</div></ScrollArea></SheetContent>
              </Sheet>
            </div>
            {shareUrl && <Card className="rounded-none border-0 border-b bg-transparent shadow-none"><CardContent className="flex flex-col gap-2 px-0 pb-4 sm:flex-row sm:items-center"><div className="min-w-0 flex-1"><p className="text-sm font-medium">Guardian link copied</p><p className="truncate text-xs text-muted-foreground">{shareUrl}</p></div><Button size="sm" variant="outline" onClick={() => navigator.clipboard.writeText(shareUrl)}><Copy className="mr-2 h-4 w-4" /> Copy again</Button></CardContent></Card>}
            {!previewStudentId ? <Card className="border-0 bg-transparent shadow-none"><CardContent className="py-14"><EmptyState title="Select a student" description="Choose a student to preview and print their report card." /></CardContent></Card> : previewQuery.isLoading ? <ReportPreviewSkeleton /> : previewQuery.error ? <ErrorState message={(previewQuery.error as Error).message} /> : previewQuery.data ? <div className="overflow-hidden"><ResultSheet result={previewQuery.data} /></div> : null}
          </TabsContent>
        </Tabs>
      )}

      <SimpleDialog open={examDialog} onOpenChange={setExamDialog} title="Create examination" description="Choose the classes, day mode, and whether subject papers are combined." onSave={createExam} saveLabel={examForm.classIds.length > 1 ? `Create for ${examForm.classIds.length} classes` : 'Create exam'}>
        <Label>Fourth subject in GPA</Label>
        <Select value={examForm.countFourthSubject ? 'count' : 'exclude'} onValueChange={value => setExamForm(current => ({ ...current, countFourthSubject: value === 'count' }))}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="exclude">Do not count fourth subject</SelectItem><SelectItem value="count">Count fourth-subject bonus</SelectItem></SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">When counted, only points above 2 are added: (six main-subject points + fourth-subject points - 2) / 6, capped at 5.00.</p>
        <Label>
          Classes from all sessions
        </Label>
        <div className="max-h-52 overflow-y-auto rounded-md border">
          <label className="flex cursor-pointer items-center gap-3 border-b px-3 py-2.5 text-sm font-medium">
            <Checkbox checked={examClasses.length > 0 && examForm.classIds.length === examClasses.length} onCheckedChange={checked => setExamForm(current => ({ ...current, classIds: checked ? examClasses.map(item => item.id) : [] }))} /> Select all classes</label>{examClasses.map(item => <label key={item.id} className="flex cursor-pointer items-center gap-3 border-b px-3 py-2.5 text-sm last:border-b-0"><Checkbox checked={examForm.classIds.includes(item.id)} onCheckedChange={checked => setExamForm(current => ({ ...current, classIds: checked ? [...new Set([...current.classIds, item.id])] : current.classIds.filter(id => id !== item.id) }))} /><span className="min-w-0"><span className="block truncate font-medium">{item.name} ({item.grade}-{item.section})</span><span className="block text-xs text-muted-foreground">{item.academic_years?.name}</span></span></label>)}</div><p className="text-xs text-muted-foreground">{examForm.classIds.length} class{examForm.classIds.length === 1 ? '' : 'es'} selected</p><Label>Exam type</Label><Select value={examForm.typeId} onValueChange={value => setExamForm(current => ({ ...current, typeId: value }))}><SelectTrigger><SelectValue placeholder="Select type" /></SelectTrigger><SelectContent>{examTypesQuery.data?.filter(type => type.is_active).map(type => <SelectItem key={type.id} value={type.id}>{type.name}</SelectItem>)}</SelectContent></Select><Label>Custom title (optional)</Label><Input value={examForm.title} onChange={event => setExamForm(current => ({ ...current, title: event.target.value }))} placeholder="e.g. First Monthly Exam" /><Label>Examination mode</Label><Select value={examForm.hasRegularClasses ? 'with_classes' : 'exam_only'} onValueChange={value => setExamForm(current => ({ ...current, hasRegularClasses: value === 'with_classes' }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="with_classes">Exam + classes</SelectItem><SelectItem value="exam_only">Exam only</SelectItem></SelectContent></Select><p className="text-xs text-muted-foreground">This choice applies to every date in the routine.</p><Label>Subject papers</Label><Select value={examForm.combineSubjectPapers ? 'combined' : 'separate'} onValueChange={value => setExamForm(current => ({ ...current, combineSubjectPapers: value === 'combined' }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="separate">Take 1st and 2nd papers separately</SelectItem><SelectItem value="combined">Take both papers combined</SelectItem></SelectContent></Select><p className="text-xs text-muted-foreground">{examForm.combineSubjectPapers ? 'Each 1st/2nd-paper pair will appear as one subject, such as Bangla.' : 'Each paper will be configured as its own subject.'}</p><Label>Reference date</Label><Input type="date" value={examForm.date} min={examDateMin} max={examDateMax} onChange={event => setExamForm(current => ({ ...current, date: event.target.value }))} /></SimpleDialog>
      <SimpleDialog open={canEditExamination && editExamDialog} onOpenChange={setEditExamDialog} title="Edit examination" description="Changes apply to every class included in this examination." onSave={updateExam} saveLabel="Save changes">
        <Label>Fourth subject in GPA</Label>
        <Select value={editExamForm.countFourthSubject ? 'count' : 'exclude'} onValueChange={value => setEditExamForm(current => ({ ...current, countFourthSubject: value === 'count' }))}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="exclude">Do not count fourth subject</SelectItem><SelectItem value="count">Count fourth-subject bonus</SelectItem></SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">This changes GPA calculation for every class in the examination.</p>
        <Label>Exam type</Label>
        <Select value={editExamForm.typeId} onValueChange={value => setEditExamForm(current => ({ ...current, typeId: value }))}><SelectTrigger><SelectValue placeholder="Select type" /></SelectTrigger><SelectContent>{examTypesQuery.data?.filter(type => type.is_active || type.id === editExamForm.typeId).map(type => <SelectItem key={type.id} value={type.id}>{type.name}</SelectItem>)}</SelectContent></Select>
        <Label>Custom title (optional)</Label>
        <Input value={editExamForm.title} onChange={event => setEditExamForm(current => ({ ...current, title: event.target.value }))} />
        <Label>Examination mode</Label>
        <Select value={editExamForm.hasRegularClasses ? 'with_classes' : 'exam_only'} onValueChange={value => setEditExamForm(current => ({ ...current, hasRegularClasses: value === 'with_classes' }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="with_classes">Exam + classes</SelectItem><SelectItem value="exam_only">Exam only</SelectItem></SelectContent></Select>
        <p className="text-xs text-muted-foreground">Exam-only mode requires a time on every existing routine row.</p>
        <Label>Subject papers</Label>
        <Select value={editExamForm.combineSubjectPapers ? 'combined' : 'separate'} onValueChange={value => setEditExamForm(current => ({ ...current, combineSubjectPapers: value === 'combined' }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="separate">Take 1st and 2nd papers separately</SelectItem><SelectItem value="combined">Take both papers combined</SelectItem></SelectContent></Select>
        <p className="text-xs text-muted-foreground">Paper mode can be changed before subjects or routine rows are configured.</p>
        <Label>Reference date</Label>
        <Input type="date" value={editExamForm.date} onChange={event => setEditExamForm(current => ({ ...current, date: event.target.value }))} />
      </SimpleDialog>
      <Dialog open={settingsDialog} onOpenChange={setSettingsDialog}>
        <DialogContent className="flex max-h-[90vh] flex-col overflow-hidden p-0 sm:max-w-2xl">
          <DialogHeader className=" px-5 pt-4"><DialogTitle>Subject Settings</DialogTitle>
            <DialogDescription>
                Define the subjects available to each academic group.
            </DialogDescription>
          </DialogHeader>
          <div className="flex gap-1 px-5 pt-2">
            {(['humanities', 'science', 'business'] as ClassGroup[]).map(group => <Button key={group} type="button" size="sm" variant={settingsGroup === group ? 'default' : 'ghost'} className="capitalize" onClick={() => setSettingsGroup(group)}>{group}</Button>)}
          </div>
          <div className="flex items-center justify-between px-5 pt-2"><div><p className="font-semibold capitalize">{settingsGroup} subjects</p><p className="text-xs text-muted-foreground">Used by all {settingsGroup} classes and exams.</p></div><Button size="sm" onClick={() => { setEditingSubjectId(null); setSubjectForm({ name: '', code: '', isFourthSubject: false }); setSubjectDialog(true) }}><Plus className="mr-2 h-4 w-4" /> Add subject</Button></div>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5 pt-3">
            {subjectsQuery.isLoading ? <SubjectListSkeleton /> : !subjectsQuery.data?.length ? <EmptyState title="No subjects defined" description={`Add the first subject for ${settingsGroup}.`} /> : <div className="divide-y rounded-md border">{subjectsQuery.data.map(subject => <div key={subject.id} className="flex items-center gap-3 px-3 py-2.5"><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{subject.name}</p><p className="text-xs text-muted-foreground">{subject.code}</p></div>{subject.is_fourth_subject && <Badge variant="outline">Elective / fourth</Badge>}<Badge variant={subject.is_active ? 'secondary' : 'outline'}>{subject.is_active ? 'Active' : 'Disabled'}</Badge><Button type="button" variant="ghost" size="icon-sm" onClick={() => editSubject(subject)} aria-label={`Edit ${subject.name}`}><Pencil className="h-4 w-4" /></Button><Button type="button" variant="outline" size="sm" onClick={() => void toggleSubject(subject)}>{subject.is_active ? 'Disable' : 'Enable'}</Button></div>)}</div>}
          </div>
        </DialogContent>
      </Dialog>
      <SimpleDialog open={subjectDialog} onOpenChange={open => { setSubjectDialog(open); if (!open) { setEditingSubjectId(null); setSubjectForm({ name: '', code: '', isFourthSubject: false }) } }} title={editingSubjectId ? 'Edit group subject' : 'Add group subject'} description={`This subject belongs to the ${settingsGroup} group and will be available to all its exams.`} onSave={saveSubject} saveLabel={editingSubjectId ? 'Save changes' : 'Add subject'}><Label>Subject name</Label><Input value={subjectForm.name} onChange={event => setSubjectForm(current => ({ ...current, name: event.target.value }))} placeholder="Bangla" /><Label>Subject code</Label><Input value={subjectForm.code} onChange={event => setSubjectForm(current => ({ ...current, code: event.target.value }))} placeholder="BAN-101" /><label className="flex items-center gap-2 text-sm"><Checkbox checked={subjectForm.isFourthSubject} onCheckedChange={checked => setSubjectForm(current => ({ ...current, isFourthSubject: checked === true }))} /><span> Available as optional subject</span></label></SimpleDialog>
      <Dialog open={configDialog} onOpenChange={setConfigDialog}>
        <DialogContent className="flex h-[90dvh] max-h-[90dvh] flex-col overflow-hidden p-0 sm:h-auto sm:max-w-5xl">
          <DialogHeader className="shrink-0 border-b bg-muted/30 px-4 py-4 sm:px-6 sm:py-5"><DialogTitle>Configure exam subjects</DialogTitle><DialogDescription>{totalOnly ? "Select subjects and enter the total marks for each." : totalPass ? "Enter CQ and MCQ maximums. Set either to 0 when unused, such as CQ 20 and MCQ 0. Only the total has a pass mark." : <>{selectedExam?.combine_subject_papers ? 'Paired 1st and 2nd papers are combined into one subject. Define one marks configuration for each combined subject.' : 'Select subjects and define their creative, MCQ, practical, and pass marks.'} Each active section and the overall total must pass independently. Enter a pass mark for every active section.</>}</DialogDescription></DialogHeader>
          <div className="min-h-0 flex-1 overflow-auto">
            <Table className={totalOnly ? "min-w-[320px]" : totalPass ? "min-w-[650px]" : "min-w-[1350px]"}>
              <TableHeader><TableRow><TableHead className="w-12"><Checkbox checked={unusedSubjects.length > 0 && unusedSubjects.every(subject => configRows[subject.id]?.selected)} onCheckedChange={checked => setConfigRows(current => Object.fromEntries(unusedSubjects.map(subject => [subject.id, { ...current[subject.id], selected: Boolean(checked) }]))) } aria-label="Select all subjects" /></TableHead><TableHead className="min-w-48">Subject</TableHead>{!totalOnly && <><TableHead className="w-32">{totalPass ? 'CQ max' : 'Creative max'}</TableHead><TableHead className="w-32">MCQ max</TableHead>{!totalPass && <><TableHead className="w-32">Practical max</TableHead><TableHead className="w-32">Creative pass</TableHead><TableHead className="w-32">MCQ pass</TableHead><TableHead className="w-32">Practical pass</TableHead></>}<TableHead className="w-32">Total pass</TableHead></>}<TableHead className="w-32">{totalOnly ? "Total marks" : "Total max"}</TableHead></TableRow></TableHeader>
              <TableBody>{unusedSubjects.map(subject => {
                const row = configRows[subject.id] ?? { selected: false, creative: '', written: '', practical: '', creativePass: '', writtenPass: '', practicalPass: '', pass: '', total: '' }
                const update = (field: keyof ExamSubjectConfigDraft, value: string | boolean) => setConfigRows(current => ({ ...current, [subject.id]: { ...row, [field]: value } }))
                if (totalOnly) return <TableRow key={subject.id}>
                  <TableCell><Checkbox checked={row.selected} onCheckedChange={checked => update('selected', checked === true)} aria-label={`Select ${subject.name}`} /></TableCell>
                  <TableCell><p className="font-medium">{subject.name}</p><p className="text-xs text-muted-foreground">{subject.code}</p></TableCell>
                  <TableCell><Input aria-label={`${subject.name} total marks`} type="number" min={0.01} step="0.01" value={row.total} disabled={!row.selected} onChange={event => update('total', event.target.value)} /></TableCell>
                </TableRow>
                const updateComponent = (field: 'creative' | 'written' | 'practical', value: string) => {
                  const next = { ...row, [field]: value }
                  if (Number(value) <= 0) {
                    const passField = { creative: 'creativePass', written: 'writtenPass', practical: 'practicalPass' } as const
                    next[passField[field]] = ''
                  }
                  if (totalPass) next.practical = '0'
                  next.total = String((Number(next.creative) || 0) + (Number(next.written) || 0) + (Number(next.practical) || 0))
                  if (totalPass) next.pass = String(Math.round(Number(next.total) * 33) / 100)
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
                    creativePass: row.creativePass ? String(Math.round(Number(row.creativePass) * requested / currentTotal * 100) / 100) : '',
                    writtenPass: row.writtenPass ? String(Math.round(Number(row.writtenPass) * requested / currentTotal * 100) / 100) : '',
                    practicalPass: row.practicalPass ? String(Math.round(Number(row.practicalPass) * requested / currentTotal * 100) / 100) : '',
                  } }))
                }
                return <TableRow key={subject.id} className={row.selected ? 'bg-primary/5' : undefined}><TableCell><Checkbox checked={row.selected} onCheckedChange={checked => update('selected', Boolean(checked))} aria-label={`Select ${subject.name}`} /></TableCell><TableCell><p className="font-medium">{subject.name}</p><p className="text-xs text-muted-foreground">{subject.code}{subject.is_fourth_subject ? ' · Fourth subject' : ''}</p></TableCell><TableCell><Input type="number" min={0} step="0.01" value={row.creative} disabled={!row.selected} onChange={event => updateComponent('creative', event.target.value)} /></TableCell><TableCell><Input type="number" min={0} step="0.01" value={row.written} disabled={!row.selected} onChange={event => updateComponent('written', event.target.value)} /></TableCell>{!totalPass && <TableCell><Input type="number" min={0} step="0.01" value={row.practical} disabled={!row.selected} onChange={event => updateComponent('practical', event.target.value)} /></TableCell>}{!totalPass && ([
                    ['creativePass', 'creative', 'Creative'],
                    ['writtenPass', 'written', 'MCQ'],
                    ['practicalPass', 'practical', 'Practical'],
                  ] as const).map(([passField, maxField, label]) => (
                    <TableCell key={passField}>
                      <Input aria-label={`${subject.name} ${label} pass mark`} type="number" min={0.01} max={Number(row[maxField]) || 0} step="0.01" value={row[passField]} placeholder={Number(row[maxField]) > 0 ? 'Required' : 'N/A'} disabled={!row.selected || Number(row[maxField]) <= 0} onChange={event => update(passField, event.target.value)} />
                    </TableCell>
                  ))}<TableCell><Input type="number" min={0} max={row.total} step="0.01" value={row.pass} disabled={!row.selected} onChange={event => update('pass', event.target.value)} /></TableCell><TableCell><Input type="number" min={0.01} step="0.01" value={row.total} disabled={!row.selected} onChange={event => updateTotal(event.target.value)} /></TableCell></TableRow>
              })}</TableBody>
            </Table>
          </div>
          <DialogFooter className="shrink-0 flex-row justify-end gap-2 border-t bg-background px-4 py-3 sm:px-6 sm:py-4"><Button variant="outline" onClick={() => setConfigDialog(false)}>Cancel</Button><Button onClick={() => void attachSubjects()} disabled={!unusedSubjects.some(subject => configRows[subject.id]?.selected)}>Save configuration</Button></DialogFooter>
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
              <p>{totalOnly ? "Subject totals and class position" : "Subject totals, overall result, GPA, grade, and class position"}</p>
            </div>
            <table className="print-summary-table exam-results-print-table">
              <thead><tr><th>SN</th><th>Roll</th><th>Student</th><th>Admission</th>{examSubjectsQuery.data.map(subject => <th key={subject.id}>{examSubjectCode(subject)}<br />/{examSubjectTotal(subject)}</th>)}<th>Total</th>{!totalOnly && <><th>GPA</th><th>Grade</th></>}<th>Pos.</th></tr></thead>
              <tbody>{examResultRows.map((row, index) => <tr key={row.id}><td>{index + 1}</td><td>{row.roll ?? '-'}</td><td>{row.name}</td><td>{row.admission}</td>{examSubjectsQuery.data!.map(subject => <td key={subject.id}>{examSubjectResultText(row, subject)}</td>)}<td>{row.complete ? `${row.totalObtained}/${row.totalMax}` : '-'}</td>{!totalOnly && <><td>{row.gpa == null ? '-' : row.gpa.toFixed(2)}</td><td>{row.grade}</td></>}<td>{row.position ?? '-'}</td></tr>)}</tbody>
            </table>
            <p className="print-footnote">A dash indicates an incomplete result. Subject columns show obtained marks over the configured maximum.</p>
          </section>
        </div>
      )}
    </div>
  )
}
