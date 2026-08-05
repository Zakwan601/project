import { endOfMonth, format, startOfMonth, subDays } from 'date-fns'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import { DatePickerInput } from '@/components/shared/DatePickerInput'

type DateFilterProps = {
  mode: 'date'
  value: string
  onChange: (value: string) => void
  label?: string
  allowClear?: boolean
  className?: string
} | {
  mode: 'month'
  value: string
  onChange: (value: string) => void
  label?: string
  className?: string
} | {
  mode: 'range'
  startDate: string
  endDate: string
  onChange: (startDate: string, endDate: string) => void
  startLabel?: string
  endLabel?: string
  allowClear?: boolean
  className?: string
}

export function DateFilter(props: DateFilterProps) {
  const today = new Date()
  const todayValue = format(today, 'yyyy-MM-dd')
  const yesterdayValue = format(subDays(today, 1), 'yyyy-MM-dd')

  if (props.mode === 'range') {
    const setToday = () => props.onChange(todayValue, todayValue)
    const setYesterday = () => props.onChange(yesterdayValue, yesterdayValue)
    const monthStart = format(startOfMonth(today), 'yyyy-MM-dd')
    const monthEnd = format(endOfMonth(today), 'yyyy-MM-dd')

    return (
      <div className={cn('space-y-2', props.className)}>
        <div className="grid grid-cols-2 gap-2">
          <DateInput label={props.startLabel ?? 'Start date'} value={props.startDate} onChange={value => props.onChange(value, props.endDate)} />
          <DateInput label={props.endLabel ?? 'End date'} value={props.endDate} onChange={value => props.onChange(props.startDate, value)} />
        </div>
        <div className="flex flex-wrap items-center gap-1.5" aria-label="Date shortcuts">
          <Shortcut label="Today" active={props.startDate === todayValue && props.endDate === todayValue} onClick={setToday} />
          <Shortcut label="Yesterday" active={props.startDate === yesterdayValue && props.endDate === yesterdayValue} onClick={setYesterday} />
          <Shortcut label="This month" active={props.startDate === monthStart && props.endDate === monthEnd} onClick={() => props.onChange(monthStart, monthEnd)} />
          {props.allowClear && (props.startDate || props.endDate) && (
            <Button type="button" size="xs" variant="ghost" onClick={() => props.onChange('', '')}>
              <X /> Clear
            </Button>
          )}
        </div>
      </div>
    )
  }

  if (props.mode === 'month') {
    const currentMonth = format(today, 'yyyy-MM')
    const yesterdayMonth = format(subDays(today, 1), 'yyyy-MM')
    return (
      <div className={cn('space-y-2', props.className)}>
        <div className="space-y-1.5">
          <Label className="text-xs">{props.label ?? 'Month'}</Label>
          <Input type="month" value={props.value} onChange={event => props.onChange(event.target.value)} />
        </div>
        <div className="flex flex-wrap gap-1.5" aria-label="Date shortcuts">
          <Shortcut label="Today" active={props.value === currentMonth} onClick={() => props.onChange(currentMonth)} />
          <Shortcut label="Yesterday" active={props.value === yesterdayMonth} onClick={() => props.onChange(yesterdayMonth)} />
          <Shortcut label="This month" active={props.value === currentMonth} onClick={() => props.onChange(currentMonth)} />
        </div>
      </div>
    )
  }

  return (
    <div className={cn('space-y-2', props.className)}>
      <DateInput label={props.label ?? 'Date'} value={props.value} onChange={props.onChange} />
      <div className="flex flex-wrap gap-1.5" aria-label="Date shortcuts">
        <Shortcut label="Today" active={props.value === todayValue} onClick={() => props.onChange(todayValue)} />
        <Shortcut label="Yesterday" active={props.value === yesterdayValue} onClick={() => props.onChange(yesterdayValue)} />
        {props.allowClear && props.value && (
          <Button type="button" size="xs" variant="ghost" onClick={() => props.onChange('')}>
            <X /> Clear
          </Button>
        )}
      </div>
    </div>
  )
}

function DateInput({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <div className="min-w-0 space-y-1.5">
      <Label className="text-xs">{label}</Label>
      <DatePickerInput value={value} onChange={onChange} />
    </div>
  )
}

function Shortcut({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <Button type="button" size="xs" variant={active ? 'secondary' : 'outline'} onClick={onClick}>
      {label}
    </Button>
  )
}
