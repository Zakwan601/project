import { useQuery } from '@tanstack/react-query'
import { useParams } from 'react-router-dom'
import { Printer } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { ResultSheet } from '@/features/results/ResultSheet'
import { Button } from '@/components/ui/button'
import { LoadingState, ErrorState } from '@/components/shared/PageHeader'
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

  if (resultQuery.isLoading) return <div className="min-h-screen p-6"><LoadingState /></div>
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
