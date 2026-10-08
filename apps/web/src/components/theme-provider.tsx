// design-system-kit 0.8.0 · profile shadcn · wiring: theme switching
"use client";

import * as React from "react";
import { ThemeProvider as NextThemesProvider } from "next-themes";

/**
 * next-themes writes data-theme="light" | "dark" on <html>, which is what the
 * generated token file keys off. Wrap the app in it from the root layout
 * (`<html suppressHydrationWarning>`); its blocking script prevents a flash
 * of the wrong theme.
 */
export function ThemeProvider({
  children,
  ...props
}: React.ComponentProps<typeof NextThemesProvider>) {
  return (
    <NextThemesProvider
      attribute="data-theme"
      defaultTheme="system"
      enableSystem
      // Colours and shadows change with the theme; animating them mid-switch
      // reads as a flash rather than a transition.
      disableTransitionOnChange
      {...props}
    >
      {children}
    </NextThemesProvider>
  );
}
