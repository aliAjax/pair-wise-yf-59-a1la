export type RaceStatus = 'scheduled' | 'running' | 'finished';
export type ProtestStatus = 'submitted' | 'reviewing' | 'resolved' | 'rejected';
export type ResultStatus = 'provisional' | 'corrected' | 'official';
export type TerminalId = 'A' | 'B';
export type ArrivalStatus = 'pending' | 'booked' | 'review';
export type ReviewResolution = 'A' | 'B' | 'review-resolved';

export interface Race {
  id: string;
  name: string;
  fleet: string;
  course: string;
  startsAt: string;
  status: RaceStatus;
}

/** 起航线两侧的计时终端：rawAt + clockOffset 即统一时基下的到线时刻（毫秒） */
export interface TimingTerminal {
  id: TerminalId;
  name: string;
  /** 本机钟差（秒）：本机读数比标准时快为正、慢为负；校时后可改动 */
  clockOffset: number;
}

export interface Arrival {
  id: string;
  terminalId: TerminalId;
  sailNo: string;
  /** 终端本机读到的到线时刻（毫秒时间戳，未校钟差） */
  rawAt: number;
  /** 提交时刻使用的钟差快照（秒） */
  offsetSnapshot: number;
  submittedAt: string;
  status: ArrivalStatus;
  batchId: string | null;
  /** 入账后关联的成绩条目 */
  entryId: string | null;
  /** 归入复核对时的对组键 */
  reviewKey: string | null;
}

export interface RaceEntry {
  id: string;
  boat: string;
  sailNo: string;
  skipper: string;
  elapsedSeconds: number;
  penaltySeconds: number;
  resultStatus: ResultStatus;
  note: string;
  /** 依据的到线记录 */
  arrivalIds: string[];
  /** 被哪条终端/复核决定选中（两版并存时为空） */
  chosenTerminal: TerminalId | null;
  /** 重算或更正原因，用于名次作废提示 */
  recomputeReason: string;
  /** 两版到线时差过大，等待复核；复核中不进入名次 */
  awaitingReview: boolean;
  version: number;
}

/** 已发布的成绩快照；成绩随后被改动时原快照保留，另存更正版 */
export interface ResultPublication {
  id: string;
  entryId: string;
  sailNo: string;
  boat: string;
  elapsedSeconds: number;
  penaltySeconds: number;
  netSeconds: number;
  rank: number | null;
  version: number;
  publishedAt: string;
  superseded: boolean;
  supersedeReason: string;
  correctionOfId: string | null;
}

export interface Protest {
  id: string;
  raceId: string;
  entryId: string;
  reason: string;
  rule: string;
  status: ProtestStatus;
  decision: string;
  createdAt: string;
}

export interface TimelineEvent {
  id: string;
  time: string;
  type: 'race' | 'result' | 'protest' | 'timing' | 'system';
  message: string;
}
