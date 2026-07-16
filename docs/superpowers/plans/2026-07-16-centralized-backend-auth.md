# 中心化后端 + 登录功能 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 Python 后端从 Electron 本地子进程改成阿里云上常驻的中心化服务，并给桌面客户端加上微信扫码登录 + 账号密码登录（简化版 token 鉴权，不用 JWT）。

**Architecture:** FastAPI 后端新增 `/auth/*` 路由（微信登录、账号注册/登录、`/auth/me`），token 直接存 `users.token` 字段校验，不引入 JWT/session store。Electron 主进程负责微信 OAuth 的 BrowserWindow 拦截和本地 token 文件存储，并根据登录态在"登录窗口"和"悬浮词卡窗口"之间切换；生产环境不再 spawn 本地 Python 子进程，所有请求打阿里云域名。

**Tech Stack:** FastAPI + SQLAlchemy + PyMySQL（后端，已有），bcrypt（新增，密码哈希），pytest + httpx（新增，后端测试），Vue 3 + axios（前端，已有），Electron BrowserWindow + contextBridge（已有机制，新增鉴权 IPC）。

## Global Constraints

- 不使用 JWT：登录令牌是随机字符串，直接存在 `users.token` 字段上，每次请求查库校验（详见 spec `docs/superpowers/specs/2026-07-16-centralized-backend-auth-design.md`）
- 同一账号新登录会覆盖旧 token（单设备在线），这是刻意的简化，不是 bug
- `words`/`word_meanings` 表本阶段不改动，不加 `user_id`；`word_libraries`/`word_library_items` 表已经在 `backend/sql/schema.sql` 里建好，但本阶段代码不读写它们
- 不做旧数据迁移（用户已明确决定不迁移本地 362 条单词数据）
- 不引入 `keytar` 等原生模块存 token，本地就用一个 JSON 文件（`app.getPath('userData')` 下），可接受的安全取舍
- 开发环境（`npm run dev`）继续 spawn 本地 Python 后端 + 连本地 MySQL；只有生产打包的客户端改成打阿里云域名、且不再 spawn 本地后端
- AppSecret、数据库密码等敏感信息只能出现在后端 `.env`，不能出现在 Electron 代码或前端代码里

---

## 文件结构总览

**后端新增：**
- `backend/utils/security.py` — 密码哈希 + token 生成
- `backend/utils/wechat.py` — 微信 OAuth API 客户端
- `backend/core/auth.py` — `get_current_user` FastAPI 依赖
- `backend/api/auth.py` — `/auth/*` 路由
- `backend/conftest.py` — pytest 测试夹具（内存 SQLite + TestClient）
- `backend/tests/test_security.py`
- `backend/tests/test_wechat.py`
- `backend/tests/test_auth_api.py`

**后端修改：**
- `backend/model/users.py` — 加字段、调整可空性
- `backend/core/exception.py` — `LoginInfoException` 补上默认 401
- `backend/main.py` — 注册 `/auth` 路由 + 异常处理器
- `backend/api/users.py` — 密码走哈希、输出去掉敏感字段
- `backend/requirements.txt` — 加 `bcrypt`、`pytest`、`httpx`
- `backend/.env`、`backend/.env.example` — 加微信/token相关配置
- `backend/sql/schema.sql` — 补一条本地 dev 库的 ALTER 语句说明（不改阿里云那份已经写好的 CREATE TABLE）

**Electron 主进程修改：**
- `src/main/main.js` — token 本地存储、`createLoginWindow`、微信登录窗口拦截、启动流程改造、生产环境移除本地后端 spawn
- `src/preload/preload.cjs` — 暴露鉴权相关 IPC 方法

**前端（Vue 渲染进程）新增：**
- `src/render/src/api/http.js` — 共享 axios 实例（带鉴权拦截器）
- `src/render/src/components/Login.vue`
- `src/render/.env.development`
- `src/render/.env.production`

**前端修改：**
- `src/render/src/App.vue` — 按 URL query 切换登录视图/主视图
- `src/render/src/components/Desk.vue` — 改用共享 axios 实例
- `src/render/package.json` — `axios` 挪到 `dependencies`

**打包配置修改：**
- `package.json` — 移除 `extraResources` 里本地后端可执行文件/`.env` 两项

**文档新增：**
- `docs/deploy.md` — 阿里云部署说明

---

### Task 1: 后端依赖与测试基础设施

**Files:**
- Modify: `backend/requirements.txt`
- Create: `backend/conftest.py`
- Create: `backend/tests/__init__.py`（空文件，让 `tests` 成为可导入的包）

**Interfaces:**
- Produces: pytest fixture `client`（`TestClient` 实例，DB 已替换成内存 SQLite）供后续所有测试任务使用

- [ ] **Step 1: 加依赖**

编辑 `backend/requirements.txt`，追加：

```
bcrypt~=4.2.0
pytest~=8.3.0
httpx~=0.27.0
```

- [ ] **Step 2: 安装依赖**

```bash
cd backend && ./.venv/bin/pip install -r requirements.txt
```
Expected: `bcrypt`、`pytest`、`httpx` 安装成功，无报错

- [ ] **Step 3: 写 conftest.py**

创建 `backend/conftest.py`：

```python
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from fastapi.testclient import TestClient

from db import Base, get_db
from main import app

# 用内存 SQLite 跑测试，不碰真实 MySQL
engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


@pytest.fixture()
def client():
    Base.metadata.create_all(bind=engine)

    def override_get_db():
        db = TestingSessionLocal()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db
    yield TestClient(app)
    Base.metadata.drop_all(bind=engine)
    app.dependency_overrides.clear()
```

- [ ] **Step 4: 建空的 tests 包**

```bash
mkdir -p backend/tests && touch backend/tests/__init__.py
```

- [ ] **Step 5: 验证 pytest 能跑起来（此时还没有测试用例，先跑一个空集合确认环境没问题）**

```bash
cd backend && ./.venv/bin/pytest --collect-only
```
Expected: 输出 `collected 0 items`，无报错（`main.py` 能正常 import，说明现有依赖没被破坏）

- [ ] **Step 6: 提交**

```bash
git add backend/requirements.txt backend/conftest.py backend/tests/__init__.py
git commit -m "test: 搭建 pytest + 内存SQLite 测试基础设施"
```

---

### Task 2: users 表结构调整

**Files:**
- Modify: `backend/model/users.py`
- Modify: `backend/sql/schema.sql`

**Interfaces:**
- Produces: `UserModel` 新增列 `nickname`, `avatar`, `token`, `token_expires_at`；`username`/`password`/`wx` 改为可空。后续所有任务基于这个新结构

- [ ] **Step 1: 改 SQLAlchemy 模型**

把 `backend/model/users.py` 整个替换成：

