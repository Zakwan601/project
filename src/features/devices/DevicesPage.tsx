import { PageHeader } from '@/components/shared/PageHeader'
import { ZktecoDeviceStatusCard } from '@/components/shared/ZktecoDeviceStatus'

export function DevicesPage() {
  return (
    <div>
      <PageHeader
        title="ZKTeco Device"
        description="Live connection status reported by the Cloudflare Worker"
      />
      <div className="max-w-2xl">
        <ZktecoDeviceStatusCard />
      </div>
    </div>
  )
}
