import type { FastifyReply, FastifyRequest } from 'fastify';
import type { AppConfig } from '../config/env.js';

declare module 'fastify' {
  interface FastifyInstance {
    config: AppConfig;
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
  interface FastifyRequest {
    user: {
      sub: string;
      username: string;
      role: 'admin' | 'member';
    };
  }
}
