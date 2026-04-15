import { useState, useEffect, useCallback } from "react";
import { ArrowUp } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

/**
 * Floating scroll-to-top button that appears when user scrolls past threshold.
 * Attaches to the nearest scrollable parent or window.
 */
export default function ScrollToTop({
  threshold = 400,
}: {
  threshold?: number;
}) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // Find the scrollable parent — the SidebarInset main content area
    const scrollParent = document.querySelector(
      "[data-scroll-area]"
    ) as HTMLElement | null;
    const target = scrollParent || window;

    const handleScroll = () => {
      if (scrollParent) {
        setVisible(scrollParent.scrollTop > threshold);
      } else {
        setVisible(window.scrollY > threshold);
      }
    };

    target.addEventListener("scroll", handleScroll, { passive: true });
    return () => target.removeEventListener("scroll", handleScroll);
  }, [threshold]);

  const scrollToTop = useCallback(() => {
    const scrollParent = document.querySelector(
      "[data-scroll-area]"
    ) as HTMLElement | null;
    if (scrollParent) {
      scrollParent.scrollTo({ top: 0, behavior: "smooth" });
    } else {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }, []);

  return (
    <AnimatePresence>
      {visible && (
        <motion.button
          initial={{ opacity: 0, scale: 0.8, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.8, y: 10 }}
          transition={{ duration: 0.2, ease: "easeOut" }}
          onClick={scrollToTop}
          className="fixed bottom-6 right-6 z-50 w-10 h-10 rounded-full bg-white/80 backdrop-blur-sm border border-white/60 shadow-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-white hover:shadow-xl transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label="回到頂部"
        >
          <ArrowUp className="w-4 h-4" />
        </motion.button>
      )}
    </AnimatePresence>
  );
}