```python
# users.py
from sqlalchemy import Column, String, Integer, DateTime
from pydantic import BaseModel, Field
from typing import Literal, Optional
from datetime import datetime

from .base import MyModel, BaseSchema
from db import Base


# SQLAlchemy 用户模型
class UserModel(Base, MyModel):
    __tablename__ = "users"

    username = Column(String(20), unique=True, index=True, nullable=True)
    password = Column(String(255), nullable=True)
    wx = Column(String(64), unique=True, index=True, nullable=True)
    nickname = Column(String(50), nullable=True)
    avatar = Column(String(255), nullable=True)
    phone = Column(String(11), index=True)
    description = Column(String(255))
    active = Column(Integer, default=1)
    token = Column(String(64), unique=True, index=True, nullable=True)
    token_expires_at = Column(DateTime(), nullable=True)


# 对外输出用，绝不包含 password/token
class UserPublic(BaseSchema):
    username: Optional[str] = None
    wx: Optional[str] = None
    nickname: Optional[str] = None
    avatar: Optional[str] = None
    phone: Optional[str] = None
    description: Optional[str] = None
    active: Literal[0, 1] = 1


# 原有的增删改查接口输入用（仍然保留，供 /users/* 使用）
class UserBase(BaseSchema):
    username: Optional[str] = Field(None, min_length=1, max_length=20)
    password: Optional[str] = Field(None, min_length=3, max_length=100)
    wx: Optional[str] = Field(None, min_length=3, max_length=64)
    description: Optional[str] = Field(None, min_length=3, max_length=255)
    active: Literal[0, 1] = Field(
        default=1, description="用户激活状态，1表示激活，0表示禁用"
    )
```

- [ ] **Step 2: 给本地 dev MySQL 补上新字段（阿里云那份 `schema.sql` 已经是最新结构，不用改；这一步是本地开发库要跟上）**

```bash
mysql -h 127.0.0.1 -u root -p english_new <<'EOF'
ALTER TABLE users
  MODIFY username VARCHAR(20) NULL,
  MODIFY password VARCHAR(255) NULL,
  MODIFY wx VARCHAR(64) NULL,
  ADD UNIQUE KEY uk_wx (wx),
  ADD COLUMN nickname VARCHAR(50) NULL AFTER wx,
  ADD COLUMN avatar VARCHAR(255) NULL AFTER nickname,
  ADD COLUMN token VARCHAR(64) NULL AFTER active,
  ADD UNIQUE KEY uk_token (token),
  ADD COLUMN token_expires_at DATETIME NULL AFTER token;
EOF
```
Expected: 无报错（如果本地库密码不是空，把 `-p` 后面的密码按 `backend/.env` 里的 `DB_PASSWORD` 填上）

- [ ] **Step 3: 验证模型能正常导入且和表结构对得上**

```bash
cd backend && ./.venv/bin/python -c "
from db import Session
from model.users import UserModel
s = Session()
print(UserModel.select_by(s, {}))
s.close()
"
```
Expected: 打印一个列表（可能是空的 `[]`，或者已有用户），不报 `Unknown column` 之类的错

- [ ] **Step 4: 提交**

```bash
git add backend/model/users.py
git commit -m "feat: users 表加 nickname/avatar/token 字段，username/password/wx 改为可空"
```

---

### Task 3: 密码哈希与 token 生成工具

**Files:**
- Create: `backend/utils/security.py`
- Create: `backend/tests/test_security.py`

**Interfaces:**
- Produces: `hash_password(raw: str) -> str`、`verify_password(raw: str, hashed: str) -> bool`、`generate_token() -> str`

- [ ] **Step 1: 写失败的测试**

创建 `backend/tests/test_security.py`：

```python
from utils.security import hash_password, verify_password, generate_token


def test_hash_password_produces_different_string():
    hashed = hash_password("mypassword")
    assert hashed != "mypassword"
    assert len(hashed) > 20


def test_verify_password_correct():
    hashed = hash_password("mypassword")
    assert verify_password("mypassword", hashed) is True


def test_verify_password_wrong():
    hashed = hash_password("mypassword")
    assert verify_password("wrongpassword", hashed) is False


def test_generate_token_is_random_and_long():
    t1 = generate_token()
    t2 = generate_token()
    assert t1 != t2
    assert len(t1) >= 32
```

- [ ] **Step 2: 跑测试确认失败**

```bash
cd backend && ./.venv/bin/pytest tests/test_security.py -v
```
Expected: FAIL，报 `ModuleNotFoundError: No module named 'utils.security'`

- [ ] **Step 3: 实现**

创建 `backend/utils/security.py`：

```python
import bcrypt
import secrets


def hash_password(raw: str) -> str:
    """bcrypt 哈希密码，返回可直接存库的字符串"""
    return bcrypt.hashpw(raw.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(raw: str, hashed: str) -> bool:
    """校验明文密码是否匹配哈希值"""
    return bcrypt.checkpw(raw.encode("utf-8"), hashed.encode("utf-8"))


def generate_token() -> str:
    """生成随机登录令牌"""
    return secrets.token_hex(32)
```

- [ ] **Step 4: 跑测试确认通过**

```bash
cd backend && ./.venv/bin/pytest tests/test_security.py -v
```
Expected: 4 个测试全部 PASS

- [ ] **Step 5: 提交**

```bash
git add backend/utils/security.py backend/tests/test_security.py
git commit -m "feat: 密码哈希与登录令牌生成工具"
```

---

### Task 4: 微信 OAuth API 客户端

**Files:**
- Create: `backend/utils/wechat.py`
- Create: `backend/tests/test_wechat.py`
- Modify: `backend/.env`、`backend/.env.example`

**Interfaces:**
- Consumes: `requests`（已在 requirements.txt）
- Produces: `exchange_code_for_openid(code: str) -> dict`（返回 `{"access_token": str, "openid": str}`），`fetch_wechat_userinfo(access_token: str, openid: str) -> dict`（返回 `{"nickname": str, "headimgurl": str}`）。两个函数在微信接口返回 `errcode` 时都抛 `RuntimeError(errmsg)`

- [ ] **Step 1: 加配置**

编辑 `backend/.env`，追加：

```
WECHAT_APP_ID=
WECHAT_APP_SECRET=
```

编辑 `backend/.env.example`，同样追加（不含真实值）：

```
WECHAT_APP_ID=
WECHAT_APP_SECRET=
```

把 `backend/.env` 里 `WECHAT_APP_ID`/`WECHAT_APP_SECRET` 换成真实的微信开放平台网站应用的 AppID/AppSecret（这两个值不进 git，`.env` 已在 `.gitignore` 里）。

- [ ] **Step 2: 写失败的测试（mock `requests.get`，不打真实微信接口）**

创建 `backend/tests/test_wechat.py`：

```python
from unittest.mock import patch
import pytest

from utils.wechat import exchange_code_for_openid, fetch_wechat_userinfo


@patch("utils.wechat.requests.get")
def test_exchange_code_for_openid_success(mock_get):
    mock_get.return_value.json.return_value = {
        "access_token": "ACCESS_TOKEN",
        "openid": "OPENID123",
    }
    result = exchange_code_for_openid("some_code")
    assert result == {"access_token": "ACCESS_TOKEN", "openid": "OPENID123"}


@patch("utils.wechat.requests.get")
def test_exchange_code_for_openid_wechat_error(mock_get):
    mock_get.return_value.json.return_value = {
        "errcode": 40029,
        "errmsg": "invalid code",
    }
    with pytest.raises(RuntimeError, match="invalid code"):
        exchange_code_for_openid("bad_code")


@patch("utils.wechat.requests.get")
def test_fetch_wechat_userinfo_success(mock_get):
    mock_get.return_value.json.return_value = {
        "nickname": "张三",
        "headimgurl": "https://example.com/avatar.png",
    }
    result = fetch_wechat_userinfo("ACCESS_TOKEN", "OPENID123")
    assert result == {"nickname": "张三", "headimgurl": "https://example.com/avatar.png"}
```

