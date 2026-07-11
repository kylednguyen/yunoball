/** Re-mounts on every route change, giving each page a quick entrance fade
 * (see .yb-route-enter — reduced-motion turns it off). */
export default function Template({ children }: { children: React.ReactNode }) {
  return <div className="yb-route-enter">{children}</div>;
}
