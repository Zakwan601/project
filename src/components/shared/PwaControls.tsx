import { useEffect, useRef, useState } from 'react'
import { Download, RefreshCw, Share2, Smartphone, WifiOff } from 'lucide-react'
import { registerSW } from 'virtual:pwa-register'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
}

function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches
    || ('standalone' in navigator && (navigator as Navigator & { standalone?: boolean }).standalone === true)
}

function isIosDevice() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
}

export function PwaControls() {
  const updateServiceWorkerRef = useRef<((reloadPage?: boolean) => Promise<void>) | null>(null)
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null)
  const [needsRefresh, setNeedsRefresh] = useState(false)
  const [isUpdating, setIsUpdating] = useState(false)
  const [updateError, setUpdateError] = useState('')
  const [offline, setOffline] = useState(!navigator.onLine)
  const [showIosHelp, setShowIosHelp] = useState(false)
  const [installed, setInstalled] = useState(isStandalone)
  const ios = isIosDevice()

  useEffect(() => {
    updateServiceWorkerRef.current = registerSW({
      immediate: true,
      onNeedRefresh: () => setNeedsRefresh(true),
      onOfflineReady: () => toast.success('The app is ready to open offline.'),
      onRegisterError: error => console.error('Service worker registration failed:', error),
    })

    const handleInstallPrompt = (event: Event) => {
      event.preventDefault()
      setInstallPrompt(event as BeforeInstallPromptEvent)
    }
    const handleInstalled = () => {
      setInstalled(true)
      setInstallPrompt(null)
      toast.success('Axentra was installed successfully.')
    }
    const handleOnline = () => setOffline(false)
    const handleOffline = () => setOffline(true)

    window.addEventListener('beforeinstallprompt', handleInstallPrompt)
    window.addEventListener('appinstalled', handleInstalled)
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)

    return () => {
      window.removeEventListener('beforeinstallprompt', handleInstallPrompt)
      window.removeEventListener('appinstalled', handleInstalled)
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [])

  const install = async () => {
    if (!installPrompt) {
      if (ios) setShowIosHelp(true)
      return
    }

    await installPrompt.prompt()
    const { outcome } = await installPrompt.userChoice
    if (outcome === 'accepted') setInstallPrompt(null)
  }

  const applyUpdate = async () => {
    const updateServiceWorker = updateServiceWorkerRef.current
    if (!updateServiceWorker) {
      setUpdateError('The update service is not ready. Please check your connection and try again.')
      return
    }

    setIsUpdating(true)
    setUpdateError('')
    try {
      await updateServiceWorker(true)
    } catch (error) {
      console.error('App update failed:', error)
      setUpdateError('The update could not be installed. Check your connection and try again.')
      setIsUpdating(false)
    }
  }

  return (
    <>
      {offline && (
        <span
          className="inline-flex h-8 items-center gap-1.5 rounded-md border px-2 text-xs text-muted-foreground"
          title="You are offline. Previously loaded screens remain available, but live data needs a connection."
        >
          <WifiOff className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Offline</span>
        </span>
      )}

      <Dialog open={needsRefresh}>
        <DialogContent
          className="max-w-md"
          showCloseButton={false}
          onEscapeKeyDown={event => event.preventDefault()}
          onPointerDownOutside={event => event.preventDefault()}
          onInteractOutside={event => event.preventDefault()}
        >
          <DialogHeader className="items-center text-center sm:text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
              <RefreshCw className={isUpdating ? 'h-6 w-6 animate-spin' : 'h-6 w-6'} />
            </span>
            <DialogTitle>App update required</DialogTitle>
            <DialogDescription>
              A new version of Axentra is ready. You must update and restart before continuing.
            </DialogDescription>
          </DialogHeader>

          {updateError && (
            <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert">
              {updateError}
            </p>
          )}

          <DialogFooter>
            <Button className="w-full" size="lg" onClick={applyUpdate} disabled={isUpdating}>
              <RefreshCw className={isUpdating ? 'animate-spin' : undefined} />
              {isUpdating ? 'Updating...' : 'Update and restart'}
            </Button>
          </DialogFooter>
          <p className="text-center text-xs text-muted-foreground">The app will reopen automatically with the latest version.</p>
        </DialogContent>
      </Dialog>

      {!installed && (installPrompt || ios) && (
        <Button size="sm" variant="outline" onClick={install} title="Install Axentra on this device">
          <Download className="h-4 w-4" />
          <span className="hidden sm:inline">Install</span>
        </Button>
      )}

      <Dialog open={showIosHelp} onOpenChange={setShowIosHelp}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Smartphone className="h-5 w-5" /> Install Axentra
            </DialogTitle>
            <DialogDescription>
              Add the app to your iPhone or iPad Home Screen for a full-screen experience.
            </DialogDescription>
          </DialogHeader>
          <ol className="space-y-3 text-sm">
            <li className="flex gap-3">
              <Share2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              <span>Open this page in Safari and tap the <strong>Share</strong> button.</span>
            </li>
            <li className="flex gap-3">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary text-xs text-primary-foreground">2</span>
              <span>Select <strong>Add to Home Screen</strong>.</span>
            </li>
            <li className="flex gap-3">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary text-xs text-primary-foreground">3</span>
              <span>Tap <strong>Add</strong> to finish.</span>
            </li>
          </ol>
        </DialogContent>
      </Dialog>
    </>
  )
}