- [ ] **Step 3: 跑测试确认失败**

```bash
cd backend && ./.venv/bin/pytest tests/test_wechat.py -v
```
Expected: FAIL，报 `ModuleNotFoundError: No module named 'utils.wechat'`

- [ ] **Step 4: 实现**

创建 `backend/utils/wechat.py`：

```python
import os
import requests

WECHAT_APP_ID = os.getenv("WECHAT_APP_ID", "")
WECHAT_APP_SECRET = os.getenv("WECHAT_APP_SECRET", "")

ACCESS_TOKEN_URL = "https://api.weixin.qq.com/sns/oauth2/access_token"
USERINFO_URL = "https://api.weixin.qq.com/sns/userinfo"


def exchange_code_for_openid(code: str) -> dict:
    """用授权 code 换取 access_token + openid"""
    resp = requests.get(
        ACCESS_TOKEN_URL,
        params={
            "appid": WECHAT_APP_ID,
            "secret": WECHAT_APP_SECRET,
            "code": code,
            "grant_type": "authorization_code",
        },
        timeout=5,
    )
    data = resp.json()
    if "errcode" in data:
        raise RuntimeError(data.get("errmsg", "微信登录失败"))
    return {"access_token": data["access_token"], "openid": data["openid"]}


def fetch_wechat_userinfo(access_token: str, openid: str) -> dict:
    """拉取微信昵称、头像"""
    resp = requests.get(
        USERINFO_URL,
        params={"access_token": access_token, "openid": openid, "lang": "zh_CN"},
        timeout=5,
    )
    data = resp.json()
    if "errcode" in data:
        raise RuntimeError(data.get("errmsg", "获取微信用户信息失败"))
    return {"nickname": data.get("nickname", ""), "headimgurl": data.get("headimgurl", "")}
```

- [ ] **Step 5: 跑测试确认通过**

```bash
cd backend && ./.venv/bin/pytest tests/test_wechat.py -v
```
Expected: 3 个测试全部 PASS

- [ ] **Step 6: 提交**

```bash
git add backend/utils/wechat.py backend/tests/test_wechat.py backend/.env.example
git commit -m "feat: 微信 OAuth API 客户端（换取 openid + 拉取用户信息）"
```
注意：`backend/.env` 不要 `git add`（已被 gitignore，含真实密钥）。

---

### Task 5: 鉴权基础设施 + `/auth` 路由（微信登录、账号注册/登录、`/auth/me`）

**Files:**
- Modify: `backend/core/exception.py`
- Create: `backend/core/auth.py`
- Create: `backend/api/auth.py`
- Modify: `backend/main.py`
- Create: `backend/tests/test_auth_dependency.py`
- Create: `backend/tests/test_auth_api.py`

**Interfaces:**
- Consumes: `UserModel`（Task 2）、`get_db`（`db.py` 已有）、`hash_password`/`verify_password`/`generate_token`（Task 3）、`exchange_code_for_openid`/`fetch_wechat_userinfo`（Task 4）
- Produces: `LoginInfoException`（`core/exception.py`，401 异常）、`get_current_user(authorization: str = Header(None), db: Session = Depends(get_db)) -> UserModel`（`core/auth.py`）、`POST /auth/wechat/login`、`POST /auth/register`、`POST /auth/login`、`GET /auth/me`（前三个成功时返回 `{code:200, data:{token, user}}`，`user` 是 `UserPublic` 结构），后续 Phase 2 的接口鉴权复用 `get_current_user`

这个任务分两段提交：第一段（鉴权依赖本身）和第二段（`/auth` 路由）之间，`main.py` 全程保持可以正常 import——不要把"改 `main.py` 引入 `auth` 路由"这一步提前到 `backend/api/auth.py` 创建之前，否则中间会有一个整个后端 import 不起来的提交。

- [ ] **Step 1: 补上 `LoginInfoException` 的默认值**

编辑 `backend/core/exception.py`，把：

```python
class LoginInfoException(Exception):
    pass
```

替换成：

```python
class LoginInfoException(BusinessException):
    def __init__(self, msg="未登录或登录已过期"):
        super().__init__(code=401, msg=msg)
```

（这个类之前定义在 `BusinessException` 之前，需要把 `LoginInfoException` 的定义挪到 `BusinessException` 定义之后。调整后 `backend/core/exception.py` 完整内容：）

```python
from core import api_result


class JsonParseException(Exception):
    pass


class CntFormatException(Exception):
    pass


class BusinessException(Exception):
    code = 400
    msg = "服务器内部错误"

    def __init__(self, code=400, msg=""):
        super().__init__(msg)
        self.code = code
        self.msg = msg

    def json(self):
        return api_result.error(msg=self.msg, code=self.code)


class LoginInfoException(BusinessException):
    def __init__(self, msg="未登录或登录已过期"):
        super().__init__(code=401, msg=msg)
```

- [ ] **Step 2: 写 `get_current_user` 依赖**

创建 `backend/core/auth.py`：

```python
from datetime import datetime
from fastapi import Depends, Header
from sqlalchemy.orm import Session

from db import get_db
from model.users import UserModel
from core.exception import LoginInfoException


def get_current_user(
    authorization: str = Header(None), db: Session = Depends(get_db)
) -> UserModel:
    """解析 `Authorization: Bearer <token>`，查库校验，返回当前登录用户"""
    if not authorization or not authorization.startswith("Bearer "):
        raise LoginInfoException()

    token = authorization[len("Bearer "):]
    user = UserModel.select_one_by(db, {"token": token})

    if not user:
        raise LoginInfoException()

    if user.token_expires_at and user.token_expires_at < datetime.now():
        raise LoginInfoException("登录已过期，请重新登录")

    return user
```

- [ ] **Step 3: 写测试验证 `get_current_user` 的三种分支（此时先直接测依赖函数本身，不经过 HTTP 路由）**

创建 `backend/tests/test_auth_dependency.py`：

```python
from datetime import datetime, timedelta
import pytest

from core.exception import LoginInfoException
from core.auth import get_current_user
from model.users import UserModel


def _make_db_with_user(SessionLocal, token="validtoken", expires_delta=None):
    db = SessionLocal()
    user = UserModel()
    user.token = token
    user.token_expires_at = (
        datetime.now() + expires_delta if expires_delta is not None else None
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return db, user


def test_missing_authorization_header_raises(client):
    from conftest import TestingSessionLocal

    db = TestingSessionLocal()
    with pytest.raises(LoginInfoException):
        get_current_user(authorization=None, db=db)
    db.close()


def test_invalid_token_raises(client):
    from conftest import TestingSessionLocal

    db = TestingSessionLocal()
    with pytest.raises(LoginInfoException):
        get_current_user(authorization="Bearer nosuchtoken", db=db)
    db.close()


def test_valid_token_returns_user(client):
    from conftest import TestingSessionLocal

    db, user = _make_db_with_user(TestingSessionLocal, expires_delta=timedelta(days=30))
    result = get_current_user(authorization=f"Bearer {user.token}", db=db)
    assert result.id == user.id
    db.close()


def test_expired_token_raises(client):
    from conftest import TestingSessionLocal

    db, user = _make_db_with_user(TestingSessionLocal, expires_delta=timedelta(days=-1))
    with pytest.raises(LoginInfoException):
        get_current_user(authorization=f"Bearer {user.token}", db=db)
    db.close()
```

