import React from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'

export function NotFoundPage() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background px-4 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary mb-6">
        <Sparkles className="h-6 w-6" />
      </div>
      <span className="font-mono text-sm font-semibold text-primary uppercase tracking-widest">
        404 Not Found
      </span>
      <h1 className="text-3xl sm:text-4xl font-extrabold text-foreground mt-2 mb-3">
        Page does not exist
      </h1>
      <p className="text-sm text-muted-foreground max-w-md mb-8">
        The route you are looking for has been moved or does not exist in the HireLoom platform.
      </p>
      <div className="flex items-center gap-3">
        <Button asChild variant="outline">
          <Link to="/dashboard" className="gap-2">
            <ArrowLeft className="h-4 w-4" />
            Return to Dashboard
          </Link>
        </Button>
        <Button asChild>
          <Link to="/resume">Analyze Resume</Link>
        </Button>
      </div>
    </div>
  )
}
