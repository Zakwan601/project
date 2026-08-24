import { useMemo, useState } from 'react'
import { format } from 'date-fns'
import { CalendarOff, Loader2, Plus, Trash2 } from 'lucide-react'
import { PageHeader } from '@/components/shared/PageHeader'
import { DatePickerInput } from '@/components/shared/DatePickerInput'
import { useMarkAttendanceVacation } from '@/hooks/useAttendance'
import { useDeleteHoliday, useHolidays } from '@/hooks/useHolidays'
import { formatDisplayDate } from '@/lib/dateTime'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { useAuth } from '@/contexts/AuthContext'

export function VacationsPage() {
  const { can } = useAuth()
  const canWriteVacations = can('vacations', 'write')
  const today = format(new Date(), 'yyyy-MM-dd')
  const [date, setDate] = useState(today)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const { data: holidays = [], isLoading, error } = useHolidays()
  const markVacation = useMarkAttendanceVacation()
  const deleteHoliday = useDeleteHoliday()
  const sortedHolidays = useMemo(
    () => [...holidays].sort((a, b) => b.date.localeCompare(a.date)),
    [holidays],
  )
  const selectedDateIsWeekend = isWeekend(date)

  const submit = (event: React.FormEvent) => {
    event.preventDefault()
    if (!date || !name.trim() || selectedDateIsWeekend) return
    markVacation.mutate(
      { date, name: name.trim(), description: description.trim() || undefined },
      { onSuccess: () => { setName(''); setDescription('') } },
    )
  }

  return (
    <div className="space-y-3 sm:space-y-6">
      <PageHeader title="Vacations" description="Add school vacations and exclude those dates from attendance." />
      {canWriteVacations && <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <CalendarOff className="h-5 w-5" /> Add Vacation
          </CardTitle>
          <CardDescription>
            If attendance was already synchronized for the date, it will be removed automatically.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-[220px_1fr]">
              <div className="space-y-1.5">
                <Label htmlFor="vacation-date">Date</Label>
                <DatePickerInput id="vacation-date" value={date} onChange={setDate} required />
                {selectedDateIsWeekend && (
                  <p className="text-xs text-destructive">Friday and Saturday are already automatic weekends.</p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="vacation-name">Vacation name</Label>
                <Input id="vacation-name" value={name} onChange={event => setName(event.target.value)}
                  maxLength={120} placeholder="e.g. Summer Vacation" required />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="vacation-description">Description (optional)</Label>
              <Textarea id="vacation-description" value={description}
                onChange={event => setDescription(event.target.value)}
                maxLength={500} rows={3} placeholder="Reason or additional details" />
            </div>
            <Button type="submit"
              disabled={!date || !name.trim() || selectedDateIsWeekend || markVacation.isPending}>
              {markVacation.isPending ? <Loader2 className="animate-spin" /> : <Plus />}
              {markVacation.isPending ? 'Adding...' : 'Add Vacation'}
            </Button>
          </form>
        </CardContent>
      </Card>}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">School Vacations</CardTitle>
          <CardDescription>Students can also see upcoming vacations on their dashboard.</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="py-5 text-sm text-muted-foreground">Loading vacations...</p>
          ) : error ? (
            <p className="py-5 text-sm text-destructive">{(error as Error).message}</p>
          ) : sortedHolidays.length === 0 ? (
            <p className="py-5 text-sm text-muted-foreground">No vacations have been added yet.</p>
          ) : (
            <div className="divide-y rounded-lg border">
              {sortedHolidays.map(holiday => {
                const isPast = holiday.date < today
                return (
                  <article key={holiday.id} className="flex items-start justify-between gap-3 p-3 sm:p-4">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="font-semibold">{holiday.name}</h3>
                        <Badge variant={isPast ? 'secondary' : 'outline'}>
                          {isPast ? 'Past' : holiday.date === today ? 'Today' : 'Upcoming'}
                        </Badge>
                      </div>
                      <p className="mt-1 text-sm font-medium text-violet-700 dark:text-violet-300">
                        {formatDisplayDate(holiday.date)}
                      </p>
                      {holiday.description && (
                        <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">
                          {holiday.description}
                        </p>
                      )}
                    </div>
                    {canWriteVacations && <Button type="button" size="icon-sm" variant="ghost"
                      className="shrink-0 text-destructive hover:text-destructive"
                      disabled={deleteHoliday.isPending}
                      onClick={() => {
                        if (window.confirm(`Remove "${holiday.name}" from vacations?`)) {
                          deleteHoliday.mutate(holiday.id)
                        }
                      }}
                      aria-label={`Remove ${holiday.name}`}>
                      <Trash2 />
                    </Button>}
                  </article>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function isWeekend(value: string) {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) return false
  const day = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])).getDay()
  return day === 5 || day === 6
}