（这里借用了 `client` fixture 只是为了触发 `conftest.py` 里的建表/清表逻辑，函数本身直接调用 `get_current_user`，不经过 HTTP）

- [ ] **Step 4: 跑测试确认通过（这一步 `core/auth.py` 已经实现、`main.py` 完全没动过，所以直接就能过，不是"预期失败"）**

```bash
cd backend && ./.venv/bin/pytest tests/test_auth_dependency.py -v
```
Expected: 4 个测试全部 PASS

- [ ] **Step 5: 提交（第一个安全检查点——此时 `main.py` 完全没改动过，整个后端照常能 import、能跑）**

```bash
git add backend/core/exception.py backend/core/auth.py backend/tests/test_auth_dependency.py
git commit -m "feat: 鉴权基础设施 - LoginInfoException 与 get_current_user 依赖"
```

- [ ] **Step 6: 写 `/auth` 路由的失败测试（此时 `/auth/*` 还没注册到 `main.py`，请求会得到 FastAPI 默认的 404，不是 `ModuleNotFoundError`）**

创建 `backend/tests/test_auth_api.py`：

```python
from unittest.mock import patch


def test_register_success(client):
    resp = client.post("/auth/register", json={"username": "alice", "password": "secret123"})
    body = resp.json()
    assert body["code"] == 200
    assert body["data"]["token"]
    assert body["data"]["user"]["username"] == "alice"
    assert "password" not in body["data"]["user"]


def test_register_duplicate_username(client):
    client.post("/auth/register", json={"username": "bob", "password": "secret123"})
    resp = client.post("/auth/register", json={"username": "bob", "password": "other"})
    body = resp.json()
    assert body["code"] != 200


def test_login_success(client):
    client.post("/auth/register", json={"username": "carol", "password": "secret123"})
    resp = client.post("/auth/login", json={"username": "carol", "password": "secret123"})
    body = resp.json()
    assert body["code"] == 200
    assert body["data"]["token"]


def test_login_wrong_password(client):
    client.post("/auth/register", json={"username": "dave", "password": "secret123"})
    resp = client.post("/auth/login", json={"username": "dave", "password": "wrong"})
    body = resp.json()
    assert body["code"] != 200


def test_login_unknown_username(client):
    resp = client.post("/auth/login", json={"username": "nosuchuser", "password": "x"})
    body = resp.json()
    assert body["code"] != 200


def test_me_without_token(client):
    resp = client.get("/auth/me")
    body = resp.json()
    assert body["code"] == 401


def test_me_with_valid_token(client):
    register_resp = client.post(
        "/auth/register", json={"username": "erin", "password": "secret123"}
    )
    token = register_resp.json()["data"]["token"]
    resp = client.get("/auth/me", headers={"Authorization": f"Bearer {token}"})
    body = resp.json()
    assert body["code"] == 200
    assert body["data"]["username"] == "erin"


@patch("api.auth.fetch_wechat_userinfo")
@patch("api.auth.exchange_code_for_openid")
def test_wechat_login_creates_new_user(mock_exchange, mock_userinfo, client):
    mock_exchange.return_value = {"access_token": "AT", "openid": "OPENID_XYZ"}
    mock_userinfo.return_value = {"nickname": "微信昵称", "headimgurl": "https://x.com/a.png"}

    resp = client.post("/auth/wechat/login", json={"code": "some_code"})
    body = resp.json()
    assert body["code"] == 200
    assert body["data"]["token"]
    assert body["data"]["user"]["nickname"] == "微信昵称"


@patch("api.auth.fetch_wechat_userinfo")
@patch("api.auth.exchange_code_for_openid")
def test_wechat_login_existing_user_reuses_row(mock_exchange, mock_userinfo, client):
    mock_exchange.return_value = {"access_token": "AT", "openid": "OPENID_SAME"}
    mock_userinfo.return_value = {"nickname": "老用户", "headimgurl": ""}

    first = client.post("/auth/wechat/login", json={"code": "code1"})
    second = client.post("/auth/wechat/login", json={"code": "code2"})

    assert first.json()["data"]["user"]["id"] == second.json()["data"]["user"]["id"]
```

- [ ] **Step 7: 跑测试确认失败**

```bash
cd backend && ./.venv/bin/pytest tests/test_auth_api.py -v
```
Expected: FAIL——`/auth/register` 等路径还没注册到 `main.py`，请求会拿到 FastAPI 默认 404 响应（`{"detail":"Not Found"}`），测试里取 `body["code"]` 会因为响应里没有这个 key 而报 `KeyError`

- [ ] **Step 8: 实现 `/auth` 路由**

创建 `backend/api/auth.py`：

```python
# auth.py
from datetime import datetime, timedelta
from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from model.users import UserModel, UserPublic
from db import get_db
from core.api_result import success, error, ApiResponse
from core.auth import get_current_user
from utils.security import hash_password, verify_password, generate_token
from utils.wechat import exchange_code_for_openid, fetch_wechat_userinfo

router = APIRouter(prefix="/auth", tags=["auth"])

TOKEN_VALID_DAYS = 30


class AuthData(BaseModel):
    token: str
    user: UserPublic


class RegisterRequest(BaseModel):
    username: str = Field(..., min_length=1, max_length=20)
    password: str = Field(..., min_length=3, max_length=100)


class LoginRequest(BaseModel):
    username: str
    password: str


class WechatLoginRequest(BaseModel):
    code: str


def _issue_token(db: Session, user: UserModel) -> str:
    token = generate_token()
    UserModel.update(
        db,
        {
            "id": user.id,
            "token": token,
            "token_expires_at": datetime.now() + timedelta(days=TOKEN_VALID_DAYS),
        },
    )
    return token


@router.post("/register", response_model=ApiResponse[AuthData], summary="账号密码注册")
async def register(payload: RegisterRequest, db: Session = Depends(get_db)):
    existing = UserModel.select_one_by(db, {"username": payload.username})
    if existing:
        return error("用户名已存在")

    user_id = UserModel.insert(
        db, {"username": payload.username, "password": hash_password(payload.password)}
    )
    user = UserModel.get_by_id(db, user_id)
    token = _issue_token(db, user)
    return success({"token": token, "user": UserModel.get_by_id(db, user_id)})


@router.post("/login", response_model=ApiResponse[AuthData], summary="账号密码登录")
async def login(payload: LoginRequest, db: Session = Depends(get_db)):
    user = UserModel.select_one_by(db, {"username": payload.username})
    if not user or not user.password or not verify_password(payload.password, user.password):
        return error("用户名或密码错误")

    token = _issue_token(db, user)
    return success({"token": token, "user": UserModel.get_by_id(db, user.id)})


@router.post("/wechat/login", response_model=ApiResponse[AuthData], summary="微信扫码登录")
async def wechat_login(payload: WechatLoginRequest, db: Session = Depends(get_db)):
    try:
        token_data = exchange_code_for_openid(payload.code)
        userinfo = fetch_wechat_userinfo(token_data["access_token"], token_data["openid"])
    except RuntimeError as e:
        return error(str(e))

    openid = token_data["openid"]
    user = UserModel.select_one_by(db, {"wx": openid})
    if not user:
        user_id = UserModel.insert(
            db,
            {
                "wx": openid,
                "nickname": userinfo["nickname"],
                "avatar": userinfo["headimgurl"],
            },
        )
        user = UserModel.get_by_id(db, user_id)
    else:
        UserModel.update(
            db,
            {
                "id": user.id,
                "nickname": userinfo["nickname"],
                "avatar": userinfo["headimgurl"],
            },
        )
        user = UserModel.get_by_id(db, user.id)

    token = _issue_token(db, user)
    return success({"token": token, "user": UserModel.get_by_id(db, user.id)})


@router.get("/me", response_model=ApiResponse[UserPublic], summary="获取当前登录用户")
async def me(current_user: UserModel = Depends(get_current_user)):
    return success(current_user)
```

