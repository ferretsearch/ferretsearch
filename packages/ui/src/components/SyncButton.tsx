import { useState } from 'react'
import { triggerSync } from '../api/client.ts'

export function SyncButton() {
  const [isSyncing, setIsSyncing] = useState(false)
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null)

  const showToast = (message: string, type: 'success' | 'error') => {
    setToast({ message, type })
    setTimeout(() => setToast(null), 3500)
  }

  const handleSync = async () => {
    if (isSyncing) return
    setIsSyncing(true)
    try {
      const result = await triggerSync()
      showToast(`Enqueued ${result.queued} documents across ${result.connectors.length} connectors`, 'success')
    } catch {
      showToast('Sync failed — check API connection', 'error')
    } finally {
      setIsSyncing(false)
    }
  }

  return (
    <div className="relative">
      <button
        onClick={() => void handleSync()}
        disabled={isSyncing}
        className="px-3 py-1.5 text-sm bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed rounded-md text-white font-medium transition-colors"
      >
        {isSyncing ? (
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-3 border border-white/40 border-t-white rounded-full animate-spin" />
            Syncing…
          </span>
        ) : (
          'Sync Now'
        )}
      </button>

      {toast && (
        <div
          className={`absolute top-10 right-0 rounded-md px-3 py-2 text-sm text-white whitespace-nowrap shadow-xl z-50 border ${
            toast.type === 'success'
              ? 'bg-gray-800 border-green-700'
              : 'bg-gray-800 border-red-700'
          }`}
        >
          {toast.message}
        </div>
      )}
    </div>
  )
}
