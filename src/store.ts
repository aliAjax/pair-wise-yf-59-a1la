import { configureStore, createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type { Arrival, ConflictGroup, Protest, ProtestStatus, Race, RaceEntry, ResultVersion, Terminal, TimelineEvent } from './types';
import { raceApi } from './api';
import { CONFLICT_THRESHOLD_SECONDS, correctedTimeMs, elapsedFromArrival } from './timing';

export interface AppState {
  races: Race[];
  entries: RaceEntry[];
  terminals: Terminal[];
  arrivals: Arrival[];
  conflicts: ConflictGroup[];
  resultVersions: ResultVersion[];
  protests: Protest[];
  timeline: TimelineEvent[];
}

const now = new Date();
const initialStart = new Date(now.getTime() + 15 * 60 * 1000).toISOString();

const initialEntries: RaceEntry[] = [
  { id: 'entry-1', boat: '海风号', sailNo: 'CHN 218', skipper: '林舟', elapsedSeconds: 3168, penaltySeconds: 0, resultStatus: 'provisional', note: '' },
  { id: 'entry-2', boat: '远岚号', sailNo: 'CHN 106', skipper: '周屿', elapsedSeconds: 3194, penaltySeconds: 30, resultStatus: 'provisional', note: '标记争议' },
  { id: 'entry-3', boat: '北辰号', sailNo: 'CHN 077', skipper: '许澄', elapsedSeconds: 3210, penaltySeconds: 0, resultStatus: 'official', note: '' },
  { id: 'entry-4', boat: '逐浪号', sailNo: 'CHN 305', skipper: '苏漾', elapsedSeconds: 3200, penaltySeconds: 0, resultStatus: 'corrected', note: '两版成绩待复核' }
];

const initialTerminals: Terminal[] = [
  { id: 'terminal-port', name: '左舷计时终端', side: 'port', clockOffset: 0 },
  { id: 'terminal-starboard', name: '右舷计时终端', side: 'starboard', clockOffset: 0 }
];

function isoAt(secondsAfterStart: number): string {
  return new Date(new Date(initialStart).getTime() + secondsAfterStart * 1000).toISOString();
}

const initialArrivals: Arrival[] = [
  // 海风号：双终端校正接近，已合表
  { id: 'arr-1', raceId: 'race-1', boat: '海风号', sailNo: 'CHN 218', terminalId: 'terminal-port', recordedAt: isoAt(3168), status: 'merged', createdAt: now.toISOString() },
  { id: 'arr-2', raceId: 'race-1', boat: '海风号', sailNo: 'CHN 218', terminalId: 'terminal-starboard', recordedAt: isoAt(3169), status: 'merged', createdAt: now.toISOString() },
  // 远岚号：单终端，待入账（演示合表补录）
  { id: 'arr-3', raceId: 'race-1', boat: '远岚号', sailNo: 'CHN 106', terminalId: 'terminal-port', recordedAt: isoAt(3194), status: 'pending', createdAt: now.toISOString() },
  // 北辰号：双终端校正接近，已合表并发布
  { id: 'arr-4', raceId: 'race-1', boat: '北辰号', sailNo: 'CHN 077', terminalId: 'terminal-port', recordedAt: isoAt(3210), status: 'merged', createdAt: now.toISOString() },
  { id: 'arr-5', raceId: 'race-1', boat: '北辰号', sailNo: 'CHN 077', terminalId: 'terminal-starboard', recordedAt: isoAt(3211), status: 'merged', createdAt: now.toISOString() },
  // 逐浪号：双终端校正差太多，留两版待复核
  { id: 'arr-6', raceId: 'race-1', boat: '逐浪号', sailNo: 'CHN 305', terminalId: 'terminal-port', recordedAt: isoAt(3200), status: 'conflict', createdAt: now.toISOString() },
  { id: 'arr-7', raceId: 'race-1', boat: '逐浪号', sailNo: 'CHN 305', terminalId: 'terminal-starboard', recordedAt: isoAt(3255), status: 'conflict', createdAt: now.toISOString() }
];

const initialConflicts: ConflictGroup[] = [
  { id: 'conflict-1', raceId: 'race-1', boat: '逐浪号', sailNo: 'CHN 305', arrivalIds: ['arr-6', 'arr-7'], status: 'open', createdAt: now.toISOString() }
];

const initialResultVersions: ResultVersion[] = [
  { id: 'rv-1', raceId: 'race-1', entryId: 'entry-1', version: 1, elapsedSeconds: 3168, penaltySeconds: 0, status: 'provisional', arrivalIds: ['arr-1', 'arr-2'], note: '双终端合表（校正接近，取最早）', createdAt: now.toISOString() },
  { id: 'rv-3', raceId: 'race-1', entryId: 'entry-3', version: 1, elapsedSeconds: 3210, penaltySeconds: 0, status: 'official', arrivalIds: ['arr-4', 'arr-5'], publishedAt: now.toISOString(), note: '双终端合表（校正接近，取最早）', createdAt: now.toISOString() }
];

const initialState: AppState = {
  races: [{ id: 'race-1', name: '海湾长距离赛 第1轮', fleet: '统一级', course: 'W2 / 东北风 12节', startsAt: initialStart, status: 'scheduled' }],
  entries: initialEntries,
  terminals: initialTerminals,
  arrivals: initialArrivals,
  conflicts: initialConflicts,
  resultVersions: initialResultVersions,
  protests: [{ id: 'protest-1', raceId: 'race-1', entryId: 'entry-2', reason: '起航后发生舷侧接触', rule: 'RRS 14', status: 'reviewing', decision: '', createdAt: now.toISOString() }],
  timeline: [
    { id: 'event-1', time: now.toISOString(), type: 'race', message: '航线 W2 已发布' },
    { id: 'event-2', time: new Date(now.getTime() + 2000).toISOString(), type: 'protest', message: '远岚号抗议进入复核' }
  ]
};

function latestVersion(state: AppState, entryId: string): ResultVersion | undefined {
  return state.resultVersions.filter((item) => item.entryId === entryId).sort((a, b) => b.version - a.version)[0];
}

function ensureEntry(state: AppState, sailNo: string, boat: string): string {
  let entry = state.entries.find((item) => item.sailNo === sailNo);
  if (!entry) {
    entry = { id: crypto.randomUUID(), boat, sailNo, skipper: '', elapsedSeconds: 0, penaltySeconds: 0, resultStatus: 'provisional', note: '' };
    state.entries.push(entry);
  }
  return entry.id;
}

/** 新建或更新草稿成绩；若最新一版已发布，则另起一版更正稿，已发布版本保持不变 */
function upsertResult(state: AppState, entryId: string, arrivalIds: string[], elapsedSeconds: number, note: string): ResultVersion {
  const latest = latestVersion(state, entryId);
  const race = state.races[0];
  if (!latest || latest.status === 'official') {
    const version = (latest?.version ?? 0) + 1;
    const rv: ResultVersion = {
      id: crypto.randomUUID(),
      raceId: latest?.raceId ?? race.id,
      entryId,
      version,
      elapsedSeconds,
      penaltySeconds: latest?.penaltySeconds ?? 0,
      status: latest ? 'corrected' : 'provisional',
      arrivalIds,
      note,
      createdAt: new Date().toISOString()
    };
    state.resultVersions.push(rv);
    return rv;
  }
  latest.elapsedSeconds = elapsedSeconds;
  latest.arrivalIds = arrivalIds;
  latest.note = note;
  return latest;
}

/** 把最新成绩同步到参赛船视图，名次随即可用 */
function syncEntry(state: AppState, entryId: string) {
  const entry = state.entries.find((item) => item.id === entryId);
  if (!entry) return;
  const latest = latestVersion(state, entryId);
  if (!latest) return;
  entry.elapsedSeconds = latest.elapsedSeconds;
  entry.penaltySeconds = latest.penaltySeconds;
  entry.resultStatus = latest.status;
  entry.note = latest.note;
}

function terminalLabel(state: AppState, terminalId: string): string {
  return state.terminals.find((item) => item.id === terminalId)?.name ?? terminalId;
}

const slice = createSlice({
  name: 'regatta',
  initialState,
  reducers: {
    setRaceStatus(state, action: PayloadAction<{ id: string; status: Race['status'] }>) {
      const race = state.races.find((item) => item.id === action.payload.id);
      if (race) {
        race.status = action.payload.status;
        state.timeline.unshift({ id: crypto.randomUUID(), time: new Date().toISOString(), type: 'race', message: `${race.name} 状态更新为 ${race.status}` });
      }
    },
    /** 手工录入/更正成绩：走版本管理，已发布成绩另存更正版 */
    saveResult(state, action: PayloadAction<{ id: string; elapsedSeconds: number; penaltySeconds: number; note: string; official: boolean }>) {
      const entry = state.entries.find((item) => item.id === action.payload.id);
      if (!entry) return;
      const latest = latestVersion(state, entry.id);
      const race = state.races[0];
      if (!latest || latest.status === 'official') {
        const rv: ResultVersion = {
          id: crypto.randomUUID(),
          raceId: latest?.raceId ?? race.id,
          entryId: entry.id,
          version: (latest?.version ?? 0) + 1,
          elapsedSeconds: action.payload.elapsedSeconds,
          penaltySeconds: action.payload.penaltySeconds,
          status: action.payload.official ? 'official' : latest ? 'corrected' : 'provisional',
          arrivalIds: latest?.arrivalIds ?? [],
          publishedAt: action.payload.official ? new Date().toISOString() : undefined,
          note: action.payload.note || (latest ? '成绩更正' : '手工录入'),
          createdAt: new Date().toISOString()
        };
        state.resultVersions.push(rv);
      } else {
        latest.elapsedSeconds = action.payload.elapsedSeconds;
        latest.penaltySeconds = action.payload.penaltySeconds;
        latest.note = action.payload.note || latest.note;
        if (action.payload.official) {
          latest.status = 'official';
          latest.publishedAt = new Date().toISOString();
        }
      }
      syncEntry(state, entry.id);
      state.timeline.unshift({ id: crypto.randomUUID(), time: new Date().toISOString(), type: 'result', message: `${entry.boat} 成绩更正为 ${action.payload.elapsedSeconds + action.payload.penaltySeconds} 秒` });
    },
    addProtest(state, action: PayloadAction<{ raceId: string; entryId: string; reason: string; rule: string }>) {
      const protest: Protest = { id: crypto.randomUUID(), ...action.payload, status: 'submitted', decision: '', createdAt: new Date().toISOString() };
      state.protests.unshift(protest);
      state.timeline.unshift({ id: crypto.randomUUID(), time: protest.createdAt, type: 'protest', message: `收到 ${action.payload.rule} 抗议，等待复核` });
    },
    transitionProtest(state, action: PayloadAction<{ id: string; status: ProtestStatus; decision?: string; penaltySeconds?: number }>) {
      const protest = state.protests.find((item) => item.id === action.payload.id);
      if (!protest) return;
      protest.status = action.payload.status;
      protest.decision = action.payload.decision ?? protest.decision;
      if (action.payload.status === 'resolved' && action.payload.penaltySeconds) {
        const entry = state.entries.find((item) => item.id === protest.entryId);
        if (entry) {
          const latest = latestVersion(state, entry.id);
          if (latest && latest.status !== 'official') {
            latest.penaltySeconds = action.payload.penaltySeconds;
            latest.status = 'corrected';
          } else {
            state.resultVersions.push({
              id: crypto.randomUUID(),
              raceId: latest?.raceId ?? state.races[0].id,
              entryId: entry.id,
              version: (latest?.version ?? 0) + 1,
              elapsedSeconds: latest?.elapsedSeconds ?? entry.elapsedSeconds,
              penaltySeconds: action.payload.penaltySeconds,
              status: 'corrected',
              arrivalIds: latest?.arrivalIds ?? [],
              note: '抗议成立，追加处罚',
              createdAt: new Date().toISOString()
            });
          }
          syncEntry(state, entry.id);
        }
      }
      state.timeline.unshift({ id: crypto.randomUUID(), time: new Date().toISOString(), type: 'protest', message: `抗议 ${action.payload.id.slice(0, 6)} 更新为 ${action.payload.status}` });
    },
    /** 提交一条到达记录（终端侧），状态为待合表 */
    addArrival(state, action: PayloadAction<{ boat: string; sailNo: string; terminalId: string; recordedAt: string }>) {
      const race = state.races[0];
      const arrival: Arrival = {
        id: crypto.randomUUID(),
        raceId: race.id,
        status: 'pending',
        createdAt: new Date().toISOString(),
        ...action.payload
      };
      state.arrivals.push(arrival);
      state.timeline.unshift({ id: crypto.randomUUID(), time: arrival.createdAt, type: 'system', message: `${terminalLabel(state, arrival.terminalId)} 提交 ${arrival.boat} 到达记录，待合表` });
    },
    /**
     * 合表对账：只处理 pending 记录，已入账/已复核的不动，因此中断后可继续补没入账的部分。
     * 同一艘船两台终端都有记录时：校正后接近取最早一条入账；相差太大留两版待复核。
     */
    runReconciliation(state) {
      const pending = state.arrivals.filter((item) => item.status === 'pending');
      if (pending.length === 0) return;
      const race = state.races[0];
      let mergedCount = 0;
      let conflictCount = 0;
      const groups = new Map<string, Arrival[]>();
      for (const arrival of pending) {
        const group = groups.get(arrival.sailNo) ?? [];
        group.push(arrival);
        groups.set(arrival.sailNo, group);
      }
      for (const [sailNo, group] of groups) {
        const boat = group[0].boat;
        const allForBoat = state.arrivals.filter((item) => item.sailNo === sailNo);
        const earliestByTerminal = new Map<string, Arrival>();
        for (const arrival of allForBoat) {
          const current = earliestByTerminal.get(arrival.terminalId);
          if (!current || correctedTimeMs(arrival, state.terminals) < correctedTimeMs(current, state.terminals)) {
            earliestByTerminal.set(arrival.terminalId, arrival);
          }
        }
        const terminalIds = [...earliestByTerminal.keys()];
        if (terminalIds.length >= 2) {
          const first = earliestByTerminal.get(terminalIds[0])!;
          const second = earliestByTerminal.get(terminalIds[1])!;
          const diff = Math.abs(correctedTimeMs(first, state.terminals) - correctedTimeMs(second, state.terminals)) / 1000;
          if (diff <= CONFLICT_THRESHOLD_SECONDS) {
            const winner = correctedTimeMs(first, state.terminals) <= correctedTimeMs(second, state.terminals) ? first : second;
            const entryId = ensureEntry(state, sailNo, boat);
            const elapsed = elapsedFromArrival(winner, state.terminals, race);
            const rv = upsertResult(state, entryId, [first.id, second.id], elapsed, '双终端合表（校正接近，取最早）');
            syncEntry(state, entryId);
            for (const arrival of group) {
              arrival.status = 'merged';
              arrival.resultVersionId = rv.id;
            }
            const open = state.conflicts.find((item) => item.sailNo === sailNo && item.status === 'open');
            if (open) {
              open.status = 'resolved';
              open.chosenArrivalId = winner.id;
            }
            mergedCount += group.length;
          } else {
            let conflict = state.conflicts.find((item) => item.sailNo === sailNo && item.status === 'open');
            if (!conflict) {
              conflict = {
                id: crypto.randomUUID(),
                raceId: race.id,
                boat,
                sailNo,
                arrivalIds: [first.id, second.id],
                status: 'open',
                createdAt: new Date().toISOString()
              };
              state.conflicts.unshift(conflict);
            } else {
              conflict.arrivalIds = [first.id, second.id];
            }
            for (const arrival of group) {
              arrival.status = 'conflict';
              arrival.conflictId = conflict.id;
            }
            conflictCount += group.length;
          }
        } else {
          const winner = [...group].sort((a, b) => correctedTimeMs(a, state.terminals) - correctedTimeMs(b, state.terminals))[0];
          const entryId = ensureEntry(state, sailNo, boat);
          const elapsed = elapsedFromArrival(winner, state.terminals, race);
          const rv = upsertResult(state, entryId, [winner.id], elapsed, '单终端入账');
          syncEntry(state, entryId);
          for (const arrival of group) {
            arrival.status = 'merged';
            arrival.resultVersionId = rv.id;
          }
          mergedCount += group.length;
        }
      }
      state.timeline.unshift({
        id: crypto.randomUUID(),
        time: new Date().toISOString(),
        type: 'system',
        message: `合表完成：${mergedCount} 条入账，${conflictCount} 条留待复核`
      });
    },
    /** 复核冲突：选定一版入账，另一版作废 */
    resolveConflict(state, action: PayloadAction<{ conflictId: string; chosenArrivalId: string }>) {
      const conflict = state.conflicts.find((item) => item.id === action.payload.conflictId);
      if (!conflict || conflict.status !== 'open') return;
      const chosen = state.arrivals.find((item) => item.id === action.payload.chosenArrivalId);
      if (!chosen) return;
      conflict.status = 'resolved';
      conflict.chosenArrivalId = chosen.id;
      const race = state.races[0];
      const entryId = ensureEntry(state, conflict.sailNo, conflict.boat);
      const elapsed = elapsedFromArrival(chosen, state.terminals, race);
      const rv = upsertResult(state, entryId, [chosen.id], elapsed, '复核选择版本');
      syncEntry(state, entryId);
      for (const arrivalId of conflict.arrivalIds) {
        const arrival = state.arrivals.find((item) => item.id === arrivalId);
        if (arrival) {
          arrival.status = arrivalId === chosen.id ? 'merged' : 'superseded';
          if (arrivalId === chosen.id) arrival.resultVersionId = rv.id;
        }
      }
      state.timeline.unshift({
        id: crypto.randomUUID(),
        time: new Date().toISOString(),
        type: 'result',
        message: `${conflict.boat} 复核完成，采用${terminalLabel(state, chosen.terminalId)}版本（${elapsed}s）`
      });
    },
    /** 发布当前成绩：若已是正式版则忽略；发布后该版不可变 */
    publishResult(state, action: PayloadAction<{ entryId: string }>) {
      const latest = latestVersion(state, action.payload.entryId);
      if (!latest || latest.status === 'official') return;
      const entry = state.entries.find((item) => item.id === action.payload.entryId);
      latest.status = 'official';
      latest.publishedAt = new Date().toISOString();
      syncEntry(state, action.payload.entryId);
      state.timeline.unshift({
        id: crypto.randomUUID(),
        time: new Date().toISOString(),
        type: 'result',
        message: `${entry?.boat ?? ''} 成绩 v${latest.version} 已发布为正式成绩`
      });
    },
    /**
     * 钟差改动：重算该终端所有到达记录的校正时刻，相关名次作废重算。
     * 已发布成绩另存更正版（保留已发布版本），未发布的草稿直接更新。
     */
    updateTerminalOffset(state, action: PayloadAction<{ id: string; clockOffset: number }>) {
      const terminal = state.terminals.find((item) => item.id === action.payload.id);
      if (!terminal) return;
      if (terminal.clockOffset === action.payload.clockOffset) return;
      terminal.clockOffset = action.payload.clockOffset;
      const race = state.races[0];
      const affectedArrivals = state.arrivals.filter((item) => item.terminalId === terminal.id);
      const entryIds = new Set<string>();
      for (const arrival of affectedArrivals) {
        for (const version of state.resultVersions) {
          if (version.arrivalIds.includes(arrival.id)) entryIds.add(version.entryId);
        }
      }
      for (const entryId of entryIds) {
        const latest = latestVersion(state, entryId);
        if (!latest) continue;
        const arrivals = state.arrivals.filter((item) => latest.arrivalIds.includes(item.id));
        if (arrivals.length === 0) continue;
        const winner = [...arrivals].sort((a, b) => correctedTimeMs(a, state.terminals) - correctedTimeMs(b, state.terminals))[0];
        const elapsed = elapsedFromArrival(winner, state.terminals, race);
        if (latest.status === 'official') {
          state.resultVersions.push({
            id: crypto.randomUUID(),
            raceId: latest.raceId,
            entryId,
            version: latest.version + 1,
            elapsedSeconds: elapsed,
            penaltySeconds: latest.penaltySeconds,
            status: 'corrected',
            arrivalIds: latest.arrivalIds,
            note: '钟差更正后重算，待重新发布',
            createdAt: new Date().toISOString()
          });
        } else {
          latest.elapsedSeconds = elapsed;
          latest.note = '钟差更正后重算';
        }
        syncEntry(state, entryId);
      }
      state.timeline.unshift({
        id: crypto.randomUUID(),
        time: new Date().toISOString(),
        type: 'system',
        message: `${terminal.name} 钟差调整为 ${action.payload.clockOffset > 0 ? '+' : ''}${action.payload.clockOffset}s，相关成绩已作废重算`
      });
    }
  }
});

const STORAGE_KEY = 'regatta-control-v2';

function loadState(): AppState {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (!stored) return initialState;
  try {
    const parsed = JSON.parse(stored) as Partial<AppState>;
    return {
      ...initialState,
      ...parsed,
      terminals: parsed.terminals ?? initialState.terminals,
      arrivals: parsed.arrivals ?? initialState.arrivals,
      conflicts: parsed.conflicts ?? initialState.conflicts,
      resultVersions: parsed.resultVersions ?? initialState.resultVersions,
      entries: parsed.entries ?? initialState.entries,
      races: parsed.races ?? initialState.races,
      protests: parsed.protests ?? initialState.protests,
      timeline: parsed.timeline ?? initialState.timeline
    };
  } catch {
    return initialState;
  }
}

const preloadedState: { regatta: AppState } = { regatta: loadState() };

export const { setRaceStatus, saveResult, addProtest, transitionProtest, addArrival, runReconciliation, resolveConflict, publishResult, updateTerminalOffset } = slice.actions;

export const store = configureStore({
  reducer: { regatta: slice.reducer, [raceApi.reducerPath]: raceApi.reducer },
  preloadedState,
  middleware: (getDefaultMiddleware) => getDefaultMiddleware().concat(raceApi.middleware)
});
store.subscribe(() => localStorage.setItem(STORAGE_KEY, JSON.stringify(store.getState().regatta)));

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
