export default function ArcadeDockIcon({ size = 20 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
      <path
        fill="currentColor"
        d="M3 4h8v7H3V4Zm10 0h8v7h-8V4ZM3 13h5v7H3v-7Zm7 0h11v7H10v-7Z"
      />
    </svg>
  );
}
