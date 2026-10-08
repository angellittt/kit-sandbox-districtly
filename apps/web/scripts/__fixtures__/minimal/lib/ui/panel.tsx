import * as React from "react"

export function Panel({ children }: React.ComponentProps<"section">) {
  return (
    <section data-slot="panel" className="flex flex-col gap-2 bg-surface">
      {children}
    </section>
  )
}
