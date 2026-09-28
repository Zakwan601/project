import { useQuery } from '@tanstack/react-query'
import { useParams } from 'react-router-dom'
import { Printer } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { ResultSheet } from '@/features/results/ResultSheet'
import { Button } from '@/components/ui/button'
import { ErrorState } from '@/components/shared/PageHeader'
import { Skeleton } from '@/components/ui/skeleton'
import type { StudentResultPayload } from '@/types/database'

// New result RPCs are deployed by the accompanying migration.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any

export function SharedResultPage() {
  const { token } = useParams()
  const resultQuery = useQuery<StudentResultPayload>({
    queryKey: ['shared-result', token],
    enabled: Boolean(token),
    retry: false,
    queryFn: async () => {
      const { data, error } = await db.rpc('get_shared_student_result', { p_token: token })
      if (error) throw error
      return data as StudentResultPayload
    },
  })

  if (resultQuery.isLoading) return <SharedResultSkeleton />
  if (resultQuery.error || !resultQuery.data) {
    return <div className="mx-auto min-h-screen max-w-xl p-6"><ErrorState message={(resultQuery.error as Error)?.message || 'Result not found'} /></div>
  }

  return (
    <main className="min-h-screen bg-muted/30 p-3 sm:p-8">
      <div className="mx-auto mb-4 flex max-w-5xl justify-end print:hidden">
        <Button onClick={() => window.print()}><Printer className="mr-2 h-4 w-4" /> Print result</Button>
      </div>
      <ResultSheet result={resultQuery.data} publicView />
    </main>
  )
}

function SharedResultSkeleton() {
  return (
    <main className="min-h-screen bg-muted/30 p-3 sm:p-8" role="status" aria-label="Loading shared result">
      <div className="mx-auto max-w-5xl rounded-lg border bg-background p-5">
        <div className="flex justify-between gap-4 border-b pb-5">
          <div><Skeleton className="h-7 w-56" /><Skeleton className="mt-2 h-3 w-40" /></div>
          <Skeleton className="h-20 w-28" />
        </div>
        <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {Array.from({ length: 4 }, (_, index) => <Skeleton key={index} className="h-16 w-full" />)}
        </div>
        <div className="mt-5 space-y-3">
          {Array.from({ length: 8 }, (_, index) => <Skeleton key={index} className="h-11 w-full" />)}
        </div>
      </div>
    </main>
  )
}
