// デモモードかどうか（common.md 1.3）
export function isDemoMode(): boolean {
  return process.env.DEMO_MODE === "1";
}