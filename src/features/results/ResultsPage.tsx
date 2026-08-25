import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Copy, Eye, FilePlus2, Link2, Pencil, Plus, Power, Printer, Save, Send, Settings2, Trash2 } from 'lucide-react'
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
  const [config, setConfig] = useState({ subjectId: '', creative: '40', written: '40', practical: '20', pass: '33' })
  const [drafts, setDrafts] = useState<Record<string, MarkDraft>>({})
  const [shareUrl, setShareUrl] = useState('')

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

  useEffect(() => {
    if (!selectedStudentId || !examSubjectsQuery.data) return
    const bySubject = new Map((marksQuery.data ?? []).map(mark => [mark.exam_subject_id, mark]))
    setDrafts(Object.fromEntries(examSubjectsQuery.data.map(examSubject => {
      const mark = bySubject.get(examSubject.id)
      return [examSubject.id, {
        creative: mark?.creative_marks?.toString() ?? '', written: mark?.written_marks?.toString() ?? '',
        practical: mark?.practical_marks?.toString() ?? '', absent: mark?.is_absent ?? false,
      }]
    })))
  }, [selectedStudentId, examSubjectsQuery.data, marksQuery.data])

  const previewQuery = useQuery<StudentResultPayload>({
    queryKey: ['result-preview', examId, selectedStudentId], enabled: Boolean(examId && selectedStudentId),
    queryFn: async () => {
      const { data, error } = await db.rpc('get_student_result', { p_exam_id: examId, p_student_id: selectedStudentId })
      if (error) throw error
      return data as StudentResultPayload
    },
  })

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

  const attachSubject = async () => {
    const values = [config.creative, config.written, config.practical, config.pass].map(Number)
    if (!config.subjectId || values.some(Number.isNaN)) return toast.error('Complete the subject marks configuration')
    const { error } = await db.from('result_exam_subjects').insert({
      exam_id: examId, subject_id: config.subjectId, creative_max: values[0], written_max: values[1], practical_max: values[2], pass_mark: values[3],
      sort_order: (examSubjectsQuery.data?.length ?? 0) * 10,
    })
    if (error) return toast.error(error.message)
    setConfigDialog(false); setConfig({ subjectId: '', creative: '40', written: '40', practical: '20', pass: '33' })
    await qc.invalidateQueries({ queryKey: ['result-exam-subjects', examId] }); toast.success('Subject added to exam')
  }

  const saveMarks = useMutation({
    mutationFn: async () => {
      if (!selectedStudentId || !examSubjectsQuery.data) return
      const parse = (value: string) => value.trim() === '' ? null : Number(value)
      const rows = examSubjectsQuery.data.map(examSubject => ({
        exam_subject_id: examSubject.id, student_id: selectedStudentId,
        creative_marks: drafts[examSubject.id]?.absent ? null : parse(drafts[examSubject.id]?.creative ?? ''),
        written_marks: drafts[examSubject.id]?.absent ? null : parse(drafts[examSubject.id]?.written ?? ''),
        practical_marks: drafts[examSubject.id]?.absent ? null : parse(drafts[examSubject.id]?.practical ?? ''),
        is_absent: drafts[examSubject.id]?.absent ?? false, entered_by: user?.id,
      }))
      const { error } = await db.from('result_marks').upsert(rows, { onConflict: 'exam_subject_id,student_id' })
      if (error) throw error
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['result-student-marks', examId, selectedStudentId] })
      await qc.invalidateQueries({ queryKey: ['result-preview', examId] })
      toast.success('Marks saved')
    },
    onError: error => toast.error((error as Error).message),
  })

  const setStatus = async (status: 'draft' | 'published') => {
    const { error } = await db.from('result_exams').update({ status }).eq('id', examId)
    if (error) return toast.error(error.message)
    await qc.invalidateQueries({ queryKey: ['result-exams', classId] })
    await qc.invalidateQueries({ queryKey: ['result-preview', examId] })
    toast.success(status === 'published' ? 'Result published to students' : 'Result returned to draft')
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
    <div>
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
            {selectedExam && <Card><CardHeader><div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div><CardTitle>{selectedExam.title || selectedExam.result_exam_types.name}</CardTitle><CardDescription>{selectedExam.classes.name} · {selectedExam.exam_date}</CardDescription></div><div className="flex flex-wrap gap-2">{canWrite && selectedExam.status === 'draft' && <Button variant="outline" onClick={() => setConfigDialog(true)} disabled={!unusedSubjects.length}><Plus className="mr-2 h-4 w-4" /> Add exam subject</Button>}{canWrite && <Button onClick={() => setStatus(selectedExam.status === 'published' ? 'draft' : 'published')}><Send className="mr-2 h-4 w-4" /> {selectedExam.status === 'published' ? 'Unpublish' : 'Publish results'}</Button>}</div></div></CardHeader></Card>}

            {!examSubjectsQuery.data?.length ? <EmptyState title="No subjects configured" description="Add subjects to this exam and define their component marks." /> : <>
              <Card><CardHeader><CardTitle className="text-base">Select student</CardTitle><CardDescription>All configured subjects will appear together for the selected student.</CardDescription></CardHeader><CardContent><Select value={selectedStudentId} onValueChange={value => { setSelectedStudentId(value); setShareUrl('') }}><SelectTrigger className="max-w-xl"><SelectValue placeholder="Choose student by ID, name, or roll" /></SelectTrigger><SelectContent>{studentsQuery.data?.map(student => <SelectItem key={student.id} value={student.id}>{student.admission_number} · {student.first_name} {student.last_name} · Roll {student.roll_number ?? '—'}</SelectItem>)}</SelectContent></Select></CardContent></Card>
              {!selectedStudentId ? <EmptyState title="Choose a student to enter marks" description="You will see every subject serially in one table." /> : <Card><CardHeader><CardTitle className="text-base">All subject marks</CardTitle><CardDescription>{studentsQuery.data?.find(student => student.id === selectedStudentId)?.admission_number} · {studentsQuery.data?.find(student => student.id === selectedStudentId)?.first_name} {studentsQuery.data?.find(student => student.id === selectedStudentId)?.last_name}</CardDescription></CardHeader><CardContent className="p-0"><div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead className="min-w-48">Subject</TableHead><TableHead className="w-32">Creative</TableHead><TableHead className="w-32">Written</TableHead><TableHead className="w-32">Practical</TableHead><TableHead className="w-24 text-center">Absent</TableHead><TableHead className="text-right">Total</TableHead></TableRow></TableHeader><TableBody>{examSubjectsQuery.data.map(examSubject => {
                const draft = drafts[examSubject.id] ?? { creative: '', written: '', practical: '', absent: false }
                const total = [draft.creative, draft.written, draft.practical].reduce((sum, value) => sum + (Number(value) || 0), 0)
                const update = (field: keyof MarkDraft, value: string | boolean) => setDrafts(current => ({ ...current, [examSubject.id]: { ...draft, [field]: value } }))
                return <TableRow key={examSubject.id}><TableCell><p className="font-medium">{examSubject.subjects.name}</p><p className="text-xs text-muted-foreground">{examSubject.subjects.code} · Pass {examSubject.pass_mark} / {examSubject.creative_max + examSubject.written_max + examSubject.practical_max}</p></TableCell><MarkInput value={draft.creative} max={examSubject.creative_max} disabled={draft.absent || selectedExam?.status === 'published' || !canWrite} onChange={value => update('creative', value)} /><MarkInput value={draft.written} max={examSubject.written_max} disabled={draft.absent || selectedExam?.status === 'published' || !canWrite} onChange={value => update('written', value)} /><MarkInput value={draft.practical} max={examSubject.practical_max} disabled={draft.absent || selectedExam?.status === 'published' || !canWrite} onChange={value => update('practical', value)} /><TableCell className="text-center"><Checkbox checked={draft.absent} disabled={selectedExam?.status === 'published' || !canWrite} onCheckedChange={checked => update('absent', Boolean(checked))} /></TableCell><TableCell className="text-right font-semibold">{draft.absent ? 'Absent' : total}</TableCell></TableRow>
              })}</TableBody></Table></div>{canWrite && selectedExam?.status === 'draft' && <div className="flex flex-col gap-2 border-t p-4 sm:flex-row sm:justify-end"><Button variant="outline" onClick={() => setActiveTab('preview')}><Eye className="mr-2 h-4 w-4" /> Preview report</Button><Button onClick={() => saveMarks.mutate()} disabled={saveMarks.isPending}><Save className="mr-2 h-4 w-4" /> Save all subjects</Button></div>}</CardContent></Card>}
            </>}

            {selectedStudentId && <Card><CardHeader><CardTitle className="text-base">Report card and guardian link</CardTitle><CardDescription>Guardian links are available after publication and expire after 30 days.</CardDescription></CardHeader><CardContent><div className="flex flex-wrap gap-2"><Button variant="outline" onClick={() => setActiveTab('preview')}><Eye className="mr-2 h-4 w-4" /> View report card</Button>{canWrite && selectedExam?.status === 'published' && <Button variant="outline" onClick={createShareLink}><Link2 className="mr-2 h-4 w-4" /> Create guardian link</Button>}</div>{shareUrl && <div className="mt-3 flex items-center gap-2 rounded-md border bg-muted/40 p-2"><Input readOnly value={shareUrl} /><Button size="icon" variant="ghost" onClick={() => navigator.clipboard.writeText(shareUrl)}><Copy className="h-4 w-4" /></Button></div>}</CardContent></Card>}
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
      <SimpleDialog open={configDialog} onOpenChange={setConfigDialog} title="Configure exam subject" description="Set the component maximums and total pass mark." onSave={attachSubject} saveLabel="Add to exam"><Label>Subject</Label><Select value={config.subjectId} onValueChange={value => setConfig(current => ({ ...current, subjectId: value }))}><SelectTrigger><SelectValue placeholder="Select subject" /></SelectTrigger><SelectContent>{unusedSubjects.map(subject => <SelectItem key={subject.id} value={subject.id}>{subject.name} ({subject.code})</SelectItem>)}</SelectContent></Select><div className="grid grid-cols-2 gap-3"><NumberField label="Creative max" value={config.creative} onChange={value => setConfig(current => ({ ...current, creative: value }))} /><NumberField label="Written max" value={config.written} onChange={value => setConfig(current => ({ ...current, written: value }))} /><NumberField label="Practical max" value={config.practical} onChange={value => setConfig(current => ({ ...current, practical: value }))} /><NumberField label="Pass mark" value={config.pass} onChange={value => setConfig(current => ({ ...current, pass: value }))} /></div></SimpleDialog>
    </div>
  )
}

function MarkInput({ value, max, disabled, onChange }: { value: string; max: number; disabled: boolean; onChange: (value: string) => void }) {
  return <TableCell><Input type="number" min={0} max={max} step="0.01" value={value} disabled={disabled || max <= 0} placeholder={max <= 0 ? 'N/A' : `/${max}`} onChange={event => onChange(event.target.value)} /></TableCell>
}

function NumberField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <div><Label>{label}</Label><Input type="number" min={0} step="0.01" value={value} onChange={event => onChange(event.target.value)} /></div>
}

function SimpleDialog({ open, onOpenChange, title, description, onSave, saveLabel, children }: { open: boolean; onOpenChange: (open: boolean) => void; title: string; description: string; onSave: () => unknown | Promise<unknown>; saveLabel: string; children: React.ReactNode }) {
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent><DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription>{description}</DialogDescription></DialogHeader><div className="space-y-3">{children}</div><DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button><Button onClick={() => void onSave()}>{saveLabel}</Button></DialogFooter></DialogContent></Dialog>
}
