const db = require('./state');
const { normalizeAddress } = require('./evm');

const RECENT_EVENTS_KEY = 'analytics:events:recent';
const EVENT_COUNTS_KEY = 'analytics:counts:events';
const SOURCE_COUNTS_KEY = 'analytics:counts:sources';
const TTL_SECONDS = 30 * 24 * 60 * 60;
const MAX_RECENT_EVENTS = 200;

const memory = {
  recent: [],
  byEvent: new Map(),
  bySource: new Map()
};

function safeJsonParse(raw) {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function randomId() {
  return Math.random().toString(36).slice(2, 10);
}

function sanitizeEventName(value) {
  const name = String(value || '').trim().toLowerCase();
  if (!/^[a-z0-9._-]{2,64}$/.test(name)) return null;
  return name;
}

function sanitizeSource(value) {
  const source = String(value || '').trim().toLowerCase();
  if (!/^[a-z0-9._-]{2,32}$/.test(source)) return 'unknown';
  return source;
}

function sanitizeString(value, maxLen = 256) {
  if (value === null || value === undefined) return null;
  return String(value).slice(0, maxLen);
}

function sanitizePayload(payload, maxLen = 3500) {
  if (payload === null || payload === undefined) return null;
  if (typeof payload === 'string') return sanitizeString(payload, maxLen);
  if (typeof payload === 'number' || typeof payload === 'boolean') return payload;

  try {
    const json = JSON.stringify(payload);
    if (json.length <= maxLen) return JSON.parse(json);
    return {
      truncated: true,
      preview: json.slice(0, maxLen)
    };
  } catch {
    return {
      truncated: true,
      preview: sanitizeString(payload, maxLen)
    };
  }
}

function toNumericObject(source) {
  const next = {};
  for (const [key, rawValue] of Object.entries(source || {})) {
    const value = Number(rawValue);
    if (!Number.isFinite(value)) continue;
    next[key] = value;
  }
  return next;
}

function mapToNumericObject(source) {
  const next = {};
  for (const [key, value] of source.entries()) {
    next[key] = Number(value || 0);
  }
  return next;
}

function normalizeEvent(input) {
  const event = sanitizeEventName(input.event);
  if (!event) return null;

  const timestamp = new Date().toISOString();
  return {
    id: `${Date.now()}_${randomId()}`,
    timestamp,
    source: sanitizeSource(input.source),
    event,
    playerId: sanitizeString(input.playerId, 64),
    walletAddress: normalizeAddress(input.walletAddress),
    payload: sanitizePayload(input.payload),
    userAgent: sanitizeString(input.userAgent, 256),
    requestId: sanitizeString(input.requestId, 128)
  };
}

function updateMemory(event) {
  memory.recent.unshift(event);
  if (memory.recent.length > MAX_RECENT_EVENTS) {
    memory.recent.length = MAX_RECENT_EVENTS;
  }

  memory.byEvent.set(event.event, (memory.byEvent.get(event.event) || 0) + 1);
  memory.bySource.set(event.source, (memory.bySource.get(event.source) || 0) + 1);
}

async function trackEvent(input) {
  const event = normalizeEvent(input);
  if (!event) return null;

  const redis = await db.getRedisClient();
  if (redis) {
    try {
      await redis
        .multi()
        .hIncrBy(EVENT_COUNTS_KEY, event.event, 1)
        .hIncrBy(SOURCE_COUNTS_KEY, event.source, 1)
        .lPush(RECENT_EVENTS_KEY, JSON.stringify(event))
        .lTrim(RECENT_EVENTS_KEY, 0, MAX_RECENT_EVENTS - 1)
        .expire(EVENT_COUNTS_KEY, TTL_SECONDS)
        .expire(SOURCE_COUNTS_KEY, TTL_SECONDS)
        .expire(RECENT_EVENTS_KEY, TTL_SECONDS)
        .exec();
      return event;
    } catch {
      // fallback to in-memory analytics if Redis write fails
    }
  }

  updateMemory(event);
  return event;
}

async function getSummary() {
  const redis = await db.getRedisClient();
  if (redis) {
    try {
      const [byEvent, bySource] = await Promise.all([
        redis.hGetAll(EVENT_COUNTS_KEY),
        redis.hGetAll(SOURCE_COUNTS_KEY)
      ]);

      return {
        byEvent: toNumericObject(byEvent),
        bySource: toNumericObject(bySource)
      };
    } catch {
      // fallback to in-memory analytics summary if Redis read fails
    }
  }

  return {
    byEvent: mapToNumericObject(memory.byEvent),
    bySource: mapToNumericObject(memory.bySource)
  };
}

async function getRecent(limit = 20) {
  const safeLimit = Math.max(1, Math.min(100, Number(limit || 20)));
  const redis = await db.getRedisClient();
  if (redis) {
    try {
      const raw = await redis.lRange(RECENT_EVENTS_KEY, 0, safeLimit - 1);
      return raw.map(safeJsonParse).filter(Boolean);
    } catch {
      // fallback to in-memory list if Redis read fails
    }
  }

  return memory.recent.slice(0, safeLimit);
}

module.exports = {
  getRecent,
  getSummary,
  sanitizeEventName,
  sanitizeSource,
  trackEvent
};
