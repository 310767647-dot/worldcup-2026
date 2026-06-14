#!/usr/bin/env node
/**
 * 2026世界杯赛事数据自动更新脚本
 * 
 * 数据源：openfootball/worldcup.json（社区维护，有实时比分）
 * 策略：拉取openfootball → 转为中文格式 → 合并本地精选数据 → 写回data.json
 * 
 * 由 GitHub Action 每30分钟自动执行，也可手动运行：
 *   node scripts/auto-update-data.js
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');
const DATA_FILE = path.join(ROOT_DIR, 'data.json');

const OPENFOOTBALL_URL = 'https://raw.githubusercontent.com/openfootball/worldcup.json/master/2026/worldcup.json';

// ─── HTTP 请求 ────────────────────────────
function httpGet(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: { 'User-Agent': 'worldcup-2026-auto-update/1.0', 'Accept': 'application/json' },
      timeout: 20000
    }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        return httpGet(res.headers.location).then(resolve).catch(reject);
      }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error(`JSON解析失败: ${e.message}`)); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('请求超时')); });
  });
}

// ─── 英文转中文队名 ───────────────────────
const ZH_MAP = {
  'Mexico': '墨西哥', 'South Africa': '南非',
  'South Korea': '韩国', 'Czech Republic': '捷克',
  'Canada': '加拿大', 'Bosnia & Herzegovina': '波黑', 'Bosnia and Herzegovina': '波黑',
  'Qatar': '卡塔尔', 'Switzerland': '瑞士',
  'Brazil': '巴西', 'Morocco': '摩洛哥',
  'Haiti': '海地', 'Scotland': '苏格兰',
  'USA': '美国', 'United States': '美国',
  'Paraguay': '巴拉圭',
  'Australia': '澳大利亚', 'Turkey': '土耳其',
  'Germany': '德国', 'Curaçao': '库拉索', 'Curacao': '库拉索',
  'Ivory Coast': '科特迪瓦', "Côte d'Ivoire": '科特迪瓦', 'Ecuador': '厄瓜多尔',
  'Netherlands': '荷兰', 'Japan': '日本',
  'Sweden': '瑞典', 'Tunisia': '突尼斯',
  'Belgium': '比利时', 'Egypt': '埃及',
  'Iran': '伊朗', 'New Zealand': '新西兰',
  'Spain': '西班牙', 'Cape Verde': '佛得角',
  'Saudi Arabia': '沙特阿拉伯', 'Uruguay': '乌拉圭',
  'France': '法国', 'Senegal': '塞内加尔',
  'Iraq': '伊拉克', 'Norway': '挪威',
  'Argentina': '阿根廷', 'Algeria': '阿尔及利亚',
  'Austria': '奥地利', 'Jordan': '约旦',
  'Portugal': '葡萄牙', 'DR Congo': '刚果(金)',
  'Colombia': '哥伦比亚', 'Uzbekistan': '乌兹别克斯坦',
  'Italy': '意大利', 'Ghana': '加纳',
  'England': '英格兰', 'Croatia': '克罗地亚',
  'Denmark': '丹麦', 'Chile': '智利',
  'Poland': '波兰', 'Panama': '巴拿马',
};

const GROUP_MAP = {
  'Group A': 'A组', 'Group B': 'B组', 'Group C': 'C组', 'Group D': 'D组',
  'Group E': 'E组', 'Group F': 'F组', 'Group G': 'G组', 'Group H': 'H组',
  'Group I': 'I组', 'Group J': 'J组', 'Group K': 'K组', 'Group L': 'L组',
};

const ROUND_MAP = {
  'Matchday 1': '小组赛第1轮', 'Matchday 2': '小组赛第2轮', 'Matchday 3': '小组赛第3轮',
  'Matchday 4': '小组赛第1轮', 'Matchday 5': '小组赛第2轮', 'Matchday 6': '小组赛第3轮',
  'Matchday 7': '小组赛第1轮', 'Matchday 8': '小组赛第2轮', 'Matchday 9': '小组赛第3轮',
  'Matchday 10': '小组赛第2轮', 'Matchday 11': '小组赛第3轮', 'Matchday 12': '小组赛第2轮',
  'Matchday 13': '小组赛第3轮', 'Matchday 14': '小组赛第3轮',
  'Matchday 15': '小组赛第3轮', 'Matchday 16': '小组赛第3轮', 'Matchday 17': '小组赛第3轮',
  'Round of 32': '32强赛', 'Round of 16': '16强赛',
  'Quarter-final': '1/4决赛', 'Semi-final': '半决赛',
  'Match for third place': '三四名决赛', 'Final': '决赛'
};

// ─── 核心转换 ────────────────────────────
function convertOpenFootball(raw) {
  const now = new Date();
  const todayStr = now.toISOString().slice(0, 10);
  const tomorrowStr = new Date(now.getTime() + 86400000).toISOString().slice(0, 10);

  // 提取所有比赛（兼容两种格式）
  let allMatches = [];
  if (raw.matches && Array.isArray(raw.matches)) {
    // 直接 matches 数组格式
    allMatches = raw.matches;
  } else if (raw.rounds && Array.isArray(raw.rounds)) {
    // rounds 包含 matches 格式
    raw.rounds.forEach(round => {
      (round.matches || []).forEach(m => {
        m._roundName = round.name;
        allMatches.push(m);
      });
    });
  }

  let completedCount = 0;

  const matches = allMatches.map((m, i) => {
    const hasScore = m.score && m.score.ft;
    const isFinished = !!hasScore;
    if (isFinished) completedCount++;

    const homeScore = hasScore ? (m.score.ft[0] || 0) : 0;
    const awayScore = hasScore ? (m.score.ft[1] || 0) : 0;
    const homeTeam = m.team1 || '?';
    const awayTeam = m.team2 || '?';

    // 提取进球者
    const homeScorers = [];
    const awayScorers = [];
    if (m.goals1) {
      m.goals1.forEach(g => {
        homeScorers.push({ name: g.name || g.player || '?', minute: String(g.minute || '') });
      });
    }
    if (m.goals2) {
      m.goals2.forEach(g => {
        awayScorers.push({ name: g.name || g.player || '?', minute: String(g.minute || '') });
      });
    }

    // 解析日期时间
    let timeStr, dateStr;
    if (m.date) {
      dateStr = String(m.date).slice(0, 10);
      if (m.time) {
        timeStr = `${dateStr} ${String(m.time).slice(0, 5)}`;
      } else {
        timeStr = m.date;
        if (timeStr.includes('T')) {
          const parts = timeStr.split('T');
          dateStr = parts[0];
          timeStr = `${parts[0]} ${(parts[1] || '').slice(0, 5)}`;
        }
      }
    } else {
      dateStr = '2026-06-11';
      timeStr = dateStr;
    }

    const group = GROUP_MAP[m.group] || (m.group ? m.group + '组' : '');
    const round = ROUND_MAP[m._roundName || m.round] || m._roundName || m.round || '小组赛';

    return {
      id: m.num ? `M${String(m.num).padStart(2, '0')}` : `M${String(i + 1).padStart(2, '0')}`,
      time: timeStr,
      date: dateStr,
      stage: round.includes('小组赛') ? '小组赛' : round,
      group: group,
      home: ZH_MAP[homeTeam] || homeTeam,
      away: ZH_MAP[awayTeam] || awayTeam,
      homeScore: homeScore,
      awayScore: awayScore,
      score: isFinished ? `${homeScore}:${awayScore}` : '-',
      status: isFinished ? '已完赛' : '未开赛',
      statusRaw: isFinished ? 'FULL_TIME' : 'TIMED',
      venue: m.ground || '',
      source: 'OpenFootball 社区数据',
      completed: isFinished,
      live: false,
      homeScorers: homeScorers,
      awayScorers: awayScorers,
      _homeEn: homeTeam,
      _awayEn: awayTeam,
    };
  });

  // 构建积分榜（基于比赛结果）
  const groupStandings = {};
  matches.forEach(m => {
    if (!m.group) return;
    if (!groupStandings[m.group]) groupStandings[m.group] = {};
    const grp = groupStandings[m.group];

    [m.home, m.away].forEach(team => {
      if (!grp[team]) grp[team] = { team, played: 0, won: 0, drawn: 0, lost: 0, goalsFor: 0, goalsAgainst: 0, points: 0 };
    });

    if (m.completed) {
      grp[m.home].played++;
      grp[m.away].played++;
      grp[m.home].goalsFor += m.homeScore;
      grp[m.home].goalsAgainst += m.awayScore;
      grp[m.away].goalsFor += m.awayScore;
      grp[m.away].goalsAgainst += m.homeScore;

      if (m.homeScore > m.awayScore) { grp[m.home].won++; grp[m.home].points += 3; grp[m.away].lost++; }
      else if (m.homeScore < m.awayScore) { grp[m.away].won++; grp[m.away].points += 3; grp[m.home].lost++; }
      else { grp[m.home].drawn++; grp[m.away].drawn++; grp[m.home].points++; grp[m.away].points++; }
    }
  });

  const standings = [];
  Object.keys(groupStandings).forEach(groupName => {
    Object.values(groupStandings[groupName]).forEach(t => {
      t.goalDifference = t.goalsFor - t.goalsAgainst;
      t.group = groupName;
      standings.push(t);
    });
  });
  standings.sort((a, b) => b.points - a.points || b.goalDifference - a.goalDifference);

  // 构建热点
  const todayMatches = matches.filter(m => m.date === todayStr);
  const finishedToday = todayMatches.filter(m => m.completed);
  const tomorrowMatches = matches.filter(m => m.date === tomorrowStr);

  let hotspotTitle, hotspotBody;
  if (finishedToday.length > 0) {
    hotspotTitle = `${todayStr} 完赛焦点：` + finishedToday.slice(0, 4)
      .map(m => `${m.home}${m.homeScore}:${m.awayScore}${m.away}`).join(' | ');
    const bp = [];
    finishedToday.slice(0, 4).forEach(m => bp.push(`${m.home}${m.homeScore}:${m.awayScore}${m.away}`));
    tomorrowMatches.slice(0, 4).forEach(m => bp.push(`${m.home} vs ${m.away}`));
    hotspotBody = bp.join(' | ');
  } else {
    hotspotTitle = `${todayStr} 今日赛事`;
    hotspotBody = todayMatches.map(m => `${m.home} vs ${m.away}`).join(' | ') || '暂无赛事';
  }

  return {
    meta: {
      title: '2026 世界杯实时战报中心',
      reportDate: todayStr,
      resultsDate: todayStr,
      tomorrowDate: tomorrowStr,
      generatedAt: now.toISOString().replace('T', ' ').slice(0, 19),
      timezone: 'Asia/Shanghai',
      source: 'OpenFootball 社区数据 (自动更新)'
    },
    metrics: {
      totalMatches: matches.length,
      completedMatches: completedCount,
      liveMatches: 0,
      standingsRows: standings.length,
      disciplineEvents: 0,
      tomorrowFixtures: tomorrowMatches.length
    },
    hotspot: {
      title: hotspotTitle,
      body: hotspotBody,
      chips: ['完赛比分', '次日赛程', '积分走势', '射手榜']
    },
    matches,
    standings,
    discipline: [],
    playerStats: { scorers: [], assists: [] },
    goalVideos: []
  };
}

// ─── 合并本地精选数据 ─────────────────────
function mergeWithExisting(newData, existingData) {
  if (!existingData || !existingData.matches) return newData;

  // 保留纪律数据
  if (existingData.discipline && existingData.discipline.length > 0) {
    newData.discipline = existingData.discipline;
    newData.metrics.disciplineEvents = existingData.discipline.length;
  }

  // 保留球员统计
  if (existingData.playerStats) {
    newData.playerStats = existingData.playerStats;
  }

  // 保留进球视频
  if (existingData.goalVideos && existingData.goalVideos.length > 0) {
    newData.goalVideos = existingData.goalVideos;
  }

  // 保留热点 chips
  if (existingData.hotspot && existingData.hotspot.chips) {
    newData.hotspot.chips = existingData.hotspot.chips;
  }

  // ★ 智能合并比赛数据：保留手动录入的比赛结果
  // 原则：如果旧数据中某场比赛已完赛，不改写其比分（允许手动覆盖）
  let completedOverridden = 0;
  newData.matches = newData.matches.map(m => {
    const old = (existingData.matches || []).find(om =>
      om.date === m.date && (om.home === m.home || om._homeEn === m._homeEn) && (om.away === m.away || om._awayEn === m._awayEn)
    );
    if (!old) return m;

    // 如果旧数据中比赛已完赛，保留旧数据的比分和状态（手动录入优先）
    if (old.completed && (old.homeScore !== m.homeScore || old.awayScore !== m.awayScore)) {
      m.homeScore = old.homeScore;
      m.awayScore = old.awayScore;
      m.score = old.score;
      m.status = old.status;
      m.statusRaw = old.statusRaw;
      m.completed = old.completed;
      completedOverridden++;
    }
    // 如果旧数据有未完成比赛但新数据已完成 → 使用新数据（自动更新）
    if (!old.completed && m.completed && completedOverridden === 0) {
      // 这个is fine, keep new data (auto-update)
    }

    // 保留旧数据中更详细的进球者
    if (old.homeScorers && old.homeScorers.length > 0 && (!m.homeScorers || m.homeScorers.length === 0)) {
      m.homeScorers = old.homeScorers;
    }
    if (old.awayScorers && old.awayScorers.length > 0 && (!m.awayScorers || m.awayScorers.length === 0)) {
      m.awayScorers = old.awayScorers;
    }

    // 保留旧数据的 _homeEn/_awayEn（用于中文名映射）
    if (old._homeEn) m._homeEn = old._homeEn;
    if (old._awayEn) m._awayEn = old._awayEn;

    return m;
  });

  // 对于旧数据中有但新数据中没有的完赛比赛，追加保留
  const existingCompleted = (existingData.matches || []).filter(m => m.completed);
  const newMatchKeys = new Set(newData.matches.map(m => `${m.date}|${m.home}|${m.away}`));
  existingCompleted.forEach(old => {
    const key = `${old.date}|${old.home}|${old.away}`;
    if (!newMatchKeys.has(key)) {
      newData.matches.push(old);
    }
  });

  // 重新按照时间排序
  newData.matches.sort((a, b) => new Date(a.time) - new Date(b.time));

  // 重新计算指标
  newData.metrics.completedMatches = newData.matches.filter(m => m.completed).length;

  if (completedOverridden > 0) {
    console.log(`  [合并] 保留了 ${completedOverridden} 场手动录入的比赛结果`);
  }
  console.log(`  [合并] 最终完赛: ${newData.metrics.completedMatches} 场`);

  return newData;
}

// ─── 主流程 ──────────────────────────────
async function main() {
  console.log('═══════════════════════════════════════');
  console.log('  2026世界杯数据自动更新');
  console.log('  时间: ' + new Date().toISOString().replace('T', ' ').slice(0, 19));
  console.log('  数据源: openfootball/worldcup.json');
  console.log('═══════════════════════════════════════\n');

  // 读取现有 data.json
  let existingData = null;
  if (fs.existsSync(DATA_FILE)) {
    try {
      existingData = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
      console.log('[现有数据] ' + (existingData.matches?.length || 0) + ' 场比赛, ' +
        (existingData.metrics?.completedMatches || 0) + ' 场已完赛');
    } catch (e) {
      console.log('[现有数据] 读取失败: ' + e.message);
    }
  }

  // 拉取 openfootball 数据
  console.log('\n拉取 openfootball 数据...');
  let rawData;
  try {
    rawData = await httpGet(OPENFOOTBALL_URL);
    console.log('✓ 拉取成功');
  } catch (e) {
    console.error('✗ 拉取失败: ' + e.message);
    if (existingData) {
      console.log('⚠️ 使用现有 data.json（数据可能不是最新）');
      return { changed: false };
    }
    throw e;
  }

  // 转换
  console.log('\n转换数据格式...');
  const newData = convertOpenFootball(rawData);
  console.log('  比赛总数: ' + newData.matches.length);
  console.log('  已完赛: ' + newData.metrics.completedMatches);

  // 合并精选数据
  const finalData = mergeWithExisting(newData, existingData);

  // 对比是否有变化
  const oldJson = existingData ? JSON.stringify({
    matches: existingData.matches?.map(m => ({
      id: m.id, home: m.home, away: m.away, homeScore: m.homeScore, awayScore: m.awayScore, completed: m.completed
    })),
    standings: existingData.standings
  }) : '';

  const newJson = JSON.stringify({
    matches: finalData.matches?.map(m => ({
      id: m.id, home: m.home, away: m.away, homeScore: m.homeScore, awayScore: m.awayScore, completed: m.completed
    })),
    standings: finalData.standings
  });

  if (oldJson === newJson) {
    console.log('\n✅ 数据无变化，跳过写入');
    return { changed: false };
  }

  // 写回文件
  fs.writeFileSync(DATA_FILE, JSON.stringify(finalData, null, 2), 'utf-8');
  console.log('\n✅ data.json 已更新！');
  console.log('  比赛: ' + finalData.matches.length + ' | 完赛: ' + finalData.metrics.completedMatches +
    ' | 积分榜: ' + finalData.standings.length + ' 队');
  console.log('  时间: ' + finalData.meta.generatedAt);

  return { changed: true, data: finalData };
}

// 执行
if (require.main === module) {
  main()
    .then(result => {
      console.log('\n对应: ' + (result.changed ? '数据需更新' : '数据最新'));
      process.exit(0);
    })
    .catch(err => {
      console.error('\n❌ 失败: ' + err.message);
      if (fs.existsSync(DATA_FILE)) {
        console.log('⚠️ 现有 data.json 仍可用，不视为错误');
        process.exit(0);
      }
      process.exit(1);
    });
}

module.exports = { main, convertOpenFootball };
