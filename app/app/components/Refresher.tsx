"use client"
import { useEffect } from "react"
import { useRouter } from "next/navigation"

export function Refresher({ ms = 5000 }: { ms?: number }) {
  const router = useRouter()
  useEffect(() => {
    const t = setInterval(() => router.refresh(), ms)
    return () => clearInterval(t)
  }, [router, ms])
  return null
}
