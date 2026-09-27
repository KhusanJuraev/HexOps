import { Link } from 'react-router'

/** Tags as links to the notes list filtered by that tag. */
export function TagList({ tags }: { tags: string[] }) {
  if (!tags.length) return null
  return (
    <ul className="flex flex-wrap gap-1.5">
      {tags.map((tag) => (
        <li key={tag}>
          <Link
            to={`/notes?tag=${encodeURIComponent(tag)}`}
            className="bg-muted hover:bg-accent focus-visible:ring-ring/50 inline-block max-w-full rounded-full px-2.5 py-0.5 text-xs font-medium break-all outline-none focus-visible:ring-[3px]"
          >
            #{tag}
          </Link>
        </li>
      ))}
    </ul>
  )
}