- [ ] **Step 9: 把 `/auth` 路由注册到 `main.py`，顺便注册一个异常处理器，让 `LoginInfoException` 也走跟其它接口一样的 `{code, msg, data}` 返回格式（而不是 FastAPI 默认的 HTTP 500/详情格式）——这一步 `backend/api/auth.py` 已经存在，注册不会破坏 import**

把 `backend/main.py` 整个替换成：

```python
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.encoders import jsonable_encoder
import uvicorn
from api import users, words, auth
from core.exception import BusinessException
from monitor import run_monitor

app = FastAPI(
    title="API",
    version="1.0.0",
    description="A complete API system with FastAPI, SQLAlchemy, and Pydantic",
    docs_url="/api/docs",
    redoc_url="/api/redoc",
    openapi_url="/api/openapi.json",
)

# 允许跨域请求
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # 允许所有来源
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(BusinessException)
async def business_exception_handler(request, exc: BusinessException):
    return JSONResponse(status_code=200, content=jsonable_encoder(exc.json()))


def register_api():
    # 手动注册每个路由
    routers = [
        users.router,
        words.router,
        auth.router,
    ]

    for router in routers:
        app.include_router(router)
        print(f"register_router {router.prefix} success")


register_api()

# 如果直接运行此脚本，则自动启动 mitmdump
if __name__ == "__main__":
    run_monitor()
    uvicorn.run(app, host="127.0.0.1", port=8000)
```

（`BusinessException` 的处理器同时也捕获它的子类 `LoginInfoException`——Starlette 按异常类型的 MRO 查找处理器，不需要给 `LoginInfoException` 单独注册一个）

- [ ] **Step 10: 跑全部测试确认通过**

```bash
cd backend && ./.venv/bin/pytest tests/ -v
```
Expected: 全部测试 PASS（包括 Task 1-4 和本任务 Step 3-5 写的测试）

- [ ] **Step 11: 提交**

```bash
git add backend/api/auth.py backend/main.py backend/tests/test_auth_api.py
git commit -m "feat: /auth 路由 - 微信扫码登录、账号注册/登录、获取当前用户"
```

---

### Task 6: 修复 `/users/*` 接口的密码泄露问题

**Files:**
- Modify: `backend/api/users.py`

**Interfaces:**
- Consumes: `UserPublic`（Task 2）、`hash_password`（Task 3）

**背景**：现有 `/users/add`、`/users/update` 等接口 `response_model` 用的是 `UserBase`，会把密码（哈希后）原样吐回给客户端；`/users/add` 创建用户时也是明文存密码，没有走哈希。顺手一起修掉。

- [ ] **Step 1: 写测试**

创建/追加到 `backend/tests/test_users_api.py`（新文件）：

```python
def test_create_user_password_is_hashed_and_not_returned(client):
    resp = client.post(
        "/users/add",
        json={"username": "frank", "password": "secret123", "wx": "wx_frank", "description": "test user"},
    )
    body = resp.json()
    assert body["code"] == 201 or body["code"] == 200
    assert "password" not in body["data"]


def test_list_users_does_not_return_password(client):
    client.post(
        "/users/add",
        json={"username": "grace", "password": "secret123", "wx": "wx_grace", "description": "test user"},
    )
    resp = client.get("/users/list", params={"page": 1, "page_size": 10})
    body = resp.json()
    assert body["code"] == 200
    for user in body["data"]:
        assert "password" not in user
```

- [ ] **Step 2: 跑测试确认失败**

```bash
cd backend && ./.venv/bin/pytest tests/test_users_api.py -v
```
Expected: FAIL（`password` 字段会出现在返回数据里）

- [ ] **Step 3: 改 `backend/api/users.py`**

在文件顶部 `from model.users import UserModel, UserBase` 改成：

```python
from model.users import UserModel, UserBase, UserPublic
from utils.security import hash_password
```

把所有 `response_model=ApiResponse[List[UserBase]]` 改成 `response_model=ApiResponse[List[UserPublic]]`，所有 `response_model=ApiResponse[UserBase]` 改成 `response_model=ApiResponse[UserPublic]`（`get_users`、`get_user`、`create_user`、`update_user`、`activate_user` 这几个路由的装饰器）。

再把 `create_user` 函数里存明文密码的地方：

```python
user_data = user.dict()
user_id = UserModel.insert(db, user_data)
```

改成：

```python
user_data = user.dict()
if user_data.get("password"):
    user_data["password"] = hash_password(user_data["password"])
user_id = UserModel.insert(db, user_data)
```

`update_user` 函数里同理，把：

```python
update_dict = user_data.dict(exclude_unset=True)
```

改成：

```python
update_dict = user_data.dict(exclude_unset=True)
if update_dict.get("password"):
    update_dict["password"] = hash_password(update_dict["password"])
```

- [ ] **Step 4: 跑测试确认通过**

```bash
cd backend && ./.venv/bin/pytest tests/ -v
```
Expected: 全部 PASS

- [ ] **Step 5: 提交**

```bash
git add backend/api/users.py backend/tests/test_users_api.py
git commit -m "fix: /users/* 接口密码走哈希存储，输出不再泄露密码字段"
```

---

### Task 7: 部署说明文档

**Files:**
- Create: `docs/deploy.md`

- [ ] **Step 1: 写文档**

创建 `docs/deploy.md`：

```markdown
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
```

- [ ] **Step 2: 提交**

```bash
git add docs/deploy.md
git commit -m "docs: 阿里云部署说明"
```

---

### Task 8: 前端共享 axios 实例 + 环境变量

**Files:**
- Create: `src/render/src/api/http.js`
- Create: `src/render/.env.development`
- Create: `src/render/.env.production`
- Modify: `src/render/package.json`

**Interfaces:**
- Produces: `http`（默认导出的 axios 实例，`baseURL` 来自 `process.env.VUE_APP_API_BASE_URL`，请求自动带 `Authorization`，收到业务层 401 时清 token 并触发 `window.electronAPI.sessionExpired()`）
- Consumes: `window.electronAPI.getToken()` / `window.electronAPI.clearToken()` / `window.electronAPI.sessionExpired()`（Task 10 会在 preload 里加上这几个方法——本任务先照接口约定写，Task 10 完成前这几个调用在真实 Electron 环境外跑不起来，属于正常的任务间依赖顺序）

- [ ] **Step 1: 环境变量文件**

创建 `src/render/.env.development`：

```
VUE_APP_API_BASE_URL=http://127.0.0.1:8000
```

创建 `src/render/.env.production`：

```
VUE_APP_API_BASE_URL=https://REPLACE_WITH_YOUR_DOMAIN
```

（`REPLACE_WITH_YOUR_DOMAIN` 打包前手动换成真实域名）

- [ ] **Step 2: 共享 axios 实例**

创建 `src/render/src/api/http.js`：

