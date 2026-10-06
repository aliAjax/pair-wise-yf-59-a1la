import { useEffect, useMemo, useState } from 'react';
import { Badge, Button, Card, Col, Empty, Form, Input, InputNumber, List, Row, Select, Space, Statistic, Table, Tag, Timeline, Typography, message } from 'antd';
import { PlayCircleOutlined, ThunderboltOutlined } from '@ant-design/icons';
import { useDispatch, useSelector } from 'react-redux';
import { addArrival, publishResult, resolveConflict, runReconciliation, updateTerminalOffset, type AppDispatch, type RootState } from './store';
import { CONFLICT_THRESHOLD_SECONDS, elapsedFromArrival, formatClockOffset, getCorrectedAt } from './timing';
import type { Arrival, RaceEntry, ResultVersion, Terminal } from './types';

const { Title, Text, Paragraph } = Typography;

function toLocalInput(iso: string): string {
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

function nowLocalInput(): string {
  return toLocalInput(new Date().toISOString());
}

export default function TimingPage() {
  const dispatch = useDispatch<AppDispatch>();
  const terminals = useSelector((state: RootState) => state.regatta.terminals);
  const arrivals = useSelector((state: RootState) => state.regatta.arrivals);
  const conflicts = useSelector((state: RootState) => state.regatta.conflicts);
  const resultVersions = useSelector((state: RootState) => state.regatta.resultVersions);
  const entries = useSelector((state: RootState) => state.regatta.entries);
  const race = useSelector((state: RootState) => state.regatta.races[0]);
  const [api, contextHolder] = message.useMessage();

  const stats = useMemo(() => ({
    pending: arrivals.filter((item) => item.status === 'pending').length,
    merged: arrivals.filter((item) => item.status === 'merged').length,
    conflict: arrivals.filter((item) => item.status === 'conflict').length
  }), [arrivals]);

  const openConflicts = conflicts.filter((item) => item.status === 'open');

  const versionsByEntry = useMemo(() => {
    const map = new Map<string, ResultVersion[]>();
    for (const version of resultVersions) {
      const list = map.get(version.entryId) ?? [];
      list.push(version);
      map.set(version.entryId, list);
    }
    for (const list of map.values()) list.sort((a, b) => b.version - a.version);
    return map;
  }, [resultVersions]);

  const terminalName = (id: string) => terminals.find((item) => item.id === id)?.name ?? id;

  return (
    <Space direction="vertical" size="large" style={{ width: '100%' }}>
      {contextHolder}
      <Row gutter={[18, 18]}>
        {terminals.map((terminal) => (
          <Col xs={24} md={12} key={terminal.id}>
            <TerminalCard
              terminal={terminal}
              count={arrivals.filter((item) => item.terminalId === terminal.id).length}
              onOffset={(offset) => dispatch(updateTerminalOffset({ id: terminal.id, clockOffset: offset }))}
            />
          </Col>
        ))}
      </Row>

      <Card title="提交到达记录">
        <ArrivalForm
          terminals={terminals}
          onSubmit={(values) => {
            dispatch(addArrival(values));
            api.success('到达记录已提交，状态：待合表');
          }}
        />
      </Card>

      <Card title="合表对账">
        <Space wrap size="large">
          <Statistic title="待入账" value={stats.pending} valueStyle={{ color: stats.pending ? '#cf1322' : undefined }} />
          <Statistic title="已入账" value={stats.merged} valueStyle={{ color: '#3f8600' }} />
          <Statistic title="待复核" value={stats.conflict} valueStyle={{ color: '#d46b08' }} />
          <Button
            type="primary"
            size="large"
            icon={<PlayCircleOutlined />}
            disabled={stats.pending === 0}
            onClick={() => {
              dispatch(runReconciliation());
              api.success('合表完成，未入账部分已补录');
            }}
          >
            {stats.merged === 0 && stats.conflict === 0 ? '开始合表' : '继续合表'}
          </Button>
        </Space>
        <Paragraph type="secondary" style={{ marginTop: 12, marginBottom: 0 }}>
          合表按条入账：同一艘船两台终端都提交时，校正后相差 ≤ {CONFLICT_THRESHOLD_SECONDS}s 视为一致，取最早一条入账；相差太大则两版都留待复核。合表中断后再次点击「继续合表」，只补录尚未入账的记录，已入账的不会重复处理。
        </Paragraph>
      </Card>

      {openConflicts.length > 0 && (
        <Card title="冲突复核队列" extra={<Tag color="orange">{openConflicts.length} 组待复核</Tag>}>
          <List
            dataSource={openConflicts}
            renderItem={(conflict) => {
              const versions = conflict.arrivalIds
                .map((id) => arrivals.find((item) => item.id === id))
                .filter((item): item is Arrival => Boolean(item));
              return (
                <List.Item
                  actions={[
                    <Button
                      key="a"
                      onClick={() => {
                        dispatch(resolveConflict({ conflictId: conflict.id, chosenArrivalId: versions[0].id }));
                        api.success(`已采用 ${terminalName(versions[0].terminalId)} 版本`);
                      }}
                    >
                      采用{terminalName(versions[0].terminalId)}
                    </Button>,
                    <Button
                      key="b"
                      type="primary"
                      onClick={() => {
                        dispatch(resolveConflict({ conflictId: conflict.id, chosenArrivalId: versions[1].id }));
                        api.success(`已采用 ${terminalName(versions[1].terminalId)} 版本`);
                      }}
                    >
                      采用{terminalName(versions[1].terminalId)}
                    </Button>
                  ]}
                >
                  <List.Item.Meta
                    title={`${conflict.boat} · ${conflict.sailNo}`}
                    description={
                      <Space direction="vertical" size={4}>
                        {versions.map((arrival) => (
                          <Text key={arrival.id}>
                            {terminalName(arrival.terminalId)}：校正到线 {new Date(getCorrectedAt(arrival, terminals)).toLocaleTimeString()}（{elapsedFromArrival(arrival, terminals, race)}s）
                          </Text>
                        ))}
                      </Space>
                    }
                  />
                </List.Item>
              );
            }}
          />
        </Card>
      )}

      <Card title="合表成绩与发布">
        <Table
          rowKey="id"
          pagination={false}
          dataSource={entries}
          expandable={{
            expandedRowRender: (entry) => <VersionHistory versions={versionsByEntry.get(entry.id) ?? []} />,
            rowExpandable: (entry) => (versionsByEntry.get(entry.id)?.length ?? 0) > 0
          }}
          columns={[
            { title: '船名', dataIndex: 'boat' },
            { title: '帆号', dataIndex: 'sailNo' },
            { title: '净用时', render: (_value, row: RaceEntry) => `${row.elapsedSeconds}s` },
            { title: '处罚', render: (_value, row: RaceEntry) => `${row.penaltySeconds}s` },
            { title: '总用时', render: (_value, row: RaceEntry) => <b>{row.elapsedSeconds + row.penaltySeconds}s</b> },
            {
              title: '版本',
              render: (_value, row: RaceEntry) => {
                const latest = versionsByEntry.get(row.id)?.[0];
                return latest ? (
                  <Tag color={latest.status === 'official' ? 'green' : latest.status === 'corrected' ? 'orange' : 'default'}>
                    v{latest.version} · {latest.status}
                  </Tag>
                ) : (
                  <Tag>无成绩</Tag>
                );
              }
            },
            {
              title: '操作',
              render: (_value, row: RaceEntry) => {
                const latest = versionsByEntry.get(row.id)?.[0];
                const canPublish = Boolean(latest && latest.status !== 'official');
                return (
                  <Button
                    size="small"
                    type="link"
                    disabled={!canPublish}
                    onClick={() => {
                      dispatch(publishResult({ entryId: row.id }));
                      api.success(`${row.boat} 成绩已发布为正式成绩`);
                    }}
                  >
                    发布正式
                  </Button>
                );
              }
            }
          ]}
        />
      </Card>
    </Space>
  );
}

function TerminalCard({ terminal, count, onOffset }: { terminal: Terminal; count: number; onOffset: (offset: number) => void }) {
  const [offset, setOffset] = useState(terminal.clockOffset);
  useEffect(() => {
    setOffset(terminal.clockOffset);
  }, [terminal.clockOffset]);
  return (
    <Card>
      <Space direction="vertical" style={{ width: '100%' }}>
        <Space>
          <Badge status="processing" />
          <Title level={5} style={{ margin: 0 }}>{terminal.name}</Title>
          <Tag color={terminal.side === 'port' ? 'blue' : 'cyan'}>{terminal.side === 'port' ? '左舷' : '右舷'}</Tag>
        </Space>
        <Text type="secondary">已提交 {count} 条到达记录，当前钟差 {formatClockOffset(terminal.clockOffset)}</Text>
        <Space>
          <Text>钟差</Text>
          <InputNumber min={-600} max={600} value={offset} onChange={(value) => setOffset(value ?? 0)} addonAfter="秒" style={{ width: 140 }} />
          <Button onClick={() => onOffset(offset)}>应用钟差</Button>
        </Space>
        <Text type="secondary" style={{ fontSize: 12 }}>
          校正到线 = 本机时刻 + 钟差。调整后相关名次作废重算，已发布成绩另存更正版。
        </Text>
      </Space>
    </Card>
  );
}

function ArrivalForm({ terminals, onSubmit }: { terminals: Terminal[]; onSubmit: (values: { boat: string; sailNo: string; terminalId: string; recordedAt: string }) => void }) {
  const [terminalId, setTerminalId] = useState(terminals[0]?.id);
  const [boat, setBoat] = useState('');
  const [sailNo, setSailNo] = useState('');
  const [recordedAt, setRecordedAt] = useState(nowLocalInput());
  const submit = () => {
    if (!boat.trim() || !sailNo.trim() || !terminalId) return;
    onSubmit({ boat: boat.trim(), sailNo: sailNo.trim(), terminalId, recordedAt: new Date(recordedAt).toISOString() });
    setBoat('');
    setSailNo('');
    setRecordedAt(nowLocalInput());
  };
  return (
    <Space wrap>
      <Select
        value={terminalId}
        onChange={setTerminalId}
        style={{ width: 180 }}
        options={terminals.map((terminal) => ({ value: terminal.id, label: terminal.name }))}
      />
      <Input placeholder="船号（船名）" value={boat} onChange={(event) => setBoat(event.target.value)} style={{ width: 160 }} />
      <Input placeholder="帆号" value={sailNo} onChange={(event) => setSailNo(event.target.value)} style={{ width: 140 }} />
      <Input type="datetime-local" value={recordedAt} onChange={(event) => setRecordedAt(event.target.value)} style={{ width: 220 }} />
      <Button type="primary" icon={<ThunderboltOutlined />} onClick={submit}>提交到达</Button>
    </Space>
  );
}

export function VersionHistory({ versions }: { versions: ResultVersion[] }) {
  if (versions.length === 0) return <Empty description="暂无成绩版本" />;
  return (
    <Timeline
      items={versions.map((version) => ({
        color: version.status === 'official' ? 'green' : version.status === 'corrected' ? 'orange' : 'gray',
        children: (
          <Space direction="vertical" size={2}>
            <Text>
              v{version.version} · {version.status} · 净用时 {version.elapsedSeconds}s + 处罚 {version.penaltySeconds}s = <b>{version.elapsedSeconds + version.penaltySeconds}s</b>
            </Text>
            <Text type="secondary" style={{ fontSize: 12 }}>
              {version.note}
              {version.publishedAt ? ` · 发布于 ${new Date(version.publishedAt).toLocaleString()}` : ''}
            </Text>
          </Space>
        )
      }))}
    />
  );
}
