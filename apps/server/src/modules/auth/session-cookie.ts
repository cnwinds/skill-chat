import type { FastifyReply, FastifyRequest } from 'fastify';
import type { AppConfig } from '../../config/env.js';

export const SESSION_COOKIE_NAME = 'skillchat_session';

const serializeCookiePart = (name: string, value: string) => `${name}=${encodeURIComponent(value)}`;

export const parseDurationToSeconds = (value: string) => {
  const normalized = value.trim();
  if (!normalized) {
    return undefined;
  }

  if (/^\d+$/.test(normalized)) {
    return Number(normalized);
  }

  const match = normalized.match(/^(\d+)\s*([smhdw])$/i);
  if (!match) {
    return undefined;
  }

  const amount = Number(match[1]);
  const unit = match[2].toLowerCase();
  const unitSeconds: Record<string, number> = {
    s: 1,
    m: 60,
    h: 60 * 60,
    d: 60 * 60 * 24,
    w: 60 * 60 * 24 * 7,
  };
  return amount * unitSeconds[unit];
};

const buildBaseAttributes = (config: AppConfig) => {
  const attributes = ['Path=/', 'HttpOnly', 'SameSite=Lax'];
  if (config.NODE_ENV === 'production') {
    attributes.push('Secure');
  }
  return attributes;
};

export const buildSessionCookieHeader = (config: AppConfig, token: string) => {
  const attributes = buildBaseAttributes(config);
  const maxAge = parseDurationToSeconds(config.SESSION_EXPIRES_IN);
  if (maxAge && Number.isFinite(maxAge) && maxAge > 0) {
    attributes.push(`Max-Age=${Math.floor(maxAge)}`);
  }

  return [serializeCookiePart(SESSION_COOKIE_NAME, token), ...attributes].join('; ');
};

export const buildClearedSessionCookieHeader = (config: AppConfig) => [
  serializeCookiePart(SESSION_COOKIE_NAME, ''),
  ...buildBaseAttributes(config),
  'Max-Age=0',
  'Expires=Thu, 01 Jan 1970 00:00:00 GMT',
].join('; ');

export const setSessionCookie = (reply: FastifyReply, config: AppConfig, token: string) => {
  reply.header('Set-Cookie', buildSessionCookieHeader(config, token));
};

export const clearSessionCookie = (reply: FastifyReply, config: AppConfig) => {
  reply.header('Set-Cookie', buildClearedSessionCookieHeader(config));
};

const parseCookieHeader = (header: string | undefined) => {
  const cookies: Record<string, string> = {};
  if (!header) {
    return cookies;
  }

  for (const segment of header.split(';')) {
    const trimmed = segment.trim();
    if (!trimmed) {
      continue;
    }

    const separatorIndex = trimmed.indexOf('=');
    if (separatorIndex <= 0) {
      continue;
    }

    const name = trimmed.slice(0, separatorIndex).trim();
    const rawValue = trimmed.slice(separatorIndex + 1).trim();
    cookies[name] = decodeURIComponent(rawValue);
  }

  return cookies;
};

export const readSessionTokenFromRequest = (request: FastifyRequest) =>
  parseCookieHeader(request.headers.cookie)[SESSION_COOKIE_NAME];