```js
import axios from 'axios'

const http = axios.create({
  baseURL: process.env.VUE_APP_API_BASE_URL
})

http.interceptors.request.use(async (config) => {
  const token = await window.electronAPI.getToken()
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

http.interceptors.response.use((response) => {
  if (response.data && response.data.code === 401) {
    window.electronAPI.clearToken()
    window.electronAPI.sessionExpired()
  }
  return response
})

export default http
```

- [ ] **Step 3: `axios` 挪到正式依赖（现在在 `devDependencies` 里，运行时代码依赖它应该在 `dependencies`）**

编辑 `src/render/package.json`，把 `devDependencies` 里的：

```json
"axios": "^1.11.0",
```

删掉，加到 `dependencies` 里（`dependencies` 目前只有 `@vue/eslint-config-prettier`、`core-js`、`vue`）：

```json
"dependencies": {
  "@vue/eslint-config-prettier": "^10.2.0",
  "axios": "^1.11.0",
  "core-js": "^3.8.3",
  "vue": "^3.2.13"
},
```

- [ ] **Step 4: 验证能正常安装依赖（这一步只是确认 package.json 语法没写错，真正联调要等 Task 10/11 完成）**

```bash
cd src/render && pnpm install
```
Expected: 无报错退出（这个子项目用 pnpm 管理依赖，锁文件是 `pnpm-lock.yaml`，不要用 `npm install`）

- [ ] **Step 5: 提交**

```bash
git add src/render/src/api/http.js src/render/.env.development src/render/.env.production src/render/package.json src/render/pnpm-lock.yaml
git commit -m "feat: 前端共享 axios 实例，环境变量区分开发/生产接口地址"
```

---

### Task 9: Login.vue 组件

**Files:**
- Create: `src/render/src/components/Login.vue`

**Interfaces:**
- Consumes: `http`（Task 8）、`window.electronAPI.wechatLogin()` / `setToken()` / `completeLogin()`（Task 10）
- Produces: `Login` 组件，无 props，成功登录后调用 `window.electronAPI.completeLogin()`（不是 emit 事件——因为登录成功后要切换的是整个 Electron 窗口，由主进程决定，不是父组件内部状态）

- [ ] **Step 1: 写组件**

创建 `src/render/src/components/Login.vue`：

```vue
<template>
  <div class="login">
    <h1 class="title">记单词</h1>

    <button class="wechat-btn" :disabled="loading" @click="loginWithWechat">
      微信扫码登录
    </button>

    <div class="divider">或使用账号密码</div>

    <form class="account-form" @submit.prevent="submitLogin">
      <input v-model="username" class="input" placeholder="用户名" autocomplete="username" />
      <input
        v-model="password"
        class="input"
        type="password"
        placeholder="密码"
        autocomplete="current-password"
      />
      <div class="actions">
        <button class="btn" type="submit" :disabled="loading">登录</button>
        <button class="btn secondary" type="button" :disabled="loading" @click="submitRegister">
          注册新账号
        </button>
      </div>
    </form>

    <p v-if="errorMsg" class="error">{{ errorMsg }}</p>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import http from '../api/http'

const username = ref('')
const password = ref('')
const loading = ref(false)
const errorMsg = ref('')

async function finishLogin(token) {
  await window.electronAPI.setToken(token)
  await window.electronAPI.completeLogin()
}

async function loginWithWechat() {
  loading.value = true
  errorMsg.value = ''
  try {
    const code = await window.electronAPI.wechatLogin()
    const res = await http.post('/auth/wechat/login', { code })
    if (res.data.code === 200) {
      await finishLogin(res.data.data.token)
    } else {
      errorMsg.value = res.data.msg
    }
  } catch (e) {
    errorMsg.value = e.message || '微信登录失败'
  } finally {
    loading.value = false
  }
}

async function submitLogin() {
  loading.value = true
  errorMsg.value = ''
  try {
    const res = await http.post('/auth/login', {
      username: username.value,
      password: password.value
    })
    if (res.data.code === 200) {
      await finishLogin(res.data.data.token)
    } else {
      errorMsg.value = res.data.msg
    }
  } catch (e) {
    errorMsg.value = '登录失败，请检查网络'
  } finally {
    loading.value = false
  }
}

async function submitRegister() {
  loading.value = true
  errorMsg.value = ''
  try {
    const res = await http.post('/auth/register', {
      username: username.value,
      password: password.value
    })
    if (res.data.code === 200) {
      await finishLogin(res.data.data.token)
    } else {
      errorMsg.value = res.data.msg
    }
  } catch (e) {
    errorMsg.value = '注册失败，请检查网络'
  } finally {
    loading.value = false
  }
}
</script>

<style scoped>
.login {
  width: 100%;
  height: 100vh;
  box-sizing: border-box;
  padding: 40px 32px;
  background: #ffffff;
  display: flex;
  flex-direction: column;
  align-items: stretch;
}

.title {
  text-align: center;
  font-size: 22px;
  margin-bottom: 24px;
}

.wechat-btn {
  background: #07c160;
  color: #fff;
  border: none;
  border-radius: 6px;
  padding: 12px;
  font-size: 15px;
  cursor: pointer;
}

.divider {
  text-align: center;
  color: #9ca3af;
  font-size: 12px;
  margin: 20px 0;
}

.account-form {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.input {
  padding: 10px 12px;
  border: 1px solid #e5e7eb;
  border-radius: 6px;
  font-size: 14px;
}

.actions {
  display: flex;
  gap: 8px;
}

.btn {
  flex: 1;
  padding: 10px;
  border-radius: 6px;
  border: none;
  cursor: pointer;
  background: #2563eb;
  color: #fff;
}

.btn.secondary {
  background: #f3f4f6;
  color: #1f2937;
}

.error {
  margin-top: 16px;
  color: #dc2626;
  font-size: 13px;
  text-align: center;
}
</style>
```

- [ ] **Step 2: 提交**

```bash
git add src/render/src/components/Login.vue
git commit -m "feat: 登录界面组件（微信扫码 + 账号密码）"
```

---

### Task 10: preload.cjs 暴露鉴权相关方法

**Files:**
- Modify: `src/preload/preload.cjs`

**Interfaces:**
- Produces: `window.electronAPI` 新增 `getToken()`、`setToken(token)`、`clearToken()`、`wechatLogin()`、`completeLogin()`、`sessionExpired()`

- [ ] **Step 1: 改文件**

把 `src/preload/preload.cjs` 整个替换成：

```js
// See the Electron documentation for details on how to use preload scripts:
// https://www.electronjs.org/docs/latest/tutorial/process-model#preload-scripts
// 用 CommonJS 写：preload 脚本跑在独立沙箱里，不走项目 "type": "module" 的 ESM 解析

const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  minimizeWindow: () => ipcRenderer.send('window-minimize'),
  closeWindow: () => ipcRenderer.send('window-close'),
  moveWindowBy: (dx, dy) => ipcRenderer.send('window-move-by', dx, dy),

  getToken: () => ipcRenderer.invoke('auth:get-token'),
  setToken: (token) => ipcRenderer.invoke('auth:set-token', token),
  clearToken: () => ipcRenderer.invoke('auth:clear-token'),
  wechatLogin: () => ipcRenderer.invoke('auth:wechat-login'),
  completeLogin: () => ipcRenderer.invoke('auth:login-success'),
  sessionExpired: () => ipcRenderer.invoke('auth:session-expired')
})
```

- [ ] **Step 2: 提交**

