import process from 'node:process';

export function getEnvVariable(name: string): string {
  const value: string | undefined = process.env[name];
  if (!value) throw new Error(`Environment variable ${name} not found`);
  return value;
}
