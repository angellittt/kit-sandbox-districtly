/**
 * Not a component — a test sitting beside the components it covers, exactly
 * as a real repo keeps them. The builder must not pull it into the bundle:
 * its imports drag a test renderer and its pretty-printer in, which both
 * bloats the bundle and carries the `<!--` that breaks a consumer inlining
 * it into a <script>.
 */
export const NOT_A_COMPONENT = "<!-- fixture sentinel -->"

export function WidgetTestOnly() {
  return <div className="bg-sentinel-leak p-[13px]">test-only</div>
}
