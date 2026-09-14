import { Search } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

export function StudentSearchInput({ value, onChange, placeholder = 'Search by student ID or name', className }: {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  className?: string
}) {
  return (
    <div className={cn('relative min-w-0 w-full', className)}>
      <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <Input type="search" aria-label={placeholder} placeholder={placeholder} value={value}
        onChange={event => onChange(event.target.value)} className="pl-9" />
    </div>
  )
}
