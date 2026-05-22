import { motion, useReducedMotion } from "framer-motion";

interface Props {
  glowColor: string;
}

export default function CosmicBackdrop({ glowColor }: Props) {
  const reduceMotion = useReducedMotion();
  const starLayers = [
    {
      opacity: 0.42,
      duration: 160,
      drift: ["0px 0px", "58px -36px", "0px 0px"],
      density: "170px 170px",
      twinkle: [0.32, 0.55, 0.34, 0.5, 0.32],
      twinkleDuration: 9,
    },
    {
      opacity: 0.28,
      duration: 120,
      drift: ["0px 0px", "-52px -30px", "0px 0px"],
      density: "125px 125px",
      twinkle: [0.22, 0.4, 0.2, 0.36, 0.22],
      twinkleDuration: 7.5,
    },
    {
      opacity: 0.18,
      duration: 90,
      drift: ["0px 0px", "30px -24px", "0px 0px"],
      density: "92px 92px",
      twinkle: [0.15, 0.3, 0.14, 0.26, 0.15],
      twinkleDuration: 6.5,
    },
  ] as const;

  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-[18] overflow-hidden">
      <motion.div
        className="absolute inset-[-12%]"
        style={{
          background:
            "radial-gradient(120% 120% at 15% 8%, rgba(70,95,220,0.24) 0%, transparent 45%), radial-gradient(95% 80% at 85% 12%, rgba(126,66,224,0.2) 0%, transparent 52%), radial-gradient(120% 110% at 50% 88%, rgba(28,88,168,0.2) 0%, transparent 58%), linear-gradient(165deg, rgba(4,8,26,0.96) 0%, rgba(7,12,35,0.95) 45%, rgba(14,8,35,0.95) 100%)",
        }}
        animate={
          reduceMotion
            ? undefined
            : {
                backgroundPosition: ["0% 0%", "6% 4%", "-4% 6%", "0% 0%"],
                filter: ["saturate(1)", "saturate(1.12)", "saturate(1)"]
              }
        }
        transition={reduceMotion ? undefined : { duration: 48, repeat: Infinity, ease: "easeInOut" }}
      />

      {starLayers.map((specs, layer) => {
        return (
          <motion.div
            key={layer}
            className="absolute inset-0"
            style={{
              opacity: specs.opacity,
              backgroundImage: `radial-gradient(circle at center, rgba(255,255,255,0.95) 0, rgba(255,255,255,0.85) 32%, transparent 55%)`,
              backgroundSize: specs.density,
              maskImage: "radial-gradient(circle at center, black 32%, transparent 100%)",
              WebkitMaskImage: "radial-gradient(circle at center, black 32%, transparent 100%)",
            }}
            animate={
              reduceMotion
                ? undefined
                : {
                    backgroundPosition: specs.drift as unknown as string[],
                    opacity: specs.twinkle as unknown as number[],
                  }
            }
            transition={
              reduceMotion
                ? undefined
                : {
                    backgroundPosition: {
                      duration: specs.duration,
                      repeat: Infinity,
                      ease: "linear",
                    },
                    opacity: {
                      duration: specs.twinkleDuration,
                      repeat: Infinity,
                      ease: "easeInOut",
                    },
                  }
            }
          />
        );
      })}

      <motion.div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(60% 40% at 12% 16%, rgba(134,88,255,0.13) 0%, transparent 75%), radial-gradient(45% 35% at 88% 76%, rgba(65,136,255,0.11) 0%, transparent 72%), radial-gradient(50% 40% at 50% 48%, rgba(136,73,219,0.08) 0%, transparent 70%)",
          filter: "blur(20px)",
        }}
        animate={reduceMotion ? undefined : { opacity: [0.45, 0.62, 0.45], scale: [1, 1.03, 1] }}
        transition={reduceMotion ? undefined : { duration: 26, repeat: Infinity, ease: "easeInOut" }}
      />

      <motion.div
        className="absolute inset-[-8%]"
        style={{
          background:
            "radial-gradient(34% 30% at 8% 14%, rgba(121, 93, 255, 0.2) 0%, transparent 75%), radial-gradient(40% 36% at 92% 22%, rgba(63, 136, 255, 0.16) 0%, transparent 78%), radial-gradient(36% 30% at 88% 84%, rgba(193, 110, 255, 0.13) 0%, transparent 80%), radial-gradient(33% 28% at 12% 86%, rgba(90, 161, 255, 0.14) 0%, transparent 76%)",
          filter: "blur(44px)",
        }}
        animate={
          reduceMotion
            ? undefined
            : {
                x: ["0%", "2.5%", "-1.5%", "0%"],
                y: ["0%", "-1.8%", "2.2%", "0%"],
                opacity: [0.52, 0.72, 0.58, 0.52],
              }
        }
        transition={reduceMotion ? undefined : { duration: 32, repeat: Infinity, ease: "easeInOut" }}
      />

      {!reduceMotion && (
        <>
          {[0, 1].map(i => (
            <motion.span
              key={i}
              className="absolute block h-px w-40 sm:w-56"
              style={{
                top: i === 0 ? "22%" : "66%",
                left: i === 0 ? "-18%" : "-24%",
                background:
                  "linear-gradient(90deg, transparent 0%, rgba(220,232,255,0.5) 35%, rgba(199,176,255,0.7) 55%, transparent 100%)",
                filter: "blur(0.2px)",
                transform: "rotate(-20deg)",
              }}
              animate={{ x: ["0vw", "132vw"], opacity: [0, 0, 0.5, 0, 0] }}
              transition={{ duration: 13 + i * 2, repeat: Infinity, ease: "easeOut", delay: i * 4 + 1.5 }}
            />
          ))}
        </>
      )}

      <motion.div
        className="absolute inset-0"
        style={{
          background: `radial-gradient(55% 55% at 50% 48%, ${glowColor.replace(/0\.\d+\)/, "0.13)")} 0%, transparent 68%)`,
          filter: "blur(24px)",
        }}
        animate={reduceMotion ? undefined : { opacity: [0.25, 0.45, 0.25] }}
        transition={reduceMotion ? undefined : { duration: 10, repeat: Infinity, ease: "easeInOut" }}
      />
    </div>
  );
}
