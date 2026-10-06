export type RaceStatus = 'scheduled' | 'running' | 'finished';
export type ProtestStatus = 'submitted' | 'reviewing' | 'resolved' | 'rejected';
export type ResultStatus = 'provisional' | 'corrected' | 'official';
export type ArrivalStatus = 'pending' | 'merged' | 'conflict' | 'superseded';
export type TerminalSide = 'port' | 'starboard';

export interface Race {
  id: string;
  name: string;
  fleet: string;
  course: string;
  startsAt: string;
  status: RaceStatus;
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
}

/** 计时终端：起航线两侧各一台，各自带本机钟差 */
export interface Terminal {
  id: string;
  name: string;
  side: TerminalSide;
  /** 钟差（秒），校正时加到本机记录时刻上 */
  clockOffset: number;
}

/** 到达记录：某台终端记下的一条到线时刻 */
export interface Arrival {
  id: string;
  raceId: string;
  boat: string;
  sailNo: string;
  terminalId: string;
  /** 本机到线时刻（ISO） */
  recordedAt: string;
  status: ArrivalStatus;
  conflictId?: string;
  resultVersionId?: string;
  createdAt: string;
}

/** 冲突复核组：两版校正后时刻相差太大，留待人工复核 */
export interface ConflictGroup {
  id: string;
  raceId: string;
  boat: string;
  sailNo: string;
  /** 两版到达记录 id */
  arrivalIds: string[];
  status: 'open' | 'resolved';
  chosenArrivalId?: string;
  createdAt: string;
}

/** 成绩版本：每次发布或更正都留一版，已发布版本不可变 */
export interface ResultVersion {
  id: string;
  raceId: string;
  entryId: string;
  version: number;
  elapsedSeconds: number;
  penaltySeconds: number;
  status: ResultStatus;
  /** 本版成绩依据的到达记录 */
  arrivalIds: string[];
  publishedAt?: string;
  note: string;
  createdAt: string;
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
  type: 'race' | 'result' | 'protest' | 'system';
  message: string;
}