```bash
git add src/preload/preload.cjs
git commit -m "feat: preload 暴露登录相关 IPC 方法"
```

---

### Task 11: main.js — token 本地存储、登录窗口、微信登录拦截、启动流程改造

**Files:**
- Modify: `src/main/main.js`

**Interfaces:**
- Consumes: `preload.cjs`（Task 10 约定的 IPC 频道名）
- Produces: `createLoginWindow()`、登录/悬浮词卡两个窗口之间的切换逻辑；生产环境不再 `startPythonBackend()`

这是本次改动里最大的一个文件改动，分成几个小步骤做，每步都能独立验证。

- [ ] **Step 1: 加 token 本地存储的读写函数**

在 `src/main/main.js` 顶部 `import` 区域，把：

```js
import { readFileSync } from 'fs'
```

改成：

```js
import { readFileSync, writeFileSync, existsSync } from 'fs'
```

在 `let isCapturing = false` 之后加两个新的模块级变量和一组函数：

```js
let loginWindow = null

function getAuthFilePath() {
  return join(app.getPath('userData'), 'auth.json')
}

function getStoredToken() {
  const filePath = getAuthFilePath()
  if (!existsSync(filePath)) return null
  try {
    const data = JSON.parse(readFileSync(filePath, 'utf-8'))
    return data.token || null
  } catch {
    return null
  }
}

function setStoredToken(token) {
  writeFileSync(getAuthFilePath(), JSON.stringify({ token }), 'utf-8')
}

function clearStoredToken() {
  setStoredToken(null)
}
```

- [ ] **Step 2: 加微信/API 地址配置常量**

在文件顶部（`const __dirname = ...` 之后）加：

```js
// 微信开放平台"网站应用"配置：AppID 不是密钥，可以放在客户端；
// 打包前把 WECHAT_APP_ID 和 WECHAT_REDIRECT_URI 换成真实值
// （WECHAT_REDIRECT_URI 要跟微信开放平台后台配置的"授权回调域"匹配的一个具体路径）
const WECHAT_APP_ID = 'REPLACE_WITH_YOUR_WECHAT_APP_ID'
const WECHAT_REDIRECT_URI = 'https://REPLACE_WITH_YOUR_DOMAIN/auth/wechat/callback'

const API_BASE_URL =
  process.env.NODE_ENV === 'development'
    ? 'http://127.0.0.1:8000'
    : 'https://REPLACE_WITH_YOUR_DOMAIN'
```

- [ ] **Step 3: 加"校验本地 token 是否还有效"的函数（在主进程里用 Node 内置 fetch 直接调 `/auth/me`，不用等渲染进程加载）**

加一个新函数：

```js
async function checkStoredAuth() {
  const token = getStoredToken()
  if (!token) return false

  try {
    const res = await fetch(`${API_BASE_URL}/auth/me`, {
      headers: { Authorization: `Bearer ${token}` }
    })
    const data = await res.json()
    return data.code === 200
  } catch {
    return false
  }
}
```

- [ ] **Step 4: 加登录窗口的创建函数**

```js
function createLoginWindow() {
  loginWindow = new BrowserWindow({
    width: 420,
    height: 600,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: join(__dirname, '../preload/preload.cjs')
    }
  })

  loginWindow.on('closed', () => {
    loginWindow = null
  })

  const isDev = process.env.NODE_ENV === 'development'
  if (isDev) {
    loginWindow.loadURL('http://localhost:8081?view=login')
  } else {
    loginWindow.loadFile(join(__dirname, '../renderer/index.html'), { query: { view: 'login' } })
  }
}
```

- [ ] **Step 5: 加微信扫码登录的 BrowserWindow 拦截逻辑**

