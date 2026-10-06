import type { Arrival, RaceEntry, TimingTerminal } from './types';

/** 两机校正后时差不超过该阈值即视为同一次到线，取最早一条 */
export const MERGE_TOLERANCE_MS = 3000;

/** 本机读数比标准时快 clockOffset 秒：标准时刻 = 本机读数 - 钟差（秒） */
export function correctedAtMs(arrival: Arrival, terminals: TimingTerminal[]): number {
  const terminal = terminals.find((item) => item.id === arrival.terminalId);
  const offsetSeconds = terminal ? terminal.clockOffset : arrival.offsetSnapshot;
  return arrival.rawAt - offsetSeconds * 1000;
}

export function formatClock(ms: number): string {
  return new Date(ms).toLocaleString('zh-CN', { hour12: false });
}

export function formatOffset(offset: number): string {
  return `${offset > 0 ? '+' : ''}${offset.toFixed(1)} 秒`;
}

/** 按选中的到线记录重算净用时（秒）；复核中的条目取最早候选，且不进入名次 */
export function recomputeElapsed(entry: RaceEntry, arrivals: Arrival[], terminals: TimingTerminal[], startMs: number): number {
  const linked = entry.arrivalIds
    .map((id) => arrivals.find((item) => item.id === id))
    .filter((item): item is Arrival => Boolean(item));
  if (linked.length === 0) return entry.elapsedSeconds;
  let basis: Arrival | undefined;
  if (entry.chosenTerminal) {
    basis = linked.find((item) => item.terminalId === entry.chosenTerminal);
  }
  if (!basis) basis = linked.reduce((earliest, item) => (correctedAtMs(item, terminals) < correctedAtMs(earliest, terminals) ? item : earliest));
  return Math.max(0, Math.round((correctedAtMs(basis, terminals) - startMs) / 1000));
}

export interface RankedEntry {
  entry: RaceEntry;
  net: number;
  rank: number | null;
}

/** 名次：待复核两版不参与排名；正式/临时成绩按净用时升序 */
export function rankEntries(entries: RaceEntry[]): RankedEntry[] {
  const netOf = (entry: RaceEntry) => entry.elapsedSeconds + entry.penaltySeconds;
  const eligible = entries.filter((entry) => !entry.awaitingReview);
  const sorted = [...eligible].sort((a, b) => netOf(a) - netOf(b));
  const ranked: RankedEntry[] = sorted.map((entry, index) => ({ entry, net: netOf(entry), rank: index + 1 }));
  const pending = entries
    .filter((entry) => entry.awaitingReview)
    .map((entry) => ({ entry, net: netOf(entry), rank: null }));
  return [...ranked, ...pending];
}

export function rankOf(entryId: string, entries: RaceEntry[]): number | null {
  return rankEntries(entries).find((item) => item.entry.id === entryId)?.rank ?? null;
}
