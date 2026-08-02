import { Link } from 'react-router-dom'
import { Page } from '@/components/Page'

export default function NotFound() {
  return (
    <Page>
      <span className="eyebrow block">Off the Fairway</span>
      <h1 className="mt-3 font-display text-4xl font-semibold tracking-tight text-paper">
        Page not found
      </h1>
      <p className="mt-5 text-paper-dim">That hole isn't on this card.</p>
      <Link
        to="/"
        className="tap mt-6 inline-flex items-center font-semibold text-gold"
      >
        Back to the countdown →
      </Link>
    </Page>
  )
}
