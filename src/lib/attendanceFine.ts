export interface AttendanceFineDetails {
  recordedAbsences: number
  lateDays: number
  latePenaltyAbsences: number
  fineableAbsences: number
  finePerAbsentDay: number
  attendanceFine: number
  examMissedCount: number
  examMissedFineAmount: number
  examMissedFine: number
  totalFine: number
}

export function calculateAttendanceFine(
  recordedAbsences: number,
  lateDays: number,
  finePerAbsentDay: number,
  examMissedCount = 0,
  examMissedFineAmount = 0,
): AttendanceFineDetails {
  const latePenaltyAbsences = Math.floor(lateDays / 2)
  const fineableAbsences = recordedAbsences + latePenaltyAbsences
  const attendanceFine = fineableAbsences * finePerAbsentDay
  const examMissedFine = examMissedCount * examMissedFineAmount

  return {
    recordedAbsences,
    lateDays,
    latePenaltyAbsences,
    fineableAbsences,
    finePerAbsentDay,
    attendanceFine,
    examMissedCount,
    examMissedFineAmount,
    examMissedFine,
    totalFine: attendanceFine + examMissedFine,
  }
}

export function formatFine(value: number) {
  return '৳' + value.toLocaleString('en-BD', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}
