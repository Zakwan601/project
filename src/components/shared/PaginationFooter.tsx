import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'

export function PaginationFooter({
  page,
  pageSize,
  total,
  isFetching = false,
  onPageChange,
  onPageSizeChange,
}: {
  page: number
  pageSize: number
  total: number
  isFetching?: boolean
  onPageChange: (page: number) => void
  onPageSizeChange: (pageSize: number) => void
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const first = total === 0 ? 0 : (page - 1) * pageSize + 1
  const last = Math.min(page * pageSize, total)

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t px-4 py-3">
      <p className="text-xs text-muted-foreground">Showing {first}-{last} of {total}</p>
      <div className="flex items-center gap-3">
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          Rows
          <select
            value={pageSize}
            onChange={event => onPageSizeChange(Number(event.target.value))}
            className="h-8 rounded-md border bg-background px-2 text-xs text-foreground outline-none focus:border-ring"
          >
            <option value={5}>5</option>
            <option value={10}>10</option>
            <option value={25}>25</option>
          </select>
        </label>
        <span className="text-xs text-muted-foreground">Page {page} of {totalPages}</span>
        <div className="flex gap-1">
          <Button
            variant="outline"
            size="icon-sm"
            onClick={() => onPageChange(page - 1)}
            disabled={page <= 1 || isFetching}
            aria-label="Previous page"
          >
            <ChevronLeft />
          </Button>
          <Button
            variant="outline"
            size="icon-sm"
            onClick={() => onPageChange(page + 1)}
            disabled={page >= totalPages || isFetching}
            aria-label="Next page"
          >
            <ChevronRight />
          </Button>
        </div>
      </div>
    </div>
  )
}
