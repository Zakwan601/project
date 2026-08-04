import { useEffect, useState } from 'react'
import { MessageSquareText, RefreshCw } from 'lucide-react'
import { formatDisplayDateTime } from '@/lib/dateTime'
import { PageHeader } from '@/components/shared/PageHeader'
import { DateFilter } from '@/components/shared/DateFilter'
import { PaginationFooter } from '@/components/shared/PaginationFooter'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useSmsMessages } from '@/hooks/useSmsMessages'
import type { SmsMessage, SmsMessageStatus } from '@/types/database'

const statusOptions: Array<{ value: SmsMessageStatus | 'all'; label: string }> = [
  { value: 'all', label: 'All statuses' },
  { value: 'queued', label: 'Queued' },
  { value: 'processing', label: 'Processing' },
  { value: 'submitted', label: 'Submitted' },
  { value: 'delivered', label: 'Delivered' },
  { value: 'failed', label: 'Failed' },
]

export function SmsMessagesPage() {
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [status, setStatus] = useState<SmsMessageStatus | 'all'>('all')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const { data, isLoading, isFetching, error, refetch } = useSmsMessages({ page, pageSize, status, startDate, endDate })

  useEffect(() => {
    const totalPages = Math.max(1, Math.ceil((data?.total ?? 0) / pageSize))
    if (page > totalPages) setPage(totalPages)
  }, [data?.total, page, pageSize])

  return (
    <div>
      <PageHeader
        title="SMS Messages"
        description="View every SMS submitted by the attendance system."
        action={(
          <Button variant="outline" onClick={() => void refetch()} disabled={isFetching}>
            <RefreshCw className={isFetching ? 'animate-spin' : ''} />
            Refresh
          </Button>
        )}
      />

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
          <p className="text-sm text-muted-foreground">
            {data ? `${data.total.toLocaleString()} message${data.total === 1 ? '' : 's'}` : 'SMS history'}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <DateFilter
              mode="range"
              startDate={startDate}
              endDate={endDate}
              onChange={(start, end) => {
                setStartDate(start)
                setEndDate(end)
                setPage(1)
              }}
              allowClear
              className="w-full sm:w-72"
            />
            <Select
              value={status}
              onValueChange={value => {
                setStatus(value as SmsMessageStatus | 'all')
                setPage(1)
              }}
            >
              <SelectTrigger className="w-44" aria-label="Filter by SMS status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {statusOptions.map(option => (
                  <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <CardContent className="p-0">
          {isLoading ? (
            <MessageState message="Loading SMS messages..." />
          ) : error ? (
            <MessageState message={(error as Error).message} error />
          ) : !data?.rows.length ? (
            <MessageState message={emptyMessage(status, startDate, endDate)} />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Recipient</TableHead>
                    <TableHead>Message</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Source</TableHead>
                    <TableHead>Sent at</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.rows.map(message => <SmsMessageRow key={message.id} message={message} />)}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>

        {!isLoading && !error && (data?.total ?? 0) > 0 && (
          <PaginationFooter
            page={page}
            pageSize={pageSize}
            total={data?.total ?? 0}
            isFetching={isFetching}
            onPageChange={setPage}
            onPageSizeChange={value => {
              setPageSize(value)
              setPage(1)
            }}
          />
        )}
      </Card>
    </div>
  )
}

function SmsMessageRow({ message }: { message: SmsMessage }) {
  return (
    <TableRow>
      <TableCell className="align-top">
        <p className="font-mono text-sm font-medium">{message.recipient}</p>
        <p className="mt-1 text-xs text-muted-foreground">From {message.sender_id}</p>
      </TableCell>
      <TableCell className="min-w-72 max-w-xl align-top">
        <details className="group">
          <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden">
            <p className="line-clamp-2 whitespace-pre-wrap text-sm">{message.message}</p>
            <span className="mt-1 inline-block text-xs text-primary group-open:hidden">Show details</span>
          </summary>
          <div className="mt-3 space-y-3 rounded-md bg-muted/40 p-3 text-xs">
            <p className="whitespace-pre-wrap text-sm">{message.message}</p>
            <div className="grid gap-2 text-muted-foreground sm:grid-cols-2">
              <Detail label="Message ID" value={message.provider_message_id} mono />
              <Detail label="Provider status" value={providerStatus(message)} />
              <Detail label="Submitted" value={dateValue(message.submitted_at)} />
              <Detail label="Delivered" value={dateValue(message.delivered_at)} />
              <Detail label="Failed" value={dateValue(message.failed_at)} />
              <Detail label="Scheduled" value={dateValue(message.scheduled_at)} />
            </div>
          </div>
        </details>
      </TableCell>
      <TableCell className="align-top"><StatusBadge status={message.status} /></TableCell>
      <TableCell className="align-top text-sm text-muted-foreground">{message.source || '—'}</TableCell>
      <TableCell className="whitespace-nowrap align-top text-sm">
        {dateValue(message.submitted_at ?? message.created_at)}
      </TableCell>
    </TableRow>
  )
}

function StatusBadge({ status }: { status: SmsMessageStatus }) {
  const className = status === 'delivered'
    ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
    : status === 'failed'
      ? 'border-destructive/30 bg-destructive/10 text-destructive'
      : status === 'submitted'
        ? 'border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-400'
        : ''

  return <Badge variant="outline" className={`capitalize ${className}`}>{status}</Badge>
}

function Detail({ label, value, mono = false }: { label: string; value: string | null; mono?: boolean }) {
  return <p className={mono ? 'font-mono' : ''}><span className="font-medium text-foreground">{label}:</span> {value || '—'}</p>
}

function providerStatus(message: SmsMessage) {
  const parts = [message.provider_status_code?.toString(), message.provider_status_text].filter(Boolean)
  return parts.length ? parts.join(' · ') : null
}

function dateValue(value: string | null) {
  if (!value) return '—'
  return formatDisplayDateTime(value)
}

function MessageState({ message, error = false }: { message: string; error?: boolean }) {
  return (
    <div className={`flex flex-col items-center justify-center gap-2 px-5 py-16 text-sm ${error ? 'text-destructive' : 'text-muted-foreground'}`}>
      <MessageSquareText className="h-8 w-8 opacity-60" />
      <p>{message}</p>
    </div>
  )
}

function emptyMessage(status: SmsMessageStatus | 'all', startDate: string, endDate: string) {
  if ((startDate || endDate) && status !== 'all') return `No ${status} SMS messages found in the selected period.`
  if (startDate || endDate) return 'No SMS messages found in the selected period.'
  if (status !== 'all') return `No ${status} SMS messages found.`
  return 'No SMS messages have been sent yet.'
}
