import { useEffect, useMemo, useState } from 'react';
import { App as AntApp, Badge, Button, Card, Col, Descriptions, Empty, Form, Input, InputNumber, Layout, List, Menu, Row, Select, Space, Statistic, Table, Tag, Timeline, Typography, message } from 'antd';
import { ClockCircleOutlined, FlagOutlined, PlusOutlined, SafetyCertificateOutlined, MergeCellsOutlined } from '@ant-design/icons';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { useDispatch, useSelector } from 'react-redux';
import { BrowserRouter, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { z } from 'zod';
import { addProtest, reconcileArrivals, resolveReview, saveResult, setRaceStatus, submitArrival, transitionProtest, updateClockOffset, type AppDispatch, type RootState } from './store';
import { useGetOfficialsQuery } from './api';
import { MERGE_TOLERANCE_MS, correctedAtMs, formatClock, formatOffset, rankEntries } from './reconcile';
import type { Arrival, RaceEntry, TerminalId } from './types';

const { Header, Content, Sider } = Layout;

const resultSchema = z.object({
  id: z.string().min(1),
  elapsedSeconds: z.number().positive(),
  penaltySeconds: z.number().min(0),
  note: z.string().max(120)
});
const protestSchema = z.object({
  entryId: z.string().min(1),
  reason: z.string().min(4),
  rule: z.string().min(2)
});
const arrivalSchema = z.object({
  terminalId: z.enum(['A', 'B']),
  sailNo: z.string().min(3),
  rawLocal: z.string().min(10)
});

function countdown(target: string, now: number) {
  const diff = Math.floor((new Date(target).getTime() - now) / 1000);
  const abs = Math.abs(diff);
  const text = `${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
  return diff < 0 ? `已起航 +${text}` : text;
}

const arrivalStatusTag: Record<Arrival['status'], { color: string; text: string }> = {
  pending: { color: 'orange', text: '未入账' },
  booked: { color: 'green', text: '已并入' },
  review: { color: 'red', text: '待复核' }
};

function TimingPage() {
  const dispatch = useDispatch<AppDispatch>();
  const terminals = useSelector((state: RootState) => state.regatta.terminals);
  const arrivals = useSelector((state: RootState) => state.regatta.arrivals);
  const entries = useSelector((state: RootState) => state.regatta.entries);
  const [api, contextHolder] = message.useMessage();

  const pendingCount = arrivals.filter((arrival) => arrival.status === 'pending').length;
  const reviewEntries = entries.filter((entry) => entry.awaitingReview);
  const [drafts, setDrafts] = useState<Record<TerminalId, number>>({ A: terminals[0]?.clockOffset ?? 0, B: terminals[1]?.clockOffset ?? 0 });
  useEffect(() => { setDrafts({ A: terminals[0]?.clockOffset ?? 0, B: terminals[1]?.clockOffset ?? 0 }); }, [terminals]);

  const { register, handleSubmit, reset, formState: { errors } } = useForm<z.infer<typeof arrivalSchema>>({
    resolver: zodResolver(arrivalSchema),
    defaultValues: { terminalId: 'A', sailNo: '', rawLocal: new Date(Date.now() - 14 * 60 * 1000).toISOString().slice(0, 16) }
  });
  const submit = (values: z.infer<typeof arrivalSchema>) => {
    dispatch(submitArrival({ terminalId: values.terminalId, sailNo: values.sailNo, rawAt: new Date(values.rawLocal).getTime() }));
    api.success(`终端 ${values.terminalId} 到线记录已挂账，等待合表`);
    reset({ terminalId: values.terminalId, sailNo: values.sailNo, rawLocal: values.rawLocal });
  };

  return (
    <>
      {contextHolder}
      <Space direction="vertical" size="large" style={{ width: '100%' }}>
        <Row gutter={[18, 18]}>
          {terminals.map((terminal) => (
            <Col xs={24} md={12} key={terminal.id}>
              <Card className="hero-card" title={<Space><Tag color={terminal.id === 'A' ? 'blue' : 'cyan'}>{terminal.id} 机</Tag>{terminal.name}</Space>}
                extra={<Badge status="processing" text={`钟差 ${formatOffset(terminal.clockOffset)}`} />}>
                <Descriptions column={1} size="small">
                  <Descriptions.Item label="本机读数快（+）/慢（−）标准时">
                    <Space>
                      <InputNumber size="small" step={0.1} value={drafts[terminal.id]} onChange={(value) => value !== null && setDrafts((prev) => ({ ...prev, [terminal.id]: value }))} addonAfter="秒" />
                      <Button size="small" disabled={drafts[terminal.id] === terminal.clockOffset} onClick={() => dispatch(updateClockOffset({ terminalId: terminal.id, clockOffset: drafts[terminal.id] }))}>改钟差并重算</Button>
                    </Space>
                  </Descriptions.Item>
                  <Descriptions.Item label="校正公式">标准到线时刻 = 本机读数 − {terminal.clockOffset}s</Descriptions.Item>
                </Descriptions>
              </Card>
            </Col>
          ))}
        </Row>

        <Row gutter={[18, 18]}>
          <Col xs={24} lg={9}>
            <Card title="终端提交到线记录">
              <Form layout="vertical" onFinish={handleSubmit(submit)}>
                <Form.Item label="计时终端" validateStatus={errors.terminalId ? 'error' : undefined}>
                  <select className="native-select" {...register('terminalId')}>
                    {terminals.map((terminal) => <option key={terminal.id} value={terminal.id}>{terminal.id} · {terminal.name}</option>)}
                  </select>
                </Form.Item>
                <Form.Item label="帆号" validateStatus={errors.sailNo ? 'error' : undefined} help={errors.sailNo?.message}>
                  <Input {...register('sailNo')} placeholder="如 CHN 218" />
                </Form.Item>
                <Form.Item label="本机读到的到线时刻" validateStatus={errors.rawLocal ? 'error' : undefined}>
                  <Input type="datetime-local" step={1} {...register('rawLocal')} />
                </Form.Item>
                <Space>
                  <Button type="primary" htmlType="submit" icon={<PlusOutlined />}>挂账待合表</Button>
                  <Button type="primary" ghost icon={<MergeCellsOutlined />} disabled={pendingCount === 0} onClick={() => dispatch(reconcileArrivals())}>
                    继续合表（{pendingCount} 条未入账）
                  </Button>
                </Space>
                <p style={{ marginTop: 12, color: '#64748b', fontSize: 12 }}>
                  同船两机校正后相差不超过 {MERGE_TOLERANCE_MS / 1000} 秒取最早一条；超过则两版并存进复核。合表中断后再点此按钮只补未入账部分。
                </p>
              </Form>
            </Card>
          </Col>
          <Col xs={24} lg={15}>
            <Card title={<Space>到线记录对账<Tag>{arrivals.length} 条</Tag></Space>}>
              <Table rowKey="id" size="small" pagination={{ pageSize: 7 }} dataSource={arrivals} columns={[
                { title: '终端', dataIndex: 'terminalId', width: 64, render: (id: TerminalId) => <Tag color={id === 'A' ? 'blue' : 'cyan'}>{id}</Tag> },
                { title: '帆号', dataIndex: 'sailNo', width: 100 },
                { title: '本机读数', render: (_v, r) => formatClock(r.rawAt) },
                { title: '提交时钟差', dataIndex: 'offsetSnapshot', width: 100, render: (v: number) => formatOffset(v) },
                { title: '校正后到线', render: (_v, r) => formatClock(correctedAtMs(r, terminals)) },
                { title: '状态', width: 90, render: (_v, r) => <Tag color={arrivalStatusTag[r.status].color}>{arrivalStatusTag[r.status].text}</Tag> }
              ]} />
            </Card>
          </Col>
        </Row>

        <Card title={<Space>两版复核队列<Tag color={reviewEntries.length ? 'red' : 'default'}>{reviewEntries.length} 艘</Tag></Space>}>
          {reviewEntries.length === 0 ? <Empty description="暂无待复核记录" /> : (
            <List dataSource={reviewEntries} renderItem={(entry) => {
              const linked = entry.arrivalIds
                .map((id) => arrivals.find((arrival) => arrival.id === id))
                .filter((arrival): arrival is Arrival => Boolean(arrival));
              return (
                <List.Item actions={[
                  <Button key="a" type="primary" size="small" onClick={() => dispatch(resolveReview({ entryId: entry.id, chosenTerminal: 'A' }))}>采信 A 机</Button>,
                  <Button key="b" type="primary" size="small" onClick={() => dispatch(resolveReview({ entryId: entry.id, chosenTerminal: 'B' }))}>采信 B 机</Button>
                ]}>
                  <List.Item.Meta
                    title={`${entry.boat} · ${entry.sailNo}`}
                    description={
                      <Space direction="vertical" size={2}>
                        {linked.map((arrival) => (
                          <span key={arrival.id}><Tag color={arrival.terminalId === 'A' ? 'blue' : 'cyan'}>{arrival.terminalId} 机</Tag>校正后 {formatClock(correctedAtMs(arrival, terminals))}</span>
                        ))}
                        <small style={{ color: '#dc2626' }}>时差 {Math.round(Math.abs(correctedAtMs(linked[0], terminals) - correctedAtMs(linked[1], terminals)) / 1000)} 秒，超过 {MERGE_TOLERANCE_MS / 1000} 秒阈值，暂不进入名次</small>
                      </Space>
                    }
                  />
                </List.Item>
              );
            }} />
          )}
        </Card>
      </Space>
    </>
  );
}

function ControlPage() {
  const { t } = useTranslation();
  const dispatch = useDispatch<AppDispatch>();
  const race = useSelector((state: RootState) => state.regatta.races[0]);
  const entries = useSelector((state: RootState) => state.regatta.entries);
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(timer); }, []);
  const ranked = useMemo(() => rankEntries(entries), [entries]);

  return (
    <Space direction="vertical" size="large" style={{ width: '100%' }}>
      <Row gutter={[18, 18]}>
        <Col xs={24} lg={10}>
          <Card className="hero-card">
            <Badge status={race.status === 'running' ? 'processing' : 'success'} text={`比赛状态：${race.status}`} />
            <Statistic title="距离起航" value={countdown(race.startsAt, now)} prefix={<ClockCircleOutlined />} />
            <Descriptions column={1} style={{ marginTop: 18 }}>
              <Descriptions.Item label="组别">{race.fleet}</Descriptions.Item>
              <Descriptions.Item label="航线">{race.course}</Descriptions.Item>
            </Descriptions>
            <Space wrap>
              <Button type="primary" icon={<FlagOutlined />} onClick={() => dispatch(setRaceStatus({ id: race.id, status: 'running' }))}>开始比赛</Button>
              <Button onClick={() => dispatch(setRaceStatus({ id: race.id, status: 'finished' }))}>结束比赛</Button>
              <Button onClick={() => dispatch(setRaceStatus({ id: race.id, status: 'scheduled' }))}>重置排队</Button>
            </Space>
          </Card>
        </Col>
        <Col xs={24} lg={14}>
          <Card title={t('control')} extra={<Tag color="blue">{ranked.length} 艘参赛船</Tag>}>
            <Table rowKey="entry.id" pagination={false} dataSource={ranked} columns={[
              { title: '排名', render: (_v, r) => r.rank ?? <Tag color="red">待复核</Tag>, width: 80 },
              { title: '船名', render: (_v, r) => r.entry.boat },
              { title: '帆号', render: (_v, r) => r.entry.sailNo },
              { title: '船长', render: (_v, r) => r.entry.skipper },
              { title: '当前净用时', render: (_v, r) => `${r.net}s` },
              { title: '版本', render: (_v, r) => `v${r.entry.version}`, width: 64 },
              { title: '状态', render: (_v, r) => <Tag color={r.entry.resultStatus === 'official' ? 'green' : r.entry.resultStatus === 'corrected' ? 'orange' : 'default'}>{r.entry.resultStatus}</Tag> }
            ]} />
          </Card>
        </Col>
      </Row>
    </Space>
  );
}

function ResultsPage() {
  const dispatch = useDispatch<AppDispatch>();
  const entries = useSelector((state: RootState) => state.regatta.entries);
  const publications = useSelector((state: RootState) => state.regatta.publications);
  const [api, contextHolder] = message.useMessage();
  const { register, handleSubmit, reset, formState: { errors } } = useForm<z.infer<typeof resultSchema>>({
    resolver: zodResolver(resultSchema),
    defaultValues: { id: entries[0]?.id, elapsedSeconds: 3200, penaltySeconds: 0, note: '' }
  });
  const submit = (values: z.infer<typeof resultSchema>) => {
    dispatch(saveResult({ ...values, official: false }));
    api.success('成绩已更正；若原成绩已发布，旧版作废并存为更正版');
    reset();
  };
  const ranked = rankEntries(entries);
  return (
    <>
      {contextHolder}
      <Row gutter={[18, 18]}>
        <Col xs={24} lg={9}>
          <Card title="成绩更正">
            <Form layout="vertical" onFinish={handleSubmit(submit)}>
              <Form.Item label="参赛船" validateStatus={errors.id ? 'error' : undefined} help={errors.id?.message}>
                <select {...register('id')} className="native-select">{entries.map((entry) => <option key={entry.id} value={entry.id}>{entry.boat} / {entry.sailNo}</option>)}</select>
              </Form.Item>
              <Form.Item label="净用时（秒）"><Input type="number" {...register('elapsedSeconds', { valueAsNumber: true })} /></Form.Item>
              <Form.Item label="处罚秒数"><Input type="number" {...register('penaltySeconds', { valueAsNumber: true })} /></Form.Item>
              <Form.Item label="更正原因"><Input.TextArea rows={3} {...register('note')} /></Form.Item>
              <Button htmlType="submit" type="primary">保存更正</Button>
            </Form>
          </Card>
        </Col>
        <Col xs={24} lg={15}>
          <Card title="临时与正式成绩（名次随对账/钟差即时重算）" style={{ marginBottom: 18 }}>
            <Table rowKey="entry.id" size="small" pagination={false} dataSource={ranked} columns={[
              { title: '名次', width: 70, render: (_v, r) => r.rank ?? <Tag color="red">待复核</Tag> },
              { title: '船名', render: (_v, r) => r.entry.boat },
              { title: '净用时', render: (_v, r) => `${r.net}s` },
              { title: '状态', render: (_v, r) => <Tag color={r.entry.resultStatus === 'official' ? 'green' : r.entry.resultStatus === 'corrected' ? 'orange' : 'default'}>{r.entry.resultStatus}</Tag> },
              { title: '说明', render: (_v, r) => r.entry.recomputeReason || r.entry.note || '—' },
              { title: '操作', render: (_v, r) => (
                <Button size="small" type="link" onClick={() => dispatch(saveResult({ id: r.entry.id, elapsedSeconds: r.entry.elapsedSeconds, penaltySeconds: r.entry.penaltySeconds, note: r.entry.note, official: true }))}>
                  {publications.some((pub) => pub.entryId === r.entry.id && !pub.superseded) ? '发布/重发正式' : '发布正式'}
                </Button>
              ) }
            ]} />
          </Card>
          <Card title="发布存档（更正版与已作废版本）">
            <List dataSource={publications} renderItem={(pub) => (
              <List.Item>
                <List.Item.Meta
                  title={<Space>{pub.boat} · {pub.netSeconds}s · 第 {pub.rank ?? '—'} 名 <Tag>v{pub.version}</Tag>{pub.superseded ? <Tag color="red">已作废</Tag> : <Tag color="green">现行</Tag>}</Space>}
                  description={`${new Date(pub.publishedAt).toLocaleString('zh-CN')}${pub.superseded ? ` · 作废原因：${pub.supersedeReason}` : ''}${pub.correctionOfId ? ' · 由已作废版本另存' : ''}`}
                />
              </List.Item>
            )} />
          </Card>
        </Col>
      </Row>
    </>
  );
}

function ProtestsPage() {
  const dispatch = useDispatch<AppDispatch>();
  const protests = useSelector((state: RootState) => state.regatta.protests);
  const timeline = useSelector((state: RootState) => state.regatta.timeline);
  const entries = useSelector((state: RootState) => state.regatta.entries);
  const { register, handleSubmit, reset, formState: { errors } } = useForm<z.infer<typeof protestSchema>>({ resolver: zodResolver(protestSchema), defaultValues: { entryId: entries[0]?.id, reason: '', rule: 'RRS 14' } });
  const submit = (values: z.infer<typeof protestSchema>) => {
    dispatch(addProtest({ raceId: 'race-1', ...values }));
    reset({ entryId: entries[0]?.id, reason: '', rule: 'RRS 14' });
  };
  return (
    <Row gutter={[18, 18]}>
      <Col xs={24} lg={9}>
        <Card title="提交抗议">
          <Form layout="vertical" onFinish={handleSubmit(submit)}>
            <Form.Item label="参赛船" validateStatus={errors.entryId ? 'error' : undefined}>
              <select className="native-select" {...register('entryId')}>{entries.map((entry) => <option key={entry.id} value={entry.id}>{entry.boat}</option>)}</select>
            </Form.Item>
            <Form.Item label="适用规则" validateStatus={errors.rule ? 'error' : undefined} help={errors.rule?.message}><Input {...register('rule')} /></Form.Item>
            <Form.Item label="事件描述" validateStatus={errors.reason ? 'error' : undefined} help={errors.reason?.message}><Input.TextArea rows={4} {...register('reason')} /></Form.Item>
            <Button type="primary" htmlType="submit" icon={<PlusOutlined />}>登记抗议</Button>
          </Form>
        </Card>
      </Col>
      <Col xs={24} lg={9}>
        <Card title="冲突复核队列">
          {protests.length === 0 ? <Empty /> : <List dataSource={protests} renderItem={(item) => (
            <List.Item>
              <List.Item.Meta
                title={<Space><Tag color={item.status === 'reviewing' ? 'processing' : 'default'}>{item.status}</Tag>{item.rule}</Space>}
                description={<><div>{item.reason}</div><small>{entries.find((entry) => entry.id === item.entryId)?.boat}</small></>}
              />
              <Space direction="vertical">
                <Button size="small" onClick={() => dispatch(transitionProtest({ id: item.id, status: 'reviewing' }))}>进入复核</Button>
                <Button size="small" type="primary" onClick={() => dispatch(transitionProtest({ id: item.id, status: 'resolved', decision: '接受抗议并处以30秒处罚', penaltySeconds: 30 }))}>接受并处罚</Button>
                <Button size="small" danger onClick={() => dispatch(transitionProtest({ id: item.id, status: 'rejected', decision: '证据不足，维持原成绩' }))}>驳回</Button>
              </Space>
            </List.Item>
          )} />}
        </Card>
      </Col>
      <Col xs={24} lg={6}>
        <Card title="事件时间线"><Timeline items={timeline.map((event) => ({ color: event.type === 'protest' ? 'orange' : event.type === 'timing' ? 'geekblue' : event.type === 'result' ? 'green' : 'blue', children: <><b>{event.type}</b><div>{event.message}</div><small>{new Date(event.time).toLocaleTimeString()}</small></> }))} /></Card>
      </Col>
    </Row>
  );
}

function Shell() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const { data = [] } = useGetOfficialsQuery();
  return (
    <AntApp>
      <Layout className="shell">
      <Header className="header">
        <Space><SafetyCertificateOutlined style={{ fontSize: 24 }} /><Typography.Title level={4} style={{ margin: 0, color: 'white' }}>{t('title')}</Typography.Title></Space>
        <Space><Tag>{data.length} 名值班人员</Tag><Button ghost onClick={() => void i18n.changeLanguage(i18n.language.startsWith('zh') ? 'en' : 'zh')}>{t('language')}</Button></Space>
      </Header>
      <Layout>
        <Sider width={210} breakpoint="lg" collapsedWidth="0" theme="light">
          <Menu mode="inline" selectedKeys={[location.pathname]} onClick={({ key }) => navigate(key)} items={[
            { key: '/timing', label: t('timing'), icon: <MergeCellsOutlined /> },
            { key: '/', label: t('control'), icon: <FlagOutlined /> },
            { key: '/results', label: t('results'), icon: <ClockCircleOutlined /> },
            { key: '/protests', label: t('protests'), icon: <SafetyCertificateOutlined /> }
          ]} />
        </Sider>
        <Content className="content"><Routes>
          <Route path="/" element={<ControlPage />} />
          <Route path="/timing" element={<TimingPage />} />
          <Route path="/results" element={<ResultsPage />} />
          <Route path="/protests" element={<ProtestsPage />} />
          <Route path="*" element={<Navigate to="/timing" replace />} />
        </Routes></Content>
      </Layout>
      </Layout>
    </AntApp>
  );
}

export default function App() { return <BrowserRouter><Shell /></BrowserRouter>; }
