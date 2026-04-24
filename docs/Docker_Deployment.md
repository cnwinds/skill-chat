# Docker Compose 部署

本文档对应以下文件：

- `docker/compose.yml`
- `docker/Dockerfile`
- `docker/nginx.conf`
- `docker/.env.example`

## 部署结构

- `api`：Fastify 后端，容器内使用 `/app/data`
- `web`：Nginx 静态站点，反向代理 `/api` 到 `api:3000`
- `docker/data/`：宿主机本地目录，持久化 SQLite、上传文件和生成文件

默认访问地址：

- Web UI：`http://localhost:7070`

## 1. 准备环境变量

在仓库根目录执行：

```bash
cd docker
cp .env.example .env
```

生产环境至少检查这些变量：

```dotenv
NODE_ENV=production
PORT=3000
WEB_PORT=7070
WEB_ORIGIN=https://app.example.com
SESSION_EXPIRES_IN=7d
```

说明：

- `WEB_ORIGIN` 必须与浏览器实际访问的前端 Origin 完全一致
- `SESSION_EXPIRES_IN` 控制 session cookie 和服务端 `auth_sessions` 的过期时间
- `WEB_PORT` 不是应用变量，而是 `docker compose` 的端口映射变量
- OpenAI 相关配置仍通过系统设置页维护

## 2. 一键启动

```bash
cd docker
docker compose up -d --build
```

查看状态：

```bash
cd docker
docker compose ps
```

查看日志：

```bash
cd docker
docker compose logs -f
```

## 3. 验证部署

验证前端首页：

```bash
curl -I http://127.0.0.1:7070
```

验证后端健康检查：

```bash
cd docker
docker compose exec api curl -fsS http://127.0.0.1:3000/health
```

验证前端反代到后端：

```bash
curl -fsS http://127.0.0.1:7070/api/system/status
```

## 4. 常用操作

停止服务：

```bash
cd docker
docker compose down
```

重新构建并启动：

```bash
cd docker
docker compose up -d --build
```

## 5. 数据位置

容器内数据目录：

```text
/app/data
```

宿主机落地目录：

```text
docker/data
```

其中包含：

- SQLite 数据库
- 用户上传文件
- Skill 生成的输出文件

这些数据现在直接保存在仓库内的 `docker/data/`，不再使用 Docker volume。

## 6. 反向代理与域名

如果前面还有一层 Nginx、Caddy 或云负载均衡：

- 外层代理只需要把流量转发到本机 `7070`
- 同时把 `docker/.env` 里的 `WEB_ORIGIN` 改成最终对外域名
- `/api/sessions/:id/stream` 是 SSE，外层代理不要开启响应缓冲
