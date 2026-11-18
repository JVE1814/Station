export function manualNotches(speed, remaining, limit) {
  if (remaining <= 5) return { traction: 0, brake: 5 };
  const terminal = remaining < 120;
  const creeping = remaining <= 24;
  const target = creeping ? 4 : Math.min(limit - 8, 62, 3.6 * Math.sqrt(0.40 * (remaining - 17)));
  const excess = speed - target;
  if (excess >= (terminal ? 1 : 3)) {
    const brake = terminal ? (excess > 4 ? 5 : 3) : (excess > 8 ? 4 : 2);
    return { traction: 0, brake };
  }
  if (excess <= (terminal ? -1 : -2)) {
    return { traction: creeping ? 1 : terminal ? 2 : 5, brake: 0 };
  }
  return { traction: 0, brake: 0 };
}
