import { useState } from 'react'
import { format } from 'date-fns'
import { CalendarDays } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Calendar } from '@/components/ui/calendar'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import { formatDisplayDate } from '@/lib/dateTime'

interface DatePickerInputProps {
  value: string
  onChange: (value: string) => void
  id?: string
  min?: string
  max?: string
  disabled?: boolean
  required?: boolean
  placeholder?: string
  className?: string
}

export function DatePickerInput({
  value,
  onChange,
  id,
  min,
  max,
  disabled,
  required,
  placeholder = 'DD-MM-YYYY',
  className,
}: DatePickerInputProps) {
  const [open, setOpen] = useState(false)
  const selected = parseDatabaseDate(value)
  const minimum = parseDatabaseDate(min)
  const maximum = parseDatabaseDate(max)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          disabled={disabled}
          aria-required={required}
          className={cn(
            'w-full justify-between px-3 text-left font-normal',
            !value && 'text-muted-foreground',
            className,
          )}
        >
          <span>{value ? formatDisplayDate(value) : placeholder}</span>
          <CalendarDays className="h-4 w-4 opacity-60" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-0">
        <Calendar
          mode="single"
          selected={selected}
          defaultMonth={selected ?? minimum ?? new Date()}
          onSelect={date => {
            if (!date) return
            onChange(format(date, 'yyyy-MM-dd'))
            setOpen(false)
          }}
          disabled={date => Boolean(
            (minimum && date < minimum) ||
            (maximum && date > maximum),
          )}
          captionLayout="dropdown"
          startMonth={new Date(1900, 0, 1)}
          endMonth={new Date(2100, 11, 31)}
          autoFocus
        />
      </PopoverContent>
    </Popover>
  )
}

function parseDatabaseDate(value: string | null | undefined) {
  if (!value) return undefined
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) return undefined
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  return Number.isNaN(date.getTime()) ? undefined : date
}
