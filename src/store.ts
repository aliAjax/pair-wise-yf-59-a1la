import { configureStore, createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type { Arrival, Protest, ProtestStatus, Race, RaceEntry, ResultPublication, TerminalId, TimelineEvent, TimingTerminal } from './types';
import { raceApi } from './api';
import { MERGE_TOLERANCE_MS, correctedAtMs, rankOf, recomputeElapsed } from './reconcile';

export interface AppState {
  races: Race[];
  terminals: TimingTerminal[];
  arrivals: Arrival[];
  entries: RaceEntry[];
  publications: ResultPublication[];
  protests: Protest[];
  timeline: TimelineEvent[];
}

interface BoatInfo { boat: string; skipper: string; }
const boatRegistry: Record<string, BoatInfo> = {
  'CHN 218': { boat: '海风号', skipper: '林舟' },
  'CHN 106': { boat: '远岚号', skipper: '周屿' },
  'CHN 077': { boat: '北辰号', skipper: '许澄' },
  'CHN 301': { boat: '沧溟号', skipper: '陆行' },
  'CHN 052': { boat: '逐浪号', skipper: '韩潮' }
};
const boatOf = (sailNo: string): BoatInfo => boatRegistry[sailNo] ?? { boat: `待查 ${sailNo}`, skipper: '' };

const now = new Date();
const nowMs = now.getTime();
const startMs = nowMs - 50 * 60 * 1000;
const initialStart = new Date(startMs).toISOString();

const terminalA: TimingTerminal = { id: 'A', name: '起航线左舷终端', clockOffset: 1.2 };
const terminalB: TimingTerminal = { id: 'B', name: '起航线右舷终端', clockOffset: -0.8 };

let seq = 0;
const seedArrival = (terminal: TerminalId, sailNo: string, correctedSeconds: number, status: Arrival['status'], offsetSnapshot: number): Arrival => {
  seq += 1;
  return {
    id: `arrival-${seq}`,
    terminalId: terminal,
    sailNo,
    rawAt: startMs + correctedSeconds * 1000 + offsetSnapshot * 1000,
    offsetSnapshot,
    submittedAt: new Date(startMs + correctedSeconds * 1000).toISOString(),
    status,
    batchId: status === 'pending' ? null : 'batch-seed',
    entryId: null,
    reviewKey: null
  };
};

const initialEntries: RaceEntry[] = [
  { id: 'entry-1', boat: '海风号', sailNo: 'CHN 218', skipper: '林舟', elapsedSeconds: 3168, penaltySeconds: 0, resultStatus: 'provisional', note: '', arrivalIds: ['arrival-1', 'arrival-2'], chosenTerminal: 'A', recomputeReason: '', awaitingReview: false, version: 1 },
  { id: 'entry-2', boat: '远岚号', sailNo: 'CHN 106', skipper: '周屿', elapsedSeconds: 3194, penaltySeconds: 30, resultStatus: 'provisional', note: '标记争议', arrivalIds: ['arrival-3'], chosenTerminal: 'A', recomputeReason: '', awaitingReview: false, version: 1 },
  { id: 'entry-3', boat: '北辰号', sailNo: 'CHN 077', skipper: '许澄', elapsedSeconds: 3210, penaltySeconds: 0, resultStatus: 'official', note: '', arrivalIds: ['arrival-4', 'arrival-5'], chosenTerminal: 'A', recomputeReason: '', awaitingReview: false, version: 1 }
];

const initialPublications: ResultPublication[] = [{
  id: 'pub-1',
  entryId: 'entry-3',
  sailNo: 'CHN 077',
  boat: '北辰号',
  elapsedSeconds: 3210,
  penaltySeconds: 0,
  netSeconds: 3210,
  rank: 2,
  version: 1,
  publishedAt: new Date(nowMs - 60_000).toISOString(),
  superseded: false,
  supersedeReason: '',
  correctionOfId: null
}];

const initialArrivals: Arrival[] = [
  seedArrival('A', 'CHN 218', 3168, 'booked', terminalA.clockOffset),
  seedArrival('B', 'CHN 218', 3170, 'booked', terminalB.clockOffset),
  seedArrival('A', 'CHN 106', 3194, 'booked', terminalA.clockOffset),
  seedArrival('B', 'CHN 106', 3250, 'pending', terminalB.clockOffset),
  seedArrival('A', 'CHN 077', 3210, 'booked', terminalA.clockOffset),
  seedArrival('B', 'CHN 077', 3211, 'booked', terminalB.clockOffset),
  seedArrival('A', 'CHN 301', 3302, 'pending', terminalA.clockOffset),
  seedArrival('B', 'CHN 301', 3340, 'pending', terminalB.clockOffset),
  seedArrival('A', 'CHN 052', 3405, 'pending', terminalA.clockOffset)
];
initialArrivals.filter((a) => a.status === 'booked').forEach((a) => {
  a.entryId = initialEntries.find((e) => e.sailNo === a.sailNo)?.id ?? null;
});

const initialState: AppState = {
  races: [{ id: 'race-1', name: '海湾长距离赛 第1轮', fleet: '统一级', course: 'W2 / 东北风 12节', startsAt: initialStart, status: 'running' }],
  terminals: [terminalA, terminalB],
  arrivals: initialArrivals,
  entries: initialEntries,
  publications: initialPublications,
  protests: [{ id: 'protest-1', raceId: 'race-1', entryId: 'entry-2', reason: '起航后发生舷侧接触', rule: 'RRS 14', status: 'reviewing', decision: '', createdAt: now.toISOString() }],
  timeline: [
    { id: 'event-2', time: new Date(nowMs + 2000).toISOString(), type: 'protest', message: '远岚号抗议进入复核' },
    { id: 'event-1', time: now.toISOString(), type: 'timing', message: '两台计时终端已对时，等待合表：B 机 CHN 106 等 4 条记录未入账' }
  ]
};

const addEvent = (state: AppState, type: TimelineEvent['type'], message: string) => {
  state.timeline.unshift({ id: crypto.randomUUID(), time: new Date().toISOString(), type, message });
};

/** 已发布成绩作废，另存一版更正成绩 */
function supersedePublication(state: AppState, entry: RaceEntry, reason: string): boolean {
  const active = state.publications.filter((pub) => pub.entryId === entry.id && !pub.superseded);
  if (active.length === 0) return false;
  for (const pub of active) {
    pub.superseded = true;
    pub.supersedeReason = reason;
  }
  const previous = active[active.length - 1];
  const net = entry.elapsedSeconds + entry.penaltySeconds;
  state.publications.unshift({
    id: crypto.randomUUID(),
    entryId: entry.id,
    sailNo: entry.sailNo,
    boat: entry.boat,
    elapsedSeconds: entry.elapsedSeconds,
    penaltySeconds: entry.penaltySeconds,
    netSeconds: net,
    rank: rankOf(entry.id, state.entries),
    version: entry.version,
    publishedAt: new Date().toISOString(),
    superseded: false,
    supersedeReason: '',
    correctionOfId: previous.id
  });
  entry.resultStatus = 'corrected';
  return true;
}

function recomputeAll(state: AppState, reason: string) {
  const startMs = new Date(state.races[0].startsAt).getTime();
  const affected: string[] = [];
  for (const entry of state.entries) {
    if (entry.arrivalIds.length === 0) continue;
    const next = recomputeElapsed(entry, state.arrivals, state.terminals, startMs);
    if (next !== entry.elapsedSeconds) {
      entry.elapsedSeconds = next;
      entry.recomputeReason = reason;
      entry.version += 1;
      affected.push(entry.boat);
      supersedePublication(state, entry, reason);
    }
  }
  return affected;
}

const slice = createSlice({
  name: 'regatta',
  initialState,
  reducers: {
    setRaceStatus(state, action: PayloadAction<{ id: string; status: Race['status'] }>) {
      const race = state.races.find((item) => item.id === action.payload.id);
      if (race) {
        race.status = action.payload.status;
        addEvent(state, 'race', `${race.name} 状态更新为 ${race.status}`);
      }
    },

    /** 终端提交一条到线记录：先挂账，等待合表 */
    submitArrival(state, action: PayloadAction<{ terminalId: TerminalId; sailNo: string; rawAt: number }>) {
      const terminal = state.terminals.find((item) => item.id === action.payload.terminalId);
      if (!terminal) return;
      const arrival: Arrival = {
        id: crypto.randomUUID(),
        terminalId: terminal.id,
        sailNo: action.payload.sailNo.trim().toUpperCase(),
        rawAt: action.payload.rawAt,
        offsetSnapshot: terminal.clockOffset,
        submittedAt: new Date().toISOString(),
        status: 'pending',
        batchId: null,
        entryId: null,
        reviewKey: null
      };
      state.arrivals.unshift(arrival);
      addEvent(state, 'timing', `${terminal.name} 提交 ${arrival.sailNo} 到线记录，等待合表`);
    },

    /**
     * 合表（可中断续跑）：只处理 pending 记录。
     * 同船两机都有时：校正后 ≤3 秒取最早一条；差太多两版都留，挂复核。
     */
    reconcileArrivals(state) {
      const pending = state.arrivals.filter((arrival) => arrival.status === 'pending');
      if (pending.length === 0) {
        addEvent(state, 'timing', '合表续跑：没有未入账记录');
        return;
      }
      const batchId = crypto.randomUUID();
      let bookedCount = 0;
      let reviewCount = 0;
      const reviewBoats: string[] = [];

      const sailGroups = new Map<string, Arrival[]>();
      for (const arrival of pending) {
        const list = sailGroups.get(arrival.sailNo) ?? [];
        list.push(arrival);
        sailGroups.set(arrival.sailNo, list);
      }

      for (const [sailNo, group] of sailGroups) {
        const existing = state.entries.find((entry) => entry.sailNo === sailNo);
        if (existing?.awaitingReview) continue; // 复核未结，新到记录先不并
        const linkedBooked = existing
          ? existing.arrivalIds.map((id) => state.arrivals.find((item) => item.id === id)).filter((item): item is Arrival => item !== undefined && item.status !== 'pending')
          : [];
        const candidates = [...linkedBooked, ...group];
        const earliestOf = (terminalId: TerminalId) =>
          candidates.filter((a) => a.terminalId === terminalId).sort((x, y) => correctedAtMs(x, state.terminals) - correctedAtMs(y, state.terminals))[0];
        const a = earliestOf('A');
        const b = earliestOf('B');
        const all = [a, b].filter((x): x is Arrival => Boolean(x));
        const earliest = all.reduce((acc, cur) => (correctedAtMs(cur, state.terminals) < correctedAtMs(acc, state.terminals) ? cur : acc));
        const divergent = a !== undefined && b !== undefined && Math.abs(correctedAtMs(a, state.terminals) - correctedAtMs(b, state.terminals)) > MERGE_TOLERANCE_MS;

        let entry = existing;
        if (!entry) {
          const info = boatOf(sailNo);
          entry = {
            id: crypto.randomUUID(),
            boat: info.boat,
            sailNo,
            skipper: info.skipper,
            elapsedSeconds: 0,
            penaltySeconds: 0,
            resultStatus: 'provisional',
            note: '',
            arrivalIds: [],
            chosenTerminal: null,
            recomputeReason: '',
            awaitingReview: false,
            version: 1
          };
          state.entries.push(entry);
        }

        for (const arrival of group) {
          arrival.batchId = batchId;
          arrival.entryId = entry.id;
          arrival.status = divergent ? 'review' : 'booked';
        }
        for (const arrival of all) {
          if (!entry.arrivalIds.includes(arrival.id)) entry.arrivalIds.push(arrival.id);
        }

        if (divergent) {
          entry.awaitingReview = true;
          entry.chosenTerminal = null;
          entry.resultStatus = 'provisional';
          entry.note = entry.note || '两台终端校正后时差过大，两版并存待复核';
          reviewCount += 1;
          reviewBoats.push(sailNo);
        } else {
          entry.awaitingReview = false;
          entry.chosenTerminal = earliest.terminalId;
          bookedCount += 1;
        }
      }

      recomputeAll(state, '合表入账，净用时按校正到线时刻重算');
      addEvent(
        state,
        'timing',
        `合表完成（批次 ${batchId.slice(0, 8)}）：并入 ${bookedCount} 艘，${reviewCount} 艘留两版待复核${reviewBoats.length ? `：${reviewBoats.join('、')}` : ''}，相关名次已重算`
      );
    },

    /** 复核裁定：以某一台终端的到线时刻为准 */
    resolveReview(state, action: PayloadAction<{ entryId: string; chosenTerminal: TerminalId }>) {
      const entry = state.entries.find((item) => item.id === action.payload.entryId);
      if (!entry || !entry.awaitingReview) return;
      const hasTerminalRecord = entry.arrivalIds.some((id) => state.arrivals.find((a) => a.id === id)?.terminalId === action.payload.chosenTerminal);
      if (!hasTerminalRecord) return;
      entry.awaitingReview = false;
      entry.chosenTerminal = action.payload.chosenTerminal;
      entry.note = `复核裁定：以 ${action.payload.chosenTerminal} 机记录为准`;
      for (const arrival of state.arrivals) {
        if (entry.arrivalIds.includes(arrival.id)) arrival.status = 'booked';
      }
      const startMs = new Date(state.races[0].startsAt).getTime();
      const next = recomputeElapsed(entry, state.arrivals, state.terminals, startMs);
      if (next !== entry.elapsedSeconds) entry.elapsedSeconds = next;
      entry.version += 1;
      entry.recomputeReason = '复核裁定后重算';
      supersedePublication(state, entry, '复核裁定改变到线时刻');
      entry.resultStatus = 'corrected';
      addEvent(state, 'timing', `${entry.boat} 复核结束，采信 ${action.payload.chosenTerminal} 机，名次已重算`);
    },

    /** 修改终端钟差：相关成绩全部重算，名次作废；已发布的另存更正版 */
    updateClockOffset(state, action: PayloadAction<{ terminalId: TerminalId; clockOffset: number }>) {
      const terminal = state.terminals.find((item) => item.id === action.payload.terminalId);
      if (!terminal) return;
      const previous = terminal.clockOffset;
      terminal.clockOffset = action.payload.clockOffset;
      const affected = recomputeAll(state, `终端 ${terminal.id} 钟差由 ${previous}s 调整为 ${action.payload.clockOffset}s`);
      if (affected.length === 0) {
        addEvent(state, 'timing', `${terminal.name} 钟差改为 ${action.payload.clockOffset}s，在账成绩未受影响`);
      } else {
        addEvent(state, 'result', `钟差调整：${affected.join('、')} 净用时重算，相关名次作废重排；已发布成绩已另存更正版`);
      }
    },

    saveResult(state, action: PayloadAction<{ id: string; elapsedSeconds: number; penaltySeconds: number; note: string; official: boolean }>) {
      const entry = state.entries.find((item) => item.id === action.payload.id);
      if (!entry) return;
      const changed = entry.elapsedSeconds !== action.payload.elapsedSeconds || entry.penaltySeconds !== action.payload.penaltySeconds;
      entry.elapsedSeconds = action.payload.elapsedSeconds;
      entry.penaltySeconds = action.payload.penaltySeconds;
      entry.note = action.payload.note;
      entry.awaitingReview = false;
      if (action.payload.official) {
        const hasActive = state.publications.some((pub) => pub.entryId === entry.id && !pub.superseded);
        if (!hasActive) {
          state.publications.unshift({
            id: crypto.randomUUID(),
            entryId: entry.id,
            sailNo: entry.sailNo,
            boat: entry.boat,
            elapsedSeconds: entry.elapsedSeconds,
            penaltySeconds: entry.penaltySeconds,
            netSeconds: entry.elapsedSeconds + entry.penaltySeconds,
            rank: rankOf(entry.id, state.entries),
            version: entry.version,
            publishedAt: new Date().toISOString(),
            superseded: false,
            supersedeReason: '',
            correctionOfId: null
          });
        }
        entry.resultStatus = 'official';
        addEvent(state, 'result', `${entry.boat} 正式成绩已发布`);
      } else {
        entry.version += changed ? 1 : 0;
        entry.recomputeReason = changed ? '人工更正' : '';
        if (changed) {
          const archived = supersedePublication(state, entry, '人工更正成绩');
          addEvent(state, 'result', archived ? `${entry.boat} 成绩已更正，原发布版作废并存为更正版` : `${entry.boat} 成绩已更正，进入待发布状态`);
        }
      }
    },

    addProtest(state, action: PayloadAction<{ raceId: string; entryId: string; reason: string; rule: string }>) {
      const protest: Protest = { id: crypto.randomUUID(), ...action.payload, status: 'submitted', decision: '', createdAt: new Date().toISOString() };
      state.protests.unshift(protest);
      addEvent(state, 'protest', `收到 ${action.payload.rule} 抗议，等待复核`);
    },

    transitionProtest(state, action: PayloadAction<{ id: string; status: ProtestStatus; decision?: string; penaltySeconds?: number }>) {
      const protest = state.protests.find((item) => item.id === action.payload.id);
      if (!protest) return;
      protest.status = action.payload.status;
      protest.decision = action.payload.decision ?? protest.decision;
      if (action.payload.status === 'resolved' && action.payload.penaltySeconds !== undefined) {
        const entry = state.entries.find((item) => item.id === protest.entryId);
        if (entry && entry.penaltySeconds !== action.payload.penaltySeconds) {
          entry.penaltySeconds = action.payload.penaltySeconds;
          entry.version += 1;
          entry.recomputeReason = '抗议判罚加秒，名次重算';
          supersedePublication(state, entry, '抗议判罚调整处罚秒数');
          if (entry.resultStatus === 'provisional') entry.resultStatus = 'corrected';
          addEvent(state, 'result', `${entry.boat} 抗议判罚 +${action.payload.penaltySeconds}s，名次已重算`);
        }
      }
      addEvent(state, 'protest', `抗议 ${action.payload.id.slice(0, 6)} 更新为 ${action.payload.status}`);
    }
  }
});

const STORAGE_KEY = 'regatta-control-v2';
const stored = localStorage.getItem(STORAGE_KEY);
let preloadedState: AppState | null = null;
if (stored) {
  try {
    const parsed = JSON.parse(stored) as AppState;
    if (Array.isArray(parsed.arrivals) && Array.isArray(parsed.terminals) && Array.isArray(parsed.publications)) {
      preloadedState = parsed;
    }
  } catch {
    preloadedState = null;
  }
}

export const { setRaceStatus, submitArrival, reconcileArrivals, resolveReview, updateClockOffset, saveResult, addProtest, transitionProtest } = slice.actions;

export const store = configureStore({
  preloadedState: preloadedState ? { regatta: preloadedState } : undefined,
  reducer: { regatta: slice.reducer, [raceApi.reducerPath]: raceApi.reducer },
  middleware: (getDefaultMiddleware) => getDefaultMiddleware().concat(raceApi.middleware)
});
store.subscribe(() => localStorage.setItem(STORAGE_KEY, JSON.stringify(store.getState().regatta)));

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
