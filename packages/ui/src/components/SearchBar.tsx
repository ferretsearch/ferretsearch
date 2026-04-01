import { useState, useEffect } from 'react'

const SOURCE_OPTIONS = [
  { value: '', label: 'All Sources' },
  { value: 'slack', label: 'Slack' },
  { value: 'github', label: 'GitHub' },
  { value: 'drive', label: 'Drive' },
  { value: 'filesystem', label: 'Files' },
]

interface SearchBarProps {
  onSearch: (query: string) => void
  onFilterChange: (sourceType: string | undefined) => void
  isLoading: boolean
}

export function SearchBar({ onSearch, onFilterChange, isLoading }: SearchBarProps) {
  const [inputValue, setInputValue] = useState('')
  const [sourceFilter, setSourceFilter] = useState('')

  // Debounce: fire onSearch 300ms after the user stops typing
  useEffect(() => {
    const timer = setTimeout(() => {
      onSearch(inputValue)
    }, 300)
    return () => clearTimeout(timer)
  }, [inputValue, onSearch])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    onSearch(inputValue)
  }

  const handleSourceChange = (value: string) => {
    setSourceFilter(value)
    onFilterChange(value === '' ? undefined : value)
  }

  return (
    <form onSubmit={handleSubmit} className="w-full max-w-3xl mx-auto">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <div className="absolute inset-y-0 left-4 flex items-center pointer-events-none">
            {isLoading ? (
              <span className="w-5 h-5 border-2 border-gray-500 border-t-indigo-400 rounded-full animate-spin" />
            ) : (
              <svg
                className="w-5 h-5 text-gray-500"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                />
              </svg>
            )}
          </div>
          <input
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            placeholder="Search across Slack, GitHub, Drive…"
            className="w-full pl-12 pr-4 py-4 bg-[#1a1a1f] border border-gray-700 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 text-base transition-colors"
            autoFocus
          />
        </div>

        <select
          value={sourceFilter}
          onChange={(e) => handleSourceChange(e.target.value)}
          className="px-3 py-4 bg-[#1a1a1f] border border-gray-700 rounded-xl text-gray-300 focus:outline-none focus:border-indigo-500 text-sm transition-colors cursor-pointer"
        >
          {SOURCE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>

        <button
          type="submit"
          className="px-5 py-4 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl font-medium text-sm transition-colors"
        >
          Search
        </button>
      </div>
    </form>
  )
}
