/**
 * SkipToContent — accessibility skip link.
 * Hidden until focused via Tab, then jumps to <main id="main-content">.
 * Mounted globally inside App provider tree.
 */
export default function SkipToContent() {
  return (
    <a
      href="#main-content"
      className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[100] focus:rounded-lg focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-foreground focus:shadow-lg focus-ring-healing"
    >
      跳至主要內容
    </a>
  );
}
