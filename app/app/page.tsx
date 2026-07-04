import Link from "next/link"

export default function Home() {
  return (
    <div className="wrap">
      <div className="hero">
        <h1>🧙 Goblins Auto-Grader</h1>
        <p>Make an assignment, share a code, and let students show their work on a whiteboard — graded the moment they submit.</p>
      </div>
      <div className="card">
        <div className="row">
          <Link className="btn" href="/teacher/new">I&apos;m a teacher — create an assignment</Link>
          <Link className="btn secondary" href="/join">I&apos;m a student — join with a code</Link>
        </div>
      </div>
      <p className="muted center">No sign-up. Your work saves automatically and follows you across devices.</p>
    </div>
  )
}
