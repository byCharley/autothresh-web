interface AppIconProps {
  size?: number;
  color?: string;
}

export function AppIcon({ size = 32, color = 'currentColor' }: AppIconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      style={{ flexShrink: 0 }}
    >
      <path
        d="M 68,22 C 68,10 32,10 30,28 C 28,46 72,54 70,72 C 68,90 32,90 32,78"
        fill="none"
        stroke={color}
        strokeWidth="14"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
