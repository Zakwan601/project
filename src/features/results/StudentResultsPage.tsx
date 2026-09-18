import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Printer } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { EmptyState, ErrorState, LoadingState, PageHeader } from '@/components/shared/PageHeader'
import { ResultSheet } from '@/features/results/ResultSheet'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { StudentResultPayload } from '@/types/database'
import type { ExamWithDetails } from '@/features/results/result-model'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any

export function StudentResultsPage() {
  const { student } = useAuth()
  const [examId, setExamId] = useState('')
  const examsQuery = useQuery<ExamWithDetails[]>({
    queryKey: ['student-result-exams', student?.id],
    enabled: Boolean(student?.id),
    queryFn: async () => {
      const { data, error } = await db.from('result_exams')
        .select('*, result_exam_types(name), academic_years(name), classes(name, grade, section, class_group)')
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

  return <div>
    <PageHeader title="My Results" description="Incase of any discrepency, contact teacher." action={resultQuery.data ? <Button variant="outline" onClick={() => window.print()}><Printer className="mr-2 h-4 w-4" /> Print</Button> : undefined} />
    {!examsQuery.data?.length ? <EmptyState title="No published results" description="Your results will appear here after publication." /> : <>
      <div className="mb-5 max-w-md">
        <Label>Examination</Label>
        <Select value={examId} onValueChange={setExamId}>
          <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
          <SelectContent>{examsQuery.data.map(exam => <SelectItem key={exam.id} value={exam.id}>{exam.result_exam_types.name} · {exam.classes.name} · {exam.exam_date}</SelectItem>)}</SelectContent>
        </Select>
      </div>
      {resultQuery.isLoading ? <LoadingState /> : resultQuery.error ? <ErrorState message={(resultQuery.error as Error).message} /> : resultQuery.data ? <ResultSheet result={resultQuery.data} /> : null}
    </>}
  </div>
}
