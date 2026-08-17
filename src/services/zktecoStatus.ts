export type ZktecoDeviceState = 'online' | 'offline' | 'unknown'

export interface ZktecoDeviceStatus {
  serialNumber: string
  status: ZktecoDeviceState
  lastSeen: string | null
  lastSeenAgeSeconds: number | null
  offlineAfterSeconds: number | null
}

const STATUS_ENDPOINT =
  'https://zkteco.humayidstore.workers.dev/status?SN=UDP3251601340&client_version=2'

interface WorkerStatusResponse {
  serial_number?: unknown
  status?: unknown
  last_seen?: unknown
  last_seen_age_seconds?: unknown
  offline_after_seconds?: unknown
}

export async function fetchZktecoDeviceStatus(): Promise<ZktecoDeviceStatus> {
  const response = await fetch(STATUS_ENDPOINT, {
    method: 'GET',
    headers: { Accept: 'application/json' },
    cache: 'no-store',
  })

  if (!response.ok) {
    throw new Error(`Device status request failed (${response.status})`)
  }

  const payload = await response.json() as WorkerStatusResponse
  const status = payload.status === 'online' || payload.status === 'offline'
    ? payload.status
    : 'unknown'

  return {
    serialNumber: typeof payload.serial_number === 'string'
      ? payload.serial_number
      : 'UDP3251601340',
    status,
    lastSeen: typeof payload.last_seen === 'string' ? payload.last_seen : null,
    lastSeenAgeSeconds: finiteNumber(payload.last_seen_age_seconds),
    offlineAfterSeconds: finiteNumber(payload.offline_after_seconds),
  }
}

function finiteNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}
