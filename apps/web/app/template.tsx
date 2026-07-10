/** Re-mounts on every route change, giving each page a quick entrance fade.
 * tw-animate-css utilities; reduced-motion is honored by the framework. */
export default function Template({ children }: { children: React.ReactNode }) {
  return (
    <div className="animate-in fade-in slide-in-from-bottom-1 duration-300">{children}</div>
  );
}
