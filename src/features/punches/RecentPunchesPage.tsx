import { useState } from 'react'
import { Archive, Loader2, RefreshCw } from 'lucide-react'
import { useIsFetching, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { PunchHistoryCard } from '@/components/attendance/PunchHistoryCard'
import { DatePickerInput } from '@/components/shared/DatePickerInput'
import { EmptyState, PageHeader } from '@/components/shared/PageHeader'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useAuth } from '@/contexts/AuthContext'
import { DEVICE_LOGS_KEY } from '@/hooks/useDeviceLogs'
import { useClasses } from '@/hooks/useClasses'
import { supabase } from '@/lib/supabase'

const db = supabase as any
const ARCHIVE_STATUS_KEY = 'device-log-archive-status'

type ArchiveResult = {
  archive_before: string
  class_id: string
  class_name: string
  archived: number
  deleted: number
  has_more: boolean
}

export function RecentPunchesPage() {
  const { role, student } = useAuth()
  const queryClient = useQueryClient()
  const [archiveOpen, setArchiveOpen] = useState(false)
  const [archiveBefore, setArchiveBefore] = useState('')
  const [archiveClassId, setArchiveClassId] = useState('')
  const { data: classes, isLoading: classesLoading } = useClasses()
  const isRefreshing = useIsFetching({ queryKey: [DEVICE_LOGS_KEY] }) > 0
  const isStudent = role === 'student'
  const isFullAdmin = role === 'admin'

  const archiveStatus = useQuery({
    queryKey: [ARCHIVE_STATUS_KEY],
    enabled: isFullAdmin,
    queryFn: async () => {
      const { data, error } = await db
        .from('device_log_archive_runs')
        .select('archive_before,class_id,completed_at')
        .order('archive_before', { ascending: false })
        .order('completed_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (error) throw error
      return data as { archive_before: string; class_id: string | null; completed_at: string } | null
    },
  })

  const archivePunches = useMutation({
    mutationFn: async () => {
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession()
      if (sessionError) throw sessionError
      const accessToken = sessionData.session?.access_token
      if (!accessToken) throw new Error('Authentication required')

      const { data, error } = await supabase.functions.invoke<ArchiveResult>('archive-device-logs', {
        body: {
          action: 'archive',
          archiveBefore,
          classId: archiveClassId,
          batchSize: 500,
          maxBatches: 20,
        },
        headers: { Authorization: 'Bearer ' + accessToken },
      })
      if (error) throw error
      if (!data) throw new Error('The archive service returned no result')
      return data
    },
    onSuccess: async result => {
      await queryClient.invalidateQueries({ queryKey: [DEVICE_LOGS_KEY] })
      await queryClient.invalidateQueries({ queryKey: [ARCHIVE_STATUS_KEY] })
      if (result.has_more) {
        toast.warning(`${result.deleted} ${result.class_name} punches moved. Run the same class and cutoff again to finish.`)
      } else {
        toast.success(`${result.deleted} ${result.class_name} punches archived successfully.`)
        setArchiveOpen(false)
        setArchiveBefore('')
        setArchiveClassId('')
      }
    },
    onError: (error: Error) => toast.error(error.message),
  })

  const refreshPunches = () => queryClient.refetchQueries({
    queryKey: [DEVICE_LOGS_KEY],
    type: 'active',
  })

  if (isStudent && !student) {
    return (
      <EmptyState
        title="Student profile not linked"
        description="Contact your administrator to view your punches."
      />
    )
  }

  return (
    <div>
      <PageHeader
        title={isStudent ? 'My Punches' : 'Recent Punches'}
        description={isStudent
          ? 'Review your daily biometric arrival and departure times.'
          : 'Review biometric punches recorded across all students.'}
        action={(
          <div className="flex flex-wrap items-center gap-2">
            {isFullAdmin && (
              <Button variant="outline" size="sm" onClick={() => setArchiveOpen(true)}>
                <Archive className="mr-1.5 h-4 w-4" />
                Archive punches
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={refreshPunches} disabled={isRefreshing}>
              <RefreshCw className={`mr-1.5 h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />
              {isRefreshing ? 'Refreshing...' : 'Refresh'}
            </Button>
          </div>
        )}
      />

      {isFullAdmin && archiveStatus.data && (
        <p className="mb-4 text-sm text-muted-foreground">
          Latest archive: {classes?.find(item => item.id === archiveStatus.data?.class_id)?.name ?? 'Selected class'} punches before {archiveStatus.data.archive_before}.
        </p>
      )}

      <PunchHistoryCard
        admissionNumber={isStudent ? student?.admission_number : undefined}
        title={isStudent ? 'My Daily Punch History' : 'Daily Punch History'}
        description=""
        variant="table"
        classes={classes}
      />

      <Dialog open={archiveOpen} onOpenChange={open => !archivePunches.isPending && setArchiveOpen(open)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Archive processed punches</DialogTitle>
            <DialogDescription>
              Move processed punches for one class before the selected date to the external archive database. Unprocessed punches remain in Supabase, and archived dates stay available here and for attendance recalculation.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="archive-class">Class</Label>
              <Select
                value={archiveClassId}
                onValueChange={setArchiveClassId}
                disabled={archivePunches.isPending || classesLoading}
              >
                <SelectTrigger id="archive-class">
                  <SelectValue placeholder={classesLoading ? 'Loading classes...' : 'Select class'} />
                </SelectTrigger>
                <SelectContent>
                  {classes?.map(item => (
                    <SelectItem key={item.id} value={item.id}>
                      {item.name} ({item.grade}-{item.section})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="archive-before">Archive punches before</Label>
            <DatePickerInput
              id="archive-before"
              value={archiveBefore}
              onChange={setArchiveBefore}
              max={todayInDhaka()}
              disabled={archivePunches.isPending}
              required
              allowClear
            />
            </div>
            <p className="text-xs text-muted-foreground">
              Punches on the selected date are not moved. Archiving runs only when you confirm it here.
            </p>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setArchiveOpen(false)}
              disabled={archivePunches.isPending}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => archivePunches.mutate()}
              disabled={!archiveClassId || !archiveBefore || archivePunches.isPending}
            >
              {archivePunches.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              {archivePunches.isPending ? 'Archiving...' : 'Archive punches'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function todayInDhaka() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Dhaka',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date())
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find(item => item.type === type)?.value
  return `${part('year')}-${part('month')}-${part('day')}`
}
