// design-system-kit 0.8.0 · profile shadcn · stock component (base-nova + baseline only)
/**
 * Stock base-nova (shadcn 4.21.1, 2026-10-07) + TTT baseline:
 * - Props typed as `React.ComponentProps<typeof InputPrimitive>` (the Base UI primitive actually rendered).
 * - Radius role (D1): `rounded-lg` -> `rounded-sm` (text field).
 * - Label role (D2): `placeholder:text-muted-foreground` -> `placeholder:text-label-assistive`.
 * - Keeps stock's border + ring focus treatment.
 */
import * as React from "react";
import { Input as InputPrimitive } from "@base-ui/react/input";
import { cn } from "cn";

function Input({
  className,
  type,
  ...props
}: React.ComponentProps<typeof InputPrimitive>) {
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      className={cn(
        "h-8 w-full min-w-0 rounded-sm border border-input bg-transparent px-2.5 py-1 text-base transition-colors outline-none file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-label-assistive focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm dark:bg-input/30 dark:disabled:bg-input/80 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40",
        className,
      )}
      {...props}
    />
  );
}

export { Input };
