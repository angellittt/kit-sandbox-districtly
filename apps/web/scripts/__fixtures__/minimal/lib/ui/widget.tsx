import * as React from "react"

export function Widget({ children }: React.ComponentProps<"div">) {
  return (
    <div data-slot="widget" className="rounded-lg bg-brand p-4 text-surface">
      {children}
    </div>
  )
}
