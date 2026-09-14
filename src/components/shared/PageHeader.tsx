import { Loader2 } from 'lucide-react'

interface PageHeaderProps {
  title: string
  description?: string
  action?: React.ReactNode
}

export function PageHeader({ title, description, action }: PageHeaderProps) {
  return (
    <div className="mb-3 flex items-start justify-between gap-3 sm:mb-4">
      <div className="min-w-0">
        <h2 className="text-2xl font-bold tracking-tight">{title}</h2>
        {description && (
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        )}
      </div>

      {action && (
        <div className="shrink-0">
          {action}
        </div>
      )}
    </div>
  )
}

export function LoadingState({ message = 'Loading...' }: { message?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-10 text-muted-foreground sm:gap-3 sm:py-20">
      <Loader2 className="h-8 w-8 animate-spin" />
      <p className="text-sm">{message}</p>
    </div>
  )
}

export function ErrorState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-10 text-destructive sm:py-20">
      <p className="font-medium">Something went wrong</p>
      <p className="text-sm text-muted-foreground">{message}</p>
    </div>
  )
}

export function EmptyState({ title, description }: { title: string; description?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-10 text-muted-foreground sm:py-20">
      <p className="font-medium text-foreground">{title}</p>
      {description && <p className="text-sm">{description}</p>}
    </div>
  )
}
