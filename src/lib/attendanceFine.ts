export interface AttendanceFineDetails {
  recordedAbsences: number
  lateDays: number
  latePenaltyAbsences: number
  fineableAbsences: number
  finePerAbsentDay: number
  totalFine: number
}

export function calculateAttendanceFine(
  recordedAbsences: number,
  lateDays: number,
  finePerAbsentDay: number,
): AttendanceFineDetails {
  const latePenaltyAbsences = Math.floor(lateDays / 2)
  const fineableAbsences = recordedAbsences + latePenaltyAbsences

  return {
    recordedAbsences,
    lateDays,
    latePenaltyAbsences,
    fineableAbsences,
    finePerAbsentDay,
    totalFine: fineableAbsences * finePerAbsentDay,
  }
}

export function formatFine(value: number) {
  return '৳' + value.toLocaleString('en-BD', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}
