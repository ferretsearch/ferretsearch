import { useHealth } from '../hooks/useHealth.ts'

const SERVICES = [
  { key: 'redis' as const, label: 'Redis' },
  { key: 'qdrant' as const, label: 'Qdrant' },
  { key: 'ollama' as const, label: 'Ollama' },
]

export function ServiceStatus() {
  const { services, isLoading } = useHealth()

  if (isLoading) {
    return (
      <div className="flex items-center gap-2">
        {SERVICES.map(({ key }) => (
          <div key={key} className="flex items-center gap-1.5 animate-pulse">
            <span className="w-2 h-2 rounded-full bg-gray-600" />
            <span className="text-xs text-gray-600 w-10 h-3 bg-gray-700 rounded" />
          </div>
        ))}
      </div>
    )
  }

  if (!services) {
    return (
      <div className="flex items-center gap-1.5">
        <span className="w-2 h-2 rounded-full bg-yellow-500" />
        <span className="text-xs text-gray-400">Services unknown</span>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-3">
      {SERVICES.map(({ key, label }) => {
        const ok = services[key]
        return (
          <div key={key} className="flex items-center gap-1.5" title={ok ? `${label}: OK` : `${label}: Degraded`}>
            <span className={`w-2 h-2 rounded-full ${ok ? 'bg-green-400' : 'bg-red-500'}`} />
            <span className="text-xs text-gray-400 hidden sm:inline">{label}</span>
          </div>
        )
      })}
    </div>
  )
}
