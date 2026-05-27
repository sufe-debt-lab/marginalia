export type HealthInfo = {
  status: "ok";
  service: "pi-server";
  version: string;
  startedAt: string;
};

export function createHealthInfo(startedAt: Date): HealthInfo {
  return {
    status: "ok",
    service: "pi-server",
    version: "0.1.0",
    startedAt: startedAt.toISOString()
  };
}
