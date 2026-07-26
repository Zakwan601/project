import { Clock3, ScanLine, UserRound } from 'lucide-react'
import { useDashboardPunches } from '@/hooks/useDeviceLogs'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ScrollArea } from '@/components/ui/scroll-area'

interface PunchHistoryCardProps {
  admissionNumber?: string
  title: string
  description: string
}

export function PunchHistoryCard({
  admissionNumber,
  title,
  description,
}: PunchHistoryCardProps) {
  const { data: punches = [], isLoading, error } = useDashboardPunches(admissionNumber)

  return (
    <Card>
      <CardHeader className="border-b">
        <div className="flex items-start justify-between gap-4">
          <div>
            <CardTitle className="flex items-center gap-2">
              <ScanLine className="h-5 w-5" />
              {title}
            </CardTitle>
            <CardDescription className="mt-1">{description}</CardDescription>
          </div>
          {!isLoading && !error && (
            <span className="shrink-0 rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">
              {punches.length} {punches.length === 1 ? 'punch' : 'punches'}
            </span>
          )}
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {isLoading ? (
          <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
            <Clock3 className="h-4 w-4 animate-pulse" />
            Loading punches...
          </div>
        ) : error ? (
          <p className="px-5 py-10 text-center text-sm text-destructive">
            {(error as Error).message}
          </p>
        ) : punches.length === 0 ? (
          <div className="px-5 py-12 text-center">
            <ScanLine className="mx-auto mb-3 h-8 w-8 text-muted-foreground/60" />
            <p className="text-sm font-medium">No punches found</p>
            <p className="mt-1 text-xs text-muted-foreground">
              New biometric punches will appear here automatically.
            </p>
          </div>
        ) : (
          <ScrollArea className="h-[520px]">
            <div>
              {punches.map(punch => {
                const name = punch.student
                  ? `${punch.student.first_name} ${punch.student.last_name}`.trim()
                  : 'Unknown user'
                const initials = punch.student
                  ? `${punch.student.first_name[0] ?? ''}${punch.student.last_name[0] ?? ''}`
                  : ''
                const { date, time } = splitPunchTime(punch.punched_at)

                return (
                  <div
                    key={punch.id}
                    className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 border-b px-4 py-3 last:border-b-0 sm:px-5"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <Avatar className="h-10 w-10 border">
                        {punch.student?.photo_url && (
                          <AvatarImage src={punch.student.photo_url} alt={name} />
                        )}
                        <AvatarFallback>
                          {initials || <UserRound className="h-5 w-5" />}
                        </AvatarFallback>
                      </Avatar>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold">
                          {punch.student_biometric_id}
                        </p>
                        <p className="truncate text-sm text-muted-foreground">{name}</p>
                      </div>
                    </div>

                    <div className="text-right">
                      <p className="flex items-center justify-end gap-1.5 text-sm font-medium">
                        <ScanLine className="h-4 w-4 text-muted-foreground" />
                        Auto add
                      </p>
                      <p className="mt-0.5 font-mono text-sm">{time}</p>
                      <p className="text-[11px] text-muted-foreground">{date}</p>
                    </div>
                  </div>
                )
              })}
            </div>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  )
}

function splitPunchTime(value: string) {
  const match = value.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})/)
  if (match) return { date: match[1], time: match[2] }

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return { date: '', time: value }
  return {
    date: date.toLocaleDateString(),
    time: date.toLocaleTimeString([], { hour12: false }),
  }
}
