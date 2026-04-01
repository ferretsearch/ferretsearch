import { SourceBadge } from './SourceBadge.tsx'
import type { SearchResult } from '../api/client.ts'

interface SearchResultsProps {
  results: SearchResult[]
  total: number
  took: number | undefined
  isLoading: boolean
  error: Error | null
  hasSearched: boolean
}

function ResultCard({ result }: { result: SearchResult }) {
  const scorePercent = Math.round(result.score * 100)

  return (
    <div className="bg-[#1a1a1f] border border-gray-800 rounded-xl p-5 hover:border-gray-600 transition-colors">
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="flex items-center gap-2 flex-wrap min-w-0">
          <SourceBadge sourceType={result.sourceType} />
          {result.url ? (
            <a
              href={result.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-white font-semibold hover:text-indigo-400 transition-colors truncate"
            >
              {result.title}
            </a>
          ) : (
            <span className="text-white font-semibold truncate">{result.title}</span>
          )}
        </div>
        <span className="text-xs text-gray-500 shrink-0">{scorePercent}%</span>
      </div>

      <p className="text-gray-400 text-sm leading-relaxed line-clamp-3 mb-3">
        {result.snippet.length > 300 ? result.snippet.slice(0, 300) + '…' : result.snippet}
      </p>

      {result.highlights.length > 0 && (
        <div className="mb-3 space-y-1">
          {result.highlights.slice(0, 2).map((highlight, i) => (
            <p key={i} className="text-xs text-gray-500 italic">
              …{highlight}…
            </p>
          ))}
        </div>
      )}

      <div className="flex items-center gap-2">
        <div className="flex-1 h-1 bg-gray-800 rounded-full overflow-hidden">
          <div
            className="h-1 bg-indigo-500 rounded-full transition-all"
            style={{ width: `${scorePercent}%` }}
          />
        </div>
        <span className="text-xs text-gray-600 shrink-0">relevance</span>
      </div>
    </div>
  )
}

export function SearchResults({
  results,
  total,
  took,
  isLoading,
  error,
  hasSearched,
}: SearchResultsProps) {
  if (error) {
    return (
      <div className="w-full max-w-3xl mx-auto mt-8">
        <div className="bg-red-950/40 border border-red-800 rounded-xl p-5 text-center">
          <p className="text-red-400 font-medium">Search failed</p>
          <p className="text-red-500/70 text-sm mt-1">{error.message}</p>
        </div>
      </div>
    )
  }

  if (isLoading) {
    return (
      <div className="w-full max-w-3xl mx-auto mt-8 space-y-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="bg-[#1a1a1f] border border-gray-800 rounded-xl p-5 animate-pulse">
            <div className="flex items-center gap-2 mb-3">
              <div className="h-5 w-14 bg-gray-700 rounded" />
              <div className="h-5 w-48 bg-gray-700 rounded" />
            </div>
            <div className="space-y-2">
              <div className="h-3 bg-gray-800 rounded w-full" />
              <div className="h-3 bg-gray-800 rounded w-3/4" />
            </div>
          </div>
        ))}
      </div>
    )
  }

  if (!hasSearched) {
    return (
      <div className="w-full max-w-3xl mx-auto mt-16 text-center">
        <p className="text-gray-600 text-sm">Type at least 2 characters to search</p>
      </div>
    )
  }

  if (results.length === 0) {
    return (
      <div className="w-full max-w-3xl mx-auto mt-16 text-center">
        <p className="text-gray-400 text-base">No results found</p>
        <p className="text-gray-600 text-sm mt-1">Try a different query or broaden your filters</p>
      </div>
    )
  }

  return (
    <div className="w-full max-w-3xl mx-auto mt-6">
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-gray-500">
          {total} result{total !== 1 ? 's' : ''}
        </p>
        {took !== undefined && (
          <p className="text-xs text-gray-600">{took}ms</p>
        )}
      </div>
      <div className="space-y-3">
        {results.map((result) => (
          <ResultCard key={result.chunkId} result={result} />
        ))}
      </div>
      <p className="text-center text-xs text-gray-700 mt-6">
        {total} result{total !== 1 ? 's' : ''} · {took !== undefined ? `${took}ms` : ''}
      </p>
    </div>
  )
}
