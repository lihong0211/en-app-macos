# 部署说明（阿里云）

## 前提

- 阿里云 ECS（或等价服务器），已配置好域名 + HTTPS 证书 + 反向代理（nginx 或其它）
- MySQL 实例可用，已执行 `backend/sql/schema.sql` 建表

## 部署 FastAPI 后端

1. 把 `backend/` 目录（不含 `.venv`、`__pycache__`、`dist`、`build`）上传到服务器
2. 服务器上装 Python 3.12，建虚拟环境并装依赖：

   ```bash
   cd backend
   python3 -m venv .venv
   ./.venv/bin/pip install -r requirements.txt
   ```

3. 服务器上的 `backend/.env` 需要指向真实的生产数据库和微信配置（不要把开发机的 `.env` 直接传上去，密码、AppSecret 都要换成生产环境的）
4. 用 `systemd` 常驻运行（避免 SSH 断开进程就没了），创建 `/etc/systemd/system/jidanci-backend.service`：

   ```ini
   [Unit]
   Description=jidanci FastAPI backend
   After=network.target

   [Service]
   WorkingDirectory=/path/to/backend
   ExecStart=/path/to/backend/.venv/bin/uvicorn main:app --host 127.0.0.1 --port 8000
   Restart=always
   User=your_linux_user

   [Install]
   WantedBy=multi-user.target
   ```

5. 启动并设置开机自启：

   ```bash
   sudo systemctl daemon-reload
   sudo systemctl enable --now jidanci-backend
   sudo systemctl status jidanci-backend
   ```

6. nginx 反向代理把 `https://你的域名/` 转发到 `127.0.0.1:8000`（HTTPS 终止在 nginx，uvicorn 本身跑 HTTP 就行）：

   ```nginx
   server {
     listen 443 ssl;
     server_name 你的域名;
     # ssl_certificate / ssl_certificate_key 用你已有的证书配置

     location / {
       proxy_pass http://127.0.0.1:8000;
       proxy_set_header Host $host;
       proxy_set_header X-Real-IP $remote_addr;
     }
   }
   ```

7. 微信开放平台"网站应用"的授权回调域配置成 `你的域名`（不含协议和路径），并把 `backend/.env` 里的 `WECHAT_APP_ID`/`WECHAT_APP_SECRET` 换成真实值

## Electron 客户端

生产打包时前端请求地址由 `src/render/.env.production` 里的 `VUE_APP_API_BASE_URL` 决定，改成 `https://你的域名` 即可，不需要再改代码。
