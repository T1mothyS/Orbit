import assert from 'node:assert/strict';
import test from 'node:test';

import {
  clearWeatherCaches,
  extractWeatherLocationQuery,
  getDailyWeather,
  isWeatherQuestion,
  searchLocations,
} from './weather-service.js';

test('天气意图优先使用问题中的明确地点', () => {
  assert.equal(isWeatherQuestion('北京明天天气怎么样？'), true);
  assert.equal(extractWeatherLocationQuery('北京明天天气怎么样？'), '北京');
  assert.equal(extractWeatherLocationQuery('今天天气怎么样？'), null);
  assert.equal(isWeatherQuestion('帮我安排明天下午的会议'), false);
});
test('地点搜索标准化结果并在缓存期内复用', async () => {
  clearWeatherCaches();
  let calls = 0;
  const fetcher: typeof fetch = async () => {
    calls++;
    return new Response(JSON.stringify({
      results: [{
        id: 1,
        name: '朝阳区',
        admin1: '北京市',
        country: '中国',
        country_code: 'CN',
        latitude: 39.92,
        longitude: 116.44,
        timezone: 'Asia/Shanghai',
      }],
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const first = await searchLocations('朝阳区', { fetcher, now: 1_000 });
  const second = await searchLocations('朝阳区', { fetcher, now: 2_000 });
  assert.equal(calls, 1);
  assert.equal(first[0].displayName, '朝阳区 · 北京市 · 中国');
  assert.deepEqual(second, first);
});

test('地点搜索失败时优先返回同查询的过期缓存', async () => {
  clearWeatherCaches();
  const first = await searchLocations('缓存地点', {
    now: 1_000,
    fetcher: async () => new Response(JSON.stringify({
      results: [{
        id: 2,
        name: '缓存地点',
        admin1: '测试省',
        country: '中国',
        country_code: 'CN',
        latitude: 31.23,
        longitude: 121.47,
        timezone: 'Asia/Shanghai',
      }],
    }), { status: 200 }),
  });
  const fallback = await searchLocations('缓存地点', {
    now: 1_000 + 12 * 60 * 60_000 + 60 * 60_000,
    fetcher: async () => new Response('upstream unavailable', { status: 502 }),
  });
  assert.deepEqual(fallback, first);
});

test('天气预报只接受指定日期并返回可读字段', async () => {
  clearWeatherCaches();
  const fetcher: typeof fetch = async () => new Response(JSON.stringify({
    timezone: 'Asia/Shanghai',
    daily: {
      time: ['2026-08-24'],
      weather_code: [61],
      temperature_2m_max: [29.4],
      temperature_2m_min: [22.1],
      precipitation_probability_max: [70],
      wind_speed_10m_max: [18.2],
    },
  }), { status: 200, headers: { 'content-type': 'application/json' } });
  const result = await getDailyWeather(
    { latitude: 39.92, longitude: 116.44, timezone: 'Asia/Shanghai' },
    '2026-08-24',
    { fetcher },
  );
  assert.equal(result.description, '有雨');
  assert.equal(result.temperatureMax, 29.4);
  assert.equal(result.precipitationProbabilityMax, 70);
  assert.equal(result.source, 'live');
  assert.equal(result.isStale, false);
  assert.equal(result.cacheAgeMs, 0);
});

test('天气临时 HTTP 失败时最多重试一次并在第二次成功', async () => {
  clearWeatherCaches();
  let calls = 0;
  const fetcher: typeof fetch = async () => {
    calls += 1;
    if (calls === 1) return new Response('busy', { status: 503 });
    return new Response(JSON.stringify({
      timezone: 'Asia/Shanghai',
      daily: { time: ['2026-08-24'], weather_code: [0] },
    }), { status: 200 });
  };
  const result = await getDailyWeather(
    { latitude: 39.92, longitude: 116.44, timezone: 'Asia/Shanghai' },
    '2026-08-24',
    { fetcher, now: 1_000 },
  );
  assert.equal(calls, 2);
  assert.equal(result.description, '晴');
  assert.equal(result.source, 'live');
});

test('天气临时 HTTP 失败重试耗尽后明确失败', async () => {
  clearWeatherCaches();
  let calls = 0;
  const fetcher: typeof fetch = async () => {
    calls += 1;
    return new Response('busy', { status: 503 });
  };
  await assert.rejects(
    () => getDailyWeather(
      { latitude: 39.92, longitude: 116.44, timezone: 'Asia/Shanghai' },
      '2026-08-24',
      { fetcher, now: 1_000 },
    ),
    /HTTP 503/,
  );
  assert.equal(calls, 2);
});

test('天气请求失败时使用同地点同日期的过期缓存并标记来源', async () => {
  clearWeatherCaches();
  const location = { latitude: 39.92, longitude: 116.44, timezone: 'Asia/Shanghai' } as const;
  const first = await getDailyWeather(location, '2026-08-24', {
    now: 1_000,
    fetcher: async () => new Response(JSON.stringify({
      timezone: 'Asia/Shanghai',
      daily: { time: ['2026-08-24'], weather_code: [61] },
    }), { status: 200 }),
  });
  const staleAt = 1_000 + 15 * 60_000 + 90 * 60_000;
  const fallback = await getDailyWeather(location, '2026-08-24', {
    now: staleAt,
    fetcher: async () => { throw new Error('network down'); },
  });
  assert.equal(first.source, 'live');
  assert.equal(fallback.source, 'cache');
  assert.equal(fallback.isStale, true);
  assert.equal(fallback.cacheAgeMs, staleAt - 1_000);
  assert.equal(fallback.retrievedAt, new Date(1_000).toISOString());
});

test('天气缓存超过 6 小时后不再降级为过期结果', async () => {
  clearWeatherCaches();
  const location = { latitude: 39.92, longitude: 116.44, timezone: 'Asia/Shanghai' } as const;
  await getDailyWeather(location, '2026-08-24', {
    now: 1_000,
    fetcher: async () => new Response(JSON.stringify({
      timezone: 'Asia/Shanghai',
      daily: { time: ['2026-08-24'], weather_code: [0] },
    }), { status: 200 }),
  });
  await assert.rejects(
    () => getDailyWeather(location, '2026-08-24', {
      now: 1_000 + 15 * 60_000 + 6 * 60 * 60_000 + 1,
      fetcher: async () => { throw new Error('network down'); },
    }),
    /网络请求失败/,
  );
});

test('天气服务超时时明确失败而不是返回虚构结果', async () => {
  clearWeatherCaches();
  const fetcher: typeof fetch = async (_input, init) => new Promise((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
  });
  await assert.rejects(
    () => searchLocations('超时地点', { fetcher, timeoutMs: 5 }),
    /天气服务响应超时/,
  );
});

test('邮件使用同一个明确模型的摄氏日均值，并行请求和普通天气共用结果', async () => {
  clearWeatherCaches();
  const location = { latitude: 52.52, longitude: 13.41, timezone: 'Europe/Berlin' };
  let calls = 0;
  const fetcher: typeof fetch = async input => {
    calls++;
    const url = new URL(input instanceof Request ? input.url : String(input));
    assert.equal(url.searchParams.get('models'), 'best_match,ecmwf_ifs025');
    assert.equal(url.searchParams.get('start_date'), '2026-11-19');
    assert.equal(url.searchParams.get('end_date'), '2026-11-20');
    assert.equal(url.searchParams.get('temperature_unit'), 'celsius');
    return Response.json({
      timezone: location.timezone,
      daily_units: {
        apparent_temperature_min_ecmwf_ifs025: '°C',
        apparent_temperature_max_ecmwf_ifs025: '°C',
        apparent_temperature_mean_ecmwf_ifs025: '°C',
      },
      daily: {
        time: ['2026-11-20', '2026-11-19'],
        weather_code_best_match: [0, 3],
        temperature_2m_max_best_match: [9, 10],
        precipitation_probability_max_best_match: [20, 30],
        apparent_temperature_min_ecmwf_ifs025: [-2, 0],
        apparent_temperature_max_ecmwf_ifs025: [6, 9],
        apparent_temperature_mean_ecmwf_ifs025: [2, 5],
        apparent_temperature_mean_best_match: [1, 99],
      },
    });
  };
  const options = { fetcher, includeApparent: true };
  const values = await Promise.all([getDailyWeather(location, '2026-11-20', options), getDailyWeather(location, '2026-11-20', options)]);
  assert.deepEqual(values[0], values[1]);
  assert.deepEqual(values[0].apparentTemperature, { min: -2, max: 6, changeFromPreviousDay: -3, dataset: 'ecmwf_ifs025' });
  assert.equal(values[0].precipitationProbabilityMax, 20);
  const standard = await getDailyWeather(location, '2026-11-20', { fetcher });
  assert.equal(standard.apparentTemperature, undefined);
  assert.equal(calls, 1);
});

test('昨日数据缺失、单位不一致和夏令时变更时只提供当天体感', async () => {
  const location = { latitude: 40.71, longitude: -74, timezone: 'America/New_York' };
  for (const scenario of [
    { date: '2026-11-20', prior: '2026-11-19', previousMean: null, unit: '°C' },
    { date: '2026-01-01', prior: '2025-12-31', previousMean: 5, unit: '°F' },
    { date: '2026-03-09', prior: '2026-03-08', previousMean: 5, unit: '°C' },
    { date: '2026-11-02', prior: '2026-11-01', previousMean: 5, unit: '°C' },
  ]) {
    clearWeatherCaches();
    const fetcher: typeof fetch = async () => Response.json({
      timezone: location.timezone,
      daily_units: {
        apparent_temperature_min_ecmwf_ifs025: '°C',
        apparent_temperature_max_ecmwf_ifs025: '°C',
        apparent_temperature_mean_ecmwf_ifs025: scenario.unit,
      },
      daily: {
        time: [scenario.prior, scenario.date],
        weather_code_best_match: [3, 0],
        apparent_temperature_min_ecmwf_ifs025: [0, -2],
        apparent_temperature_max_ecmwf_ifs025: [9, 6],
        apparent_temperature_mean_ecmwf_ifs025: [scenario.previousMean, 2],
      },
    });
    const result = await getDailyWeather(location, scenario.date, { fetcher, includeApparent: true });
    assert.deepEqual(result.apparentTemperature, { min: -2, max: 6, changeFromPreviousDay: null, dataset: 'ecmwf_ifs025' }, scenario.date);
  }
});
