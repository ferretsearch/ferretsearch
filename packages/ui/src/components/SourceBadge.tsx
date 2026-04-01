export type SourceType = 'slack' | 'teams' | 'github' | 'drive' | 'filesystem'

const SOURCE_CONFIG: Record<SourceType, { label: string; bg: string; text: string }> = {
  slack: { label: 'Slack', bg: '#4A154B', text: '#ffffff' },
  teams: { label: 'Teams', bg: '#6264A7', text: '#ffffff' },
  github: { label: 'GitHub', bg: '#24292e', text: '#ffffff' },
  drive: { label: 'Drive', bg: '#1967D2', text: '#ffffff' },
  filesystem: { label: 'Files', bg: '#92400e', text: '#fcd34d' },
}

interface SourceBadgeProps {
  sourceType: SourceType
}

export function SourceBadge({ sourceType }: SourceBadgeProps) {
  const config = SOURCE_CONFIG[sourceType]

  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold"
      style={{ backgroundColor: config.bg, color: config.text }}
    >
      {config.label}
    </span>
  )
}
