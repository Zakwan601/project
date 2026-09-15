import type { ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'

export function MarkInput({ label, value, max, disabled, onChange }: {
  label: string
  value: string
  max: number
  disabled: boolean
  onChange: (value: string) => void
}) {
  const normalizeMark = (input: string) => {
    const digitsAndDecimal = input.replace(/[^\d.]/g, '')
    const decimalIndex = digitsAndDecimal.indexOf('.')
    const normalized = decimalIndex < 0
      ? digitsAndDecimal
      : `${digitsAndDecimal.slice(0, decimalIndex)}.${digitsAndDecimal.slice(decimalIndex + 1).replace(/\./g, '').slice(0, 2)}`
    const withLeadingZero = normalized.startsWith('.') ? `0${normalized}` : normalized
    const numericValue = Number(withLeadingZero)
    return withLeadingZero !== '' && Number.isFinite(numericValue) && numericValue > max
      ? String(max)
      : withLeadingZero
  }

  return <Input
    aria-label={`${label}, maximum ${max}`}
    title={`Maximum ${max}`}
    type="number"
    inputMode="decimal"
    min={0}
    max={max}
    step={0.5}
    value={value}
    disabled={disabled || max <= 0}
    className="h-8 w-16 min-w-16 px-2 text-xs font-semibold tabular-nums sm:h-9 sm:w-auto sm:min-w-24 sm:text-sm"
    placeholder={max <= 0 ? 'N/A' : `0 / ${max}`}
    onKeyDown={event => {
      if (!event.ctrlKey && !event.metaKey && !event.altKey && event.key.length === 1 && !/[0-9.]/.test(event.key)) event.preventDefault()
    }}
    onPaste={event => {
      if (!/^\d*\.?\d*$/.test(event.clipboardData.getData('text'))) event.preventDefault()
    }}
    onChange={event => onChange(normalizeMark(event.target.value))}
  />
}

export function SimpleDialog({ open, onOpenChange, title, description, onSave, saveLabel, children }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: string
  onSave: () => unknown | Promise<unknown>
  saveLabel: string
  children: ReactNode
}) {
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="overflow-hidden p-0 sm:max-w-lg">
      <DialogHeader className="border-b bg-muted/30 px-6 py-3">
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{description}</DialogDescription>
      </DialogHeader>
      <div className="space-y-3 px-6 py-2 [&>label]:block">{children}</div>
      <DialogFooter className="bg-muted/20 px-6 py-4">
        <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
        <Button type="button" onClick={() => void onSave()}>{saveLabel}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
}
