import "./globals.css"
import type { ReactNode } from "react"

export const metadata = {
  title: "Goblins Auto-Grader",
  description: "Create an assignment, students show their work, get it graded instantly.",
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