```js
// 微信扫码登录：弹一个子窗口加载微信官方授权页，用户扫码后微信会把这个
// 窗口导航到 WECHAT_REDIRECT_URI，主进程拦截这个导航拿到 code，不等页面
// 真正加载完就关窗口（用户体验上是扫完码窗口应声消失）
function loginWithWechat() {
  return new Promise((resolve, reject) => {
    const state = Math.random().toString(36).slice(2)
    const authUrl =
      `https://open.weixin.qq.com/connect/qrconnect?appid=${WECHAT_APP_ID}` +
      `&redirect_uri=${encodeURIComponent(WECHAT_REDIRECT_URI)}` +
      `&response_type=code&scope=snsapi_login&state=${state}#wechat_redirect`

    const wechatWindow = new BrowserWindow({
      width: 400,
      height: 550,
      webPreferences: { contextIsolation: true }
    })

    let settled = false

    const handleUrl = (url) => {
      if (settled || !url.startsWith(WECHAT_REDIRECT_URI)) return
      settled = true

      const parsedUrl = new URL(url)
      const code = parsedUrl.searchParams.get('code')
      const returnedState = parsedUrl.searchParams.get('state')

      if (!wechatWindow.isDestroyed()) wechatWindow.destroy()

      if (code && returnedState === state) {
        resolve(code)
      } else {
        reject(new Error('微信登录失败或已取消'))
      }
    }

    wechatWindow.webContents.on('will-redirect', (event, url) => handleUrl(url))
    wechatWindow.webContents.on('will-navigate', (event, url) => handleUrl(url))
    wechatWindow.on('closed', () => {
      if (!settled) {
        settled = true
        reject(new Error('用户取消了登录'))
      }
    })

    wechatWindow.loadURL(authUrl)
  })
}
```

- [ ] **Step 6: 加新的 IPC 处理器（放在原有 `ipcMain.on('window-move-by', ...)` 之后）**

```js
ipcMain.handle('auth:get-token', () => getStoredToken())
ipcMain.handle('auth:set-token', (event, token) => {
  setStoredToken(token)
  return true
})
ipcMain.handle('auth:clear-token', () => {
  clearStoredToken()
  return true
})
ipcMain.handle('auth:wechat-login', () => loginWithWechat())
ipcMain.handle('auth:login-success', () => {
  if (loginWindow && !loginWindow.isDestroyed()) {
    loginWindow.close()
  }
  createWindow()
})
ipcMain.handle('auth:session-expired', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.close()
  }
  createLoginWindow()
})
```

- [ ] **Step 7: 改造 `app.whenReady()` 启动流程——根据登录态决定弹登录窗口还是悬浮词卡窗口；生产环境不再启动本地 Python 后端**

把现有的：

```js
app.whenReady().then(() => {
  // 在开发环境下可选：尝试自动启动Vue开发服务器
  if (process.env.NODE_ENV === 'development') {
    startVueDevServer();
    startPythonBackend();

    // 给Vue服务器一些启动时间，然后再创建窗口
    setTimeout(() => {
      createWindow();
    }, 3000);
  } else {
    // 生产环境直接启动
    startPythonBackend();
    createWindow();
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
```

替换成：

```js
app.whenReady().then(async () => {
  const isDev = process.env.NODE_ENV === 'development'

  // 开发环境继续本地起 Vue dev server + 本地 Python 后端；
  // 生产环境后端已经常驻在云端，不用再在本机 spawn 一份
  if (isDev) {
    startVueDevServer()
    startPythonBackend()
  }

  const openInitialWindow = () => {
    if (isDev) {
      // 给本地 Vue dev server 一点启动时间
      setTimeout(() => createWindow(), 3000)
    } else {
      createWindow()
    }
  }

  const authed = await checkStoredAuth()
  if (authed) {
    openInitialWindow()
  } else if (isDev) {
    setTimeout(() => createLoginWindow(), 3000)
  } else {
    createLoginWindow()
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
```

（后面紧跟着的 `globalShortcut.register(...)` 那一段维持不变，仍然在同一个 `.then()` 回调里）

- [ ] **Step 8: 手动验证 —— 开发环境完整走一遍登录流程**

先在本地 MySQL 里注册一个测试账号（复用 Task 5 写好的接口，用 curl 直接调本地后端，不用等前端页面）：

```bash
# 确认本地后端在跑（npm run dev 会自动起，或者手动：cd backend && ./.venv/bin/python main.py）
curl -X POST http://127.0.0.1:8000/auth/register \
  -H "Content-Type: application/json" \
  -d '{"username":"devtest","password":"secret123"}'
```
Expected: 返回 `{"code":200,"data":{"token":"...","user":{...}}}`

```bash
npm run dev
```
Expected: 先弹出登录窗口（不是悬浮词卡），因为 `~/Library/Application Support/<app>/auth.json` 还不存在

- [ ] **Step 9: 提交**

```bash
git add src/main/main.js
git commit -m "feat: main.js 加登录窗口/微信登录拦截/token本地存储，生产环境移除本地后端 spawn"
```

---

### Task 12: App.vue 按视图切换，Desk.vue 改用共享 axios 实例

**Files:**
- Modify: `src/render/src/App.vue`
- Modify: `src/render/src/components/Desk.vue`

**Interfaces:**
- Consumes: `Login`（Task 9）、`http`（Task 8）

- [ ] **Step 1: 改 App.vue**

把 `src/render/src/App.vue` 的 `<template>`/`<script>` 部分改成（`<style>` 部分不变）：

```vue
<template>
  <Login v-if="isLoginView" />
  <Desk v-else />
</template>

<script setup>
import Desk from './components/Desk.vue'
import Login from './components/Login.vue'

const isLoginView = new URLSearchParams(window.location.search).get('view') === 'login'
</script>
```

完整文件内容：

```vue
<template>
  <Login v-if="isLoginView" />
  <Desk v-else />
</template>

<script setup>
import Desk from './components/Desk.vue'
import Login from './components/Login.vue'

const isLoginView = new URLSearchParams(window.location.search).get('view') === 'login'
</script>

<style>
html,
body,
#app {
  width: 100%;
  height: 100%;
  overflow: hidden;
}

#app {
  font-family: Avenir, Helvetica, Arial, sans-serif;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  text-align: center;
  color: #2c3e50;
  background: transparent;
}

body {
  background: transparent !important;
  margin: 0 !important;
  padding: 0 !important;
}
</style>
```

- [ ] **Step 2: 改 Desk.vue，把裸 axios + 写死的地址换成共享实例**

编辑 `src/render/src/components/Desk.vue`，把：

```js
import axios from 'axios'
```

改成：

```js
import http from '../api/http'
```

把：

```js
const response = await axios.get('http://127.0.0.1:8000/words/list', {
  params: { page: 1, page_size: 10000 }
})
```

改成：

```js
const response = await http.get('/words/list', {
  params: { page: 1, page_size: 10000 }
})
```

- [ ] **Step 3: 构建渲染进程，确认没有编译错误**

```bash
cd src/render && npm run build
```
Expected: `Compiled successfully`

- [ ] **Step 4: 提交**

```bash
git add src/render/src/App.vue src/render/src/components/Desk.vue
git commit -m "feat: App.vue 按登录态切换视图，Desk.vue 改用共享 axios 实例"
```

---

### Task 13: 打包配置清理 —— 生产环境不再打包本地后端

**Files:**
- Modify: `package.json`

**Interfaces:**
- Consumes: 无（纯配置精简）

- [ ] **Step 1: 移除 `extraResources` 里的本地后端两项**

编辑 `package.json`，把：

```json
"extraResources": [
  {
    "from": "backend/dist/python-backend",
    "to": "backend/python-backend"
  },
  {
    "from": "backend/.env",
    "to": "backend/.env"
  }
],
```

改成：

```json
"extraResources": [],
```

（生产环境的 Electron 客户端不再需要本地 Python 后端可执行文件和 `.env`，这两项都不用打进 `.app` 里了）

- [ ] **Step 2: 顶层 `build` 脚本去掉 Python 后端打包步骤（不再需要为分发目的打包 PyInstaller 可执行文件）**

把：

```json
"build": "npm run build:python:mac && npm run build:render && npm run build:mac",
```

改成：

```json
"build": "npm run build:render && npm run build:mac",
```

`build:python:mac` 这个 script 本身先保留（开发者本地如果还想手动打包一份本地后端可执行文件做别的用途，命令还在，只是不再是标准发布流程的一部分）。

- [ ] **Step 3: 重新打包验证**

```bash
npm run build:render && npm run build:mac
```
Expected: 打包成功，产物体积应该比之前小（不含 39MB 的 python-backend 可执行文件了）

- [ ] **Step 4: 提交**

```bash
git add package.json
git commit -m "chore: 生产打包不再包含本地 Python 后端可执行文件与 .env"
```

---

### Task 14: 端到端手动验证

不产出新代码，走一遍完整流程确认整个功能链路通。

- [ ] **Step 1: 阿里云建表**

```bash
mysql -h <阿里云地址> -u <用户> -p <库名> < backend/sql/schema.sql
```
Expected: 5 张表都建好（`users`、`words`、`word_meanings`、`word_libraries`、`word_library_items`）

- [ ] **Step 2: 服务器上部署后端**

按 `docs/deploy.md` 把 `backend/` 部署到阿里云，`.env` 填真实的生产数据库连接串和微信 AppID/AppSecret，`systemctl start` 起来

- [ ] **Step 3: 验证后端可从公网访问**

```bash
curl https://你的域名/auth/me
```
Expected: `{"code":401,"msg":"未登录或登录已过期","data":null}`（401 说明鉴权逻辑生效，不是网络不通）

- [ ] **Step 4: 微信开放平台配置授权回调域**

登录微信开放平台后台，把这个"网站应用"的授权回调域设置成你的域名（不带协议、不带路径）

- [ ] **Step 5: 填真实配置**

把 `src/main/main.js` 里的 `WECHAT_APP_ID`、`WECHAT_REDIRECT_URI`、`API_BASE_URL` 三处 `REPLACE_WITH_...` 占位符换成真实值；`src/render/.env.production` 里的 `VUE_APP_API_BASE_URL` 也换成真实域名

- [ ] **Step 6: 打包生产版本并测试完整登录流程**

```bash
npm run build
```

打开生成的 `.app`：
- 首次打开应该弹出登录窗口（420x600，不是那个 400x100 的悬浮条）
- 点"微信扫码登录"，用手机扫码，确认登录后窗口应声关闭，切换成悬浮词卡窗口
- 退出应用重新打开，应该直接进悬浮词卡（不再弹登录窗口），因为本地存了 token
- 用账号密码注册/登录也测一遍

- [ ] **Step 7: 验证 token 过期/清空后的行为**

手动清空本地 token 文件（`~/Library/Application Support/your-app/auth.json` 写成 `{"token": null}`——`userData` 目录名取自 `package.json` 顶层的 `name` 字段 `your-app`，不是 `productName` 的"记单词"，这两个字段之前改名时特意没有同步），重新打开应用，应该又弹出登录窗口
