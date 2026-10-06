import type { Arrival, Race, Terminal } from './types';

/** 两台终端同一艘船校正后相差不超过该秒数，视为一致，取最早一条入账 */
export const CONFLICT_THRESHOLD_SECONDS = 3;

/** 校正后到线时刻 = 本机记录时刻 + 本机钟差 */
export function getCorrectedAt(arrival: Arrival, terminals: Terminal[]): string {
  const terminal = terminals.find((item) => item.id === arrival.terminalId);
  const offset = terminal?.clockOffset ?? 0;
  return new Date(new Date(arrival.recordedAt).getTime() + offset * 1000).toISOString();
}

export function correctedTimeMs(arrival: Arrival, terminals: Terminal[]): number {
  return new Date(getCorrectedAt(arrival, terminals)).getTime();
}

/** 净用时 = 校正后到线时刻 - 起航时刻（秒） */
export function elapsedFromArrival(arrival: Arrival, terminals: Terminal[], race: Race): number {
  const ms = correctedTimeMs(arrival, terminals) - new Date(race.startsAt).getTime();
  return Math.max(0, Math.round(ms / 1000));
}

export function formatClockOffset(offset: number): string {
  return `${offset > 0 ? '+' : ''}${offset}s`;
}
