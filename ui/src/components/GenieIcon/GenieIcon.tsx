// The Genie lamp used in the header, the empty state and the answer avatar.
export default function GenieIcon({
  size = 18,
  strokeWidth = 4,
}: {
  size?: number;
  strokeWidth?: number;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M10 40c0-6 5-10 12-10h20c7 0 12 4 12 10 0 4-3 7-7 7H17c-4 0-7-3-7-7z"
        fill="#7b3fe4"
      />
      <rect x="24" y="47" width="16" height="5" rx="2" fill="#5b2bb8" />
      <path
        d="M30 28c-4-5 3-7 0-12s4-6 6-10"
        stroke="#38bdf8"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
      />
    </svg>
  );
}
