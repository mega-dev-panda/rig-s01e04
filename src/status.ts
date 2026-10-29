import { readdirSync } from 'node:fs';
import type { RigConfig } from './config.js';
import { lastBeat, type Beat } from './heartbeat.js';
import type { ReadNight } from './digest/types.js';

export type NightStatus = {
  night: string;
  statusCounts: { ok: number; retry: number; fail: number } | null;
};

export type Status = {
  adapter: string;
  installed: string;
  lastBeat: Beat | null;
  nights: NightStatus[];
};

function isValidNight(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

// Nights on disk = runs/<YYYY-MM-DD>.jsonl, newest first.
export function nightsOnDisk(runsDir: string): string[] {
  try {
    return readdirSync(runsDir)
      .filter((f) => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(f) && isValidNight(f.slice(0, 10)))
      .map((f) => f.slice(0, 10))
      .sort()
      .reverse();
  } catch {
    return [];
  }
}

export function readStatus(config: RigConfig, readNight?: ReadNight): Status {
  const nights = nightsOnDisk(config.runsDir).map((night): NightStatus => {
    if (!readNight) return { night, statusCounts: null };
    try {
      const result = readNight(config.runsDir, night);
      return {
        night,
        statusCounts: result.kind === 'found' ? result.statusCounts : null,
      };
    } catch {
      return { night, statusCounts: null };
    }
  });
  return {
    adapter: config.adapter,
    installed: config.installed,
    lastBeat: lastBeat(),
    nights,
  };
}
