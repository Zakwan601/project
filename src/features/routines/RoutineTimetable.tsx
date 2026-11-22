import { Fragment, type CSSProperties } from 'react'
import { Pencil, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { formatDisplayDate } from '@/lib/dateTime'
import type { RoutineClass, RoutineEntry, RoutinePeriod, RoutineSettings } from '@/services/classRoutines'

export const routineDays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const daysBn = ['রবিবার', 'সোমবার', 'মঙ্গলবার', 'বুধবার', 'বৃহস্পতিবার', 'শুক্রবার', 'শনিবার']
const groups: Record<string, [string, string]> = { business: ['Business Studies', 'ব্যবসায় শিক্ষা'], science: ['Science', 'বিজ্ঞান'], humanities: ['Humanities', 'মানবিক'] }

export function routineTime(time: string) {
  const [hour, minute] = time.split(':').map(Number)
  return `${hour % 12 || 12}:${String(minute).padStart(2, '0')}`
}
export function routinePeriods(settings: RoutineSettings | undefined, entries: RoutineEntry[]): RoutinePeriod[] {
  if (settings?.periods.length) return settings.periods
  return [...new Map(entries.map(row => [`${row.start_time}-${row.end_time}`, row])).values()]
    .sort((a, b) => a.start_time.localeCompare(b.start_time))
    .map((row, index) => ({ number: index + 1, start_time: row.start_time, end_time: row.end_time, kind: 'lesson' }))
}
const minuteKey = (time: string) => time.slice(0, 5)
export function routineCell(entry: RoutineEntry, periods: RoutinePeriod[]) {
  const start = periods.findIndex(period => period.kind !== 'break' && minuteKey(period.start_time) === minuteKey(entry.start_time))
  const end = periods.findIndex(period => period.kind !== 'break' && minuteKey(period.end_time) === minuteKey(entry.end_time))
  return start >= 0 && end >= start && !periods.slice(start, end + 1).some(period => period.kind === 'break') ? { start, span: end - start + 1 } : null
}

export function RoutineTimetable({ classes, entries, settings, admin, onEdit, onRemove }: {
  classes: RoutineClass[]; entries: RoutineEntry[]; settings: RoutineSettings[]; admin: boolean
  onEdit: (entry: RoutineEntry) => void; onRemove: (entry: RoutineEntry) => void
}) {
  const config = settings.find(row => row.class_id === classes[0]?.id) ?? settings[0]
  const periods = routinePeriods(config, entries)
  const days = [0, 1, 2, 3, 4, 5, 6].filter(day => entries.some(row => row.day_of_week === day))
  const gridEntries = entries.filter(row => routineCell(row, periods))
  const additional = entries.filter(row => !routineCell(row, periods))
  const title = classes.length === 1 ? classes[0].name.trim() : classes[0]?.grade ? `Class ${classes[0].grade}` : classes[0]?.name
  const mobileWidth = 56 + (classes.length > 1 ? 80 : 0) + periods.reduce((width, period) => width + (period.kind === 'break' ? 28 : 76), 0)
  return <section className="min-w-0" aria-label="Weekly class timetable">
    <div className="mb-2 text-center sm:mb-4"><h2 className="text-xs font-semibold sm:text-lg">New Model Degree College</h2>
      <p className="mt-0.5 text-[10px] font-medium sm:mt-1 sm:text-sm">{title} · Weekly class routine{classes[0]?.session ? ` · ${classes[0].session}` : ''}</p>
      <p className="mt-0.5 text-[9px] text-muted-foreground sm:mt-1 sm:text-xs">All times are Bangladesh time (AM to PM).</p>
      {(config?.assembly_time || config?.effective_from) && <p className="mt-0.5 text-[9px] text-muted-foreground sm:mt-1 sm:text-xs">{[
        config.assembly_time && `Assembly ${routineTime(config.assembly_time)} ${Number(config.assembly_time.slice(0, 2)) < 12 ? 'AM' : 'PM'}`,
        config.effective_from && `Effective ${formatDisplayDate(config.effective_from)}`,
      ].filter(Boolean).join(' · ')}</p>}
    </div>
    <div className="overflow-x-auto border">
      <table style={{ '--routine-min-width': `${mobileWidth}px` } as CSSProperties} className="routine-timetable w-full min-w-[var(--routine-min-width)] table-fixed border-collapse text-center text-[9px] sm:min-w-[950px] sm:text-xs">
        <caption className="sr-only">{title} weekly routine with subjects in Bangla and English</caption>
        <thead><tr><th scope="col" className="sticky left-0 z-10 w-14 border-r px-1 py-1.5 sm:w-24 sm:p-2">Day<br /><span lang="bn" className="font-normal">বার</span></th>
          {classes.length > 1 && <th scope="col" className="w-20 border-r px-1 py-1.5 sm:w-28 sm:p-2">Group<br /><span lang="bn" className="font-normal">শাখা</span></th>}
          {periods.map((period, index) => <th key={index} scope="col" className={`border-r px-0.5 py-1.5 last:border-r-0 sm:px-1 sm:py-2 ${period.kind === 'break' ? 'w-7 sm:w-12' : ''}`}>
            {period.kind === 'break' ? 'Break' : `Period ${period.number}`}<span className={`mt-0.5 text-[8px] font-normal tabular-nums sm:mt-1 sm:text-[10px] ${period.kind === 'break' ? 'hidden sm:block' : 'block'}`}>{period.kind === 'break' ? <>{routineTime(period.start_time)}<br />{routineTime(period.end_time)}</> : `${routineTime(period.start_time)}–${routineTime(period.end_time)}`}</span>
          </th>)}
        </tr></thead>
        <tbody>{days.map((day, dayIndex) => <Fragment key={day}>{classes.map((cls, groupIndex) => {
          const rows = gridEntries.filter(row => row.day_of_week === day && row.class_id === cls.id)
          const room = settings.find(row => row.class_id === cls.id)?.room
          return <tr key={cls.id} className={groupIndex === 0 ? 'border-t-2' : 'border-t'}>
            {groupIndex === 0 && <th scope="rowgroup" rowSpan={classes.length} className="sticky left-0 z-10 border-r bg-card px-1 py-1.5 align-middle font-semibold sm:px-2 sm:py-3"><span>{routineDays[day]}</span><span lang="bn" className="mt-0.5 block font-normal text-muted-foreground sm:mt-1">{daysBn[day]}</span></th>}
            {classes.length > 1 && <th scope="row" className="border-r bg-card px-2 py-3 font-medium"><span>{groups[cls.class_group ?? '']?.[0] ?? cls.name}</span><span lang="bn" className="mt-1 block text-[11px] font-normal text-muted-foreground">{groups[cls.class_group ?? '']?.[1]}</span>{room && <span className="mt-1 block text-[10px] font-normal text-muted-foreground">Room {room}</span>}</th>}
            {periods.map((period, index) => {
              if (period.kind === 'break') return dayIndex === 0 && groupIndex === 0 ? <td key={index} rowSpan={days.length * classes.length} className="border-x bg-muted/60 p-0.5 align-middle sm:p-2"><span lang="bn" className="inline-block whitespace-nowrap font-medium [writing-mode:vertical-rl]">টিফিন / Break · {routineTime(period.start_time)}–{routineTime(period.end_time)}</span></td> : null
              const covering = rows.filter(row => { const cell = routineCell(row, periods)!; return index >= cell.start && index < cell.start + cell.span })
              if (covering.some(row => routineCell(row, periods)!.start < index)) return null
              const span = covering.length ? Math.max(...covering.map(row => routineCell(row, periods)!.span)) : 1
              return <td key={index} colSpan={span} className={`border-r px-1 py-1.5 align-middle last:border-r-0 sm:px-2 sm:py-3 ${covering.some(row => row.entry_kind === 'support') ? 'bg-amber-500/5' : covering.some(row => row.entry_kind === 'lab') ? 'bg-sky-500/5' : covering.some(row => row.entry_kind === 'activity') ? 'bg-violet-500/5' : ''}`}>
                {covering.length ? covering.map(row => <TimetableSubject key={row.id} entry={row} admin={admin} onEdit={onEdit} onRemove={onRemove} />) : <span className="text-muted-foreground/50" aria-label="No scheduled class">—</span>}
              </td>
            })}
          </tr>
        })}</Fragment>)}</tbody>
      </table>
    </div>
    <p className="mt-2 text-xs text-muted-foreground sm:hidden">Swipe sideways to see every period.</p>
    {classes.length === 1 && config?.room && <p className="mt-2 text-xs text-muted-foreground">Room {config.room}</p>}
    {additional.length > 0 && <div className="mt-4 space-y-2"><h3 className="text-sm font-semibold">Additional periods</h3>{additional.map(row => <div key={row.id} className="border-b py-2"><p className="mb-1 text-xs text-muted-foreground">{routineDays[row.day_of_week]} · {routineTime(row.start_time)}–{routineTime(row.end_time)}</p><TimetableSubject entry={row} admin={admin} onEdit={onEdit} onRemove={onRemove} /></div>)}</div>}
  </section>
}

function TimetableSubject({ entry, admin, onEdit, onRemove }: { entry: RoutineEntry; admin: boolean; onEdit: (entry: RoutineEntry) => void; onRemove: (entry: RoutineEntry) => void }) {
  return <div className="group relative space-y-0.5 sm:space-y-1">
    {entry.subject_name_bn && <p lang="bn" className="text-[11px] font-medium leading-tight sm:text-sm sm:leading-snug">{entry.subject_name_bn}</p>}
    <p className={entry.subject_name_bn ? 'text-[8px] leading-tight text-muted-foreground sm:text-[10px] sm:leading-snug' : 'text-[11px] font-medium sm:text-sm'}>{entry.subject_name}</p>
    {(entry.teacher_name || entry.room) && <p className="text-[10px] text-muted-foreground">{[entry.teacher_name, entry.room && `Room ${entry.room}`].filter(Boolean).join(' · ')}</p>}
    {admin && <div className="mt-1 flex justify-center gap-1 sm:absolute sm:-right-1 sm:-top-3 sm:z-10 sm:mt-0 sm:bg-background sm:opacity-0 sm:focus-within:opacity-100 sm:group-hover:opacity-100"><Button size="icon-xs" variant="ghost" aria-label={`Edit ${entry.subject_name} on ${routineDays[entry.day_of_week]}`} onClick={() => onEdit(entry)}><Pencil className="size-3" /></Button><Button size="icon-xs" variant="ghost" className="text-destructive" aria-label={`Delete ${entry.subject_name} on ${routineDays[entry.day_of_week]}`} onClick={() => onRemove(entry)}><Trash2 className="size-3" /></Button></div>}
  </div>
}
