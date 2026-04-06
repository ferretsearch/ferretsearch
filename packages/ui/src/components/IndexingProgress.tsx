import { useEffect, useRef, useState } from 'react'

interface ProgressData {
  waiting: number
  active: number
  completed: number
  failed: number
}

export function IndexingProgress() {
  const [progress, setProgress] = useState<ProgressData | null>(null)
  const esRef = useRef<EventSource | null>(null)

  useEffect(() => {
    const es = new EventSource('/jobs/progress')
    esRef.current = es

    es.onmessage = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data as string) as ProgressData
        setProgress(data)
      } catch {
        // ignore malformed frames
      }
    }

    return () => {
      es.close()
      esRef.current = null
    }
  }, [])

  if (!progress || (progress.active === 0 && progress.waiting === 0)) {
    return null
  }

  return (
    <div className="flex items-center gap-2 text-sm text-gray-300">
      {progress.active > 0 ? (
        <>
          <span className="inline-block h-3 w-3 animate-spin rounded-full border border-blue-400 border-t-transparent" />
          <span>
            Indexing {progress.active} document{progress.active !== 1 ? 's' : ''}...
          </span>
        </>
      ) : (
        <span>
          {progress.waiting} document{progress.waiting !== 1 ? 's' : ''} in queue
        </span>
      )}
    </div>
  )
}
