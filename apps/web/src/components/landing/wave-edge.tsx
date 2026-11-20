/** Wavy seam between two sections, painted in the colour of the section above and hanging into the one below, with a hairline echo under the crest. */
export function WaveEdge({ fill, className = "" }: { fill: string; className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 1440 48" preserveAspectRatio="none" className={`pointer-events-none absolute inset-x-0 top-0 z-[1] h-6 w-full sm:h-10 ${className}`}>
      <path d="M0 0H1440V20C1320 34 1200 40 1080 31C960 22 840 6 720 11C600 16 480 38 360 37C240 36 120 19 0 24Z" fill={fill} />
      <path d="M0 33C120 28 240 44 360 46C480 47 600 25 720 19C840 13 960 29 1080 38C1200 47 1320 41 1440 28" fill="none" stroke={fill} strokeOpacity="0.45" strokeWidth="1" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
