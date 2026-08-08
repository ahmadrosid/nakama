"use client";

import { Dithering, GrainGradient } from "@paper-design/shaders-react";
import { useTheme } from "fumadocs-ui/provider/base";
import { useEffect, useRef, useState } from "react";
import { useIsVisible } from "@/lib/use-is-visible";

export function HeroPaperBackground() {
  const { resolvedTheme } = useTheme();
  const ref = useRef<HTMLDivElement | null>(null);
  const visible = useIsVisible(ref);
  const [showShaders, setShowShaders] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setShowShaders(true);
    }, 400);

    return () => window.clearTimeout(timer);
  }, []);

  const isDark = resolvedTheme === "dark";

  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 overflow-hidden"
      ref={ref}
    >
      {showShaders && (
        <GrainGradient
          className="absolute inset-0 animate-fd-fade-in duration-[800ms]"
          colorBack="#00000000"
          colors={
            isDark
              ? ["#39BE1C", "#9c2f05", "#7A2A0000"]
              : ["#fcfc51", "#ffa057", "#7A2A0020"]
          }
          fit="cover"
          intensity={0.9}
          maxPixelCount={1920 * 1080}
          minPixelRatio={1}
          noise={0.5}
          shape="corners"
          softness={1}
          speed={visible ? 1 : 0}
          style={{ height: "100%", width: "100%" }}
        />
      )}
      {showShaders && (
        <Dithering
          className="absolute bottom-[-55%] left-[-220px] animate-fd-fade-in duration-[400ms] sm:bottom-[-50%] lg:bottom-[-58%] lg:left-[-260px]"
          colorBack="#00000000"
          colorFront={isDark ? "#DF3F00" : "#fa8023"}
          frame={5000 * 120}
          height={720}
          minPixelRatio={1}
          scale={0.5}
          shape="sphere"
          size={3}
          speed={0}
          type="4x4"
          width={720}
        />
      )}
    </div>
  );
}
