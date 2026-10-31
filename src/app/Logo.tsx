type LogoProps = {
  size?: number;
  /** Ball color. Defaults to brand navy. */
  color?: string;
  /** Drop the lace ticks and thicken the pulse; use below ~48px. */
  simple?: boolean;
};

/** The football mark: its laces form a pulse line. */
export function Logo({ size = 48, color = "#14213D", simple = size < 48 }: LogoProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 140 140" role="img" aria-label="Mathematically Alive">
      <g transform="rotate(-30 70 70)">
        <path d="M8 70 Q70 2 132 70 Q70 138 8 70 Z" fill={color} />
        {simple ? (
          <path
            d="M30 70 H54 L62 50 L76 90 L84 70 H110"
            fill="none"
            stroke="#FFFFFF"
            strokeWidth={14}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ) : (
          <>
            <path
              d="M22 54 Q24 70 22 86 M118 54 Q116 70 118 86"
              fill="none"
              stroke="#FFFFFF"
              strokeWidth={4}
              strokeLinecap="round"
              opacity={0.9}
            />
            <path
              d="M34 70 H54 L60 57 L68 86 L76 48 L83 70 H106"
              fill="none"
              stroke="#FFFFFF"
              strokeWidth={6}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path d="M40 63 V77 M47 63 V77 M90 63 V77 M98 63 V77" stroke="#FFFFFF" strokeWidth={4} strokeLinecap="round" />
          </>
        )}
      </g>
    </svg>
  );
}
