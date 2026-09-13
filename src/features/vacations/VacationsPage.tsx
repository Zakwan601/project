import { useMemo, useState } from 'react'
import { format } from 'date-fns'
import { CalendarOff, Loader2, Plus, Trash2 } from 'lucide-react'
import { PageHeader } from '@/components/shared/PageHeader'
import { DatePickerInput } from '@/components/shared/DatePickerInput'
import { useMarkAttendanceVacation } from '@/hooks/useAttendance'
import { useDeleteHoliday, useHolidays } from '@/hooks/useHolidays'
import { useClasses } from '@/hooks/useClasses'
import { formatDisplayDate } from '@/lib/dateTime'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { useAuth } from '@/contexts/AuthContext'

export function VacationsPage() {
  const { can } = useAuth()
  const canWriteVacations = can('vacations', 'write')
  const today = format(new Date(), 'yyyy-MM-dd')
  const [date, setDate] = useState(today)
  const [endDate, setEndDate] = useState(today)
  const [useDateRange, setUseDateRange] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [allClasses, setAllClasses] = useState(true)
  const [selectedClassIds, setSelectedClassIds] = useState<Set<string>>(new Set())
  const { data: holidays = [], isLoading, error } = useHolidays()
  const { data: classes = [], isLoading: classesLoading } = useClasses()
  const markVacation = useMarkAttendanceVacation()
  const deleteHoliday = useDeleteHoliday()
  const sortedHolidays = useMemo(
    () => [...holidays].sort((a, b) => b.date.localeCompare(a.date)),
    [holidays],
  )
  const selectedDateIsWeekend = !useDateRange && isWeekend(date)
  const effectiveEndDate = useDateRange ? endDate : date
  const rangeOrderInvalid = useDateRange && Boolean(date && endDate && endDate < date)
  const workingDayCount = countWorkingDays(date, effectiveEndDate)
  const noWorkingDays = useDateRange && !rangeOrderInvalid && workingDayCount === 0
  const activeClasses = classes.filter(classItem => classItem.is_active)
  const classNames = new Map(activeClasses.map(classItem => [classItem.id, classItem.name]))
  const classSelectionInvalid = !allClasses && selectedClassIds.size === 0

  const submit = (event: React.FormEvent) => {
    event.preventDefault()
    if (!date || !effectiveEndDate || !name.trim() || selectedDateIsWeekend || rangeOrderInvalid || noWorkingDays || classSelectionInvalid) return
    markVacation.mutate(
      {
        date,
        endDate: useDateRange ? endDate : undefined,
        name: name.trim(),
        description: description.trim() || undefined,
        classIds: allClasses ? undefined : [...selectedClassIds],
      },
      { onSuccess: () => { setName(''); setDescription('') } },
    )
  }

  return (
    <div className="space-y-3 sm:space-y-4">
      <PageHeader title="Vacations" description="Add school vacations and exclude those dates from attendance." />
      {canWriteVacations && <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <CalendarOff className="h-5 w-5" /> Add Vacation
          </CardTitle>
          <CardDescription>
            Add one day or an inclusive date range. Existing attendance for vacation dates is removed automatically.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="space-y-4">
            <div className="flex items-center gap-3 rounded-lg border p-3">
              <Switch
                id="vacation-date-range"
                checked={useDateRange}
                onCheckedChange={checked => {
                  setUseDateRange(checked)
                  if (checked && (!endDate || endDate < date)) setEndDate(date)
                }}
              />
              <Label htmlFor="vacation-date-range" className="cursor-pointer">Add a date range</Label>
            </div>
            <div className={useDateRange
              ? 'grid gap-3 sm:grid-cols-2 lg:grid-cols-[220px_220px_1fr]'
              : 'grid gap-3 sm:grid-cols-[220px_1fr]'}>
              <div className="space-y-1.5">
                <Label htmlFor="vacation-date">{useDateRange ? 'Start date' : 'Date'}</Label>
                <DatePickerInput id="vacation-date" value={date} onChange={setDate} required />
                {selectedDateIsWeekend && (
                  <p className="text-xs text-destructive">Friday and Saturday are already automatic weekends.</p>
                )}
              </div>
              {useDateRange && (
                <div className="space-y-1.5">
                  <Label htmlFor="vacation-end-date">End date</Label>
                  <DatePickerInput
                    id="vacation-end-date"
                    value={endDate}
                    onChange={setEndDate}
                    min={date}
                    required
                  />
                  {rangeOrderInvalid && (
                    <p className="text-xs text-destructive">End date must be on or after the start date.</p>
                  )}
                </div>
              )}
              <div className="space-y-1.5">
                <Label htmlFor="vacation-name">Vacation name</Label>
                <Input id="vacation-name" value={name} onChange={event => setName(event.target.value)}
                  maxLength={120} placeholder="e.g. Summer Vacation" required />
              </div>
            </div>
            {useDateRange && !rangeOrderInvalid && (
              <p className={noWorkingDays ? 'text-sm text-destructive' : 'text-sm text-muted-foreground'}>
                {noWorkingDays
                  ? 'This range only contains automatic weekend days.'
                  : `${workingDayCount} working ${workingDayCount === 1 ? 'day' : 'days'} will be marked. Fridays and Saturdays are skipped.`}
              </p>
            )}
            <div className="space-y-3 rounded-lg border p-3">
              <div className="flex items-center gap-3">
                <Switch
                  id="vacation-all-classes"
                  checked={allClasses}
                  onCheckedChange={setAllClasses}
                />
                <div>
                  <Label htmlFor="vacation-all-classes" className="cursor-pointer">All classes</Label>
                  <p className="text-xs text-muted-foreground">
                    Turn this off to choose only the classes that will be on vacation.
                  </p>
                </div>
              </div>
              {!allClasses && (
                <div className="grid gap-2 border-t pt-3 sm:grid-cols-2 lg:grid-cols-3">
                  {classesLoading ? (
                    <p className="text-sm text-muted-foreground">Loading classes...</p>
                  ) : activeClasses.length === 0 ? (
                    <p className="text-sm text-destructive">No active classes are available.</p>
                  ) : activeClasses.map(classItem => (
                    <label
                      key={classItem.id}
                      className="flex cursor-pointer items-start gap-2 rounded-md border p-2.5 hover:bg-muted/50"
                    >
                      <Checkbox
                        checked={selectedClassIds.has(classItem.id)}
                        onCheckedChange={checked => {
                          setSelectedClassIds(current => {
                            const next = new Set(current)
                            if (checked) next.add(classItem.id)
                            else next.delete(classItem.id)
                            return next
                          })
                        }}
                        aria-label={`Select ${classItem.name}`}
                      />
                      <span className="text-sm">
                        <span className="block font-medium">{classItem.name}</span>
                        <span className="text-xs text-muted-foreground">
                          Grade {classItem.grade} {classItem.section}
                        </span>
                      </span>
                    </label>
                  ))}
                </div>
              )}
              {classSelectionInvalid && (
                <p className="text-xs text-destructive">Select at least one class.</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="vacation-description">Description (optional)</Label>
              <Textarea id="vacation-description" value={description}
                onChange={event => setDescription(event.target.value)}
                maxLength={500} rows={3} placeholder="Reason or additional details" />
            </div>
            <Button type="submit"
              disabled={!date || !effectiveEndDate || !name.trim() || selectedDateIsWeekend || rangeOrderInvalid || noWorkingDays || classSelectionInvalid || markVacation.isPending}>
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
                      <p className="mt-1 text-xs font-medium text-muted-foreground">
                        {holiday.class_ids == null
                          ? 'All classes'
                          : holiday.class_ids
                            .map(classId => classNames.get(classId) ?? 'Unknown class')
                            .join(', ')}
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

function countWorkingDays(startValue: string, endValue: string) {
  const start = parseDatabaseDate(startValue)
  const end = parseDatabaseDate(endValue)
  if (!start || !end || end < start) return 0

  let count = 0
  const date = new Date(start)
  while (date <= end) {
    if (date.getDay() !== 5 && date.getDay() !== 6) count += 1
    date.setDate(date.getDate() + 1)
  }
  return count
}

function parseDatabaseDate(value: string) {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) return null
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  return Number.isNaN(date.getTime()) ? null : date
}
