export function Icon({ name, color }: { name: string; color?: string }) {
  return <i class={`ti ${name}`} style={color ? { color } : undefined} aria-hidden="true" />;
}
