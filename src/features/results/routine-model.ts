export interface ExamRoutineSlot {
  id: string
  subject_name: string
  exam_date: string
  exam_time: string | null
}

export function groupExamRoutineSlots(rows: ExamRoutineSlot[]): ExamRoutineSlot[] {
  const slots = new Map<string, { row: ExamRoutineSlot; names: Set<string> }>()
  for (const row of rows) {
    const key = JSON.stringify([row.exam_date, row.exam_time])
    let slot = slots.get(key)
    if (!slot) {
      slot = { row, names: new Set() }
      slots.set(key, slot)
    }
    if (row.subject_name.trim()) slot.names.add(row.subject_name.trim())
  }
  return [...slots.values()].map(({ row, names }) => ({
    ...row, subject_name: [...names].sort((a, b) => a.localeCompare(b)).join(' / '),
  }))
}
