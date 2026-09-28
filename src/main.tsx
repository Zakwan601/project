import { StrictMode } from "react"
import { createRoot } from "react-dom/client"

import "./index.css"
import App from "./App.tsx"

window.addEventListener("vite:preloadError", event => {
  event.preventDefault()
  if (!navigator.onLine) return

  const recoveryKey = "axentra:preload-recovery"
  const previousRecovery = Number(sessionStorage.getItem(recoveryKey) ?? 0)
  if (Date.now() - previousRecovery < 30_000) return

  sessionStorage.setItem(recoveryKey, String(Date.now()))
  window.location.reload()
})

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
