# Docker Compose 部署

本文档对应仓库根目录的 `docker-compose.yml`、`Dockerfile` 和 `docker/nginx.conf`。

## 部署结构

- `api`：Fastify 后端，内置 SQLite、本地文件存储、Skill 目录和 Python skill 依赖。
- `web`：Nginx 静态站点，负责托管前端并反向代理 `/api` 到 `api:3000`。
- `skillchat_data`：Docker 命名卷，持久化数据库和上传/输出文件。

对外默认只暴露一个端口：

- Web UI：`http://localhost:7070`

## 1. 准备环境变量

先复制模板：

```bash
cp .env.example .env
```

生产环境至少检查这些变量：

```dotenv
NODE_ENV=production
PORT=3000
WEB_ORIGIN=http://localhost:7070
JWT_SECRET=请替换成长度足够的随机字符串
OPENAI_API_KEY=
ANTHROPIC_API_KEY=
```

说明：

- `WEB_ORIGIN` 要改成你的实际访问地址，例如 `https://chat.example.com`。
- 如果不配置 `OPENAI_API_KEY` / `ANTHROPIC_API_KEY`，系统会退回本地 rule-based 模式。
- `WEB_PORT` 不是应用变量，而是 `docker compose` 的端口映射变量。默认是 `7070`，如果要改成 `80`，可以在启动前执行 `export WEB_PORT=80`。

## 1.1 国内网络镜像源加速

`docker-compose.yml` 已经默认接入国内镜像源构建参数：

- `APT_MIRROR=http://mirrors.aliyun.com/debian`
- `APT_SECURITY_MIRROR=http://mirrors.aliyun.com/debian-security`
- `NPM_REGISTRY=https://registry.npmmirror.com`
- `PIP_INDEX_URL=https://pypi.tuna.tsinghua.edu.cn/simple`
- `PIP_TRUSTED_HOST=pypi.tuna.tsinghua.edu.cn`

如果你的服务器更适合别的源，可以在启动前覆盖：

```bash
export APT_MIRROR=http://mirrors.tuna.tsinghua.edu.cn/debian
export APT_SECURITY_MIRROR=http://mirrors.tuna.tsinghua.edu.cn/debian-security
export NPM_REGISTRY=https://registry.npmmirror.com
export PIP_INDEX_URL=https://pypi.tuna.tsinghua.edu.cn/simple
export PIP_TRUSTED_HOST=pypi.tuna.tsinghua.edu.cn
```

然后再启动：

```bash
docker compose up -d --build
```

## 2. 一键启动

```bash
docker compose up -d --build
```

查看状态：

```bash
docker compose ps
```

查看日志：

```bash
docker compose logs -f
```

## 3. 验证部署

验证前端首页：

```bash
curl -I http://127.0.0.1:7070
```

验证后端健康检查：

```bash
docker compose exec api curl -fsS http://127.0.0.1:3000/health
```

验证前端反代到后端：

```bash
curl -fsS http://127.0.0.1:7070/api/system/status
```

## 4. 常用操作

停止服务：

```bash
docker compose down
```

停止并删除数据卷：

```bash
docker compose down -v
```

重新构建并启动：

```bash
docker compose up -d --build
```

## 5. 数据位置

容器内数据目录：

```text
/app/data
```

其中包含：

- SQLite 数据库
- 用户上传文件
- Skill 生成的输出文件

这些内容保存在 Docker 命名卷 `skillchat_data` 中，容器重建后不会丢。

## 6. 反向代理与域名

如果你前面还有一层 Nginx、Caddy 或云负载均衡：

- 外层代理只需要把流量转发到本机 `7070`。
- 同时把 `.env` 里的 `WEB_ORIGIN` 改成最终对外域名。
- `/api/sessions/:id/stream` 是 SSE，外层代理不要开启强缓存和响应缓冲。
