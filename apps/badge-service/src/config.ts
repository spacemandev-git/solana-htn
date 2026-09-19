export interface ServiceConfig {
  nodeEnv: string;
  isProduction: boolean;
  port: number;
  databasePath: string;
  corsOrigins: string[];
  publicUrl: string;
  adminToken: string | undefined;
}

export function loadConfig(
  env: Record<string, string | undefined> = process.env,
): ServiceConfig {
  const nodeEnv = env.NODE_ENV ?? 'development';
  const rawPort = Number(env.PORT ?? '3100');
  const port = Number.isInteger(rawPort) && rawPort >= 0 && rawPort <= 65_535 ? rawPort : 3100;
  const corsOrigins = (env.CORS_ORIGINS ?? 'http://localhost:5173,http://127.0.0.1:5173')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  return {
    nodeEnv,
    isProduction: nodeEnv === 'production',
    port,
    databasePath: env.DATABASE_PATH ?? './data/badge.db',
    corsOrigins,
    publicUrl: env.PUBLIC_URL ?? 'http://localhost:3100',
    adminToken: env.ADMIN_TOKEN || undefined,
  };
}
