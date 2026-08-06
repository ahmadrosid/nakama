'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect } from 'react'

export default function GettingStartedRedirect() {
  const router = useRouter()

  useEffect(() => {
    router.replace('/quickstart')
  }, [router])

  return (
    <main className="mx-auto max-w-2xl px-6 py-20 text-center">
      <h1 className="mb-4 text-2xl font-semibold">Getting Started</h1>
      <p className="text-fd-muted-foreground">
        This page moved to{' '}
        <Link href="/quickstart" className="text-fd-primary hover:underline">
          Quickstart
        </Link>
        .
      </p>
    </main>
  )
}
