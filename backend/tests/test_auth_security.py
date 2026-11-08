"""
Auth / RBAC 安全验收测试（组员6 · 验收裁判官）

覆盖吴老师要求的鉴权验收点：
  1. 未带 Token 访问受保护接口 -> 401
  2. 伪造/过期 Token            -> 401
  3. 普通用户访问管理员接口      -> 403（越权防护）
  4. 密码连续输错 5 次          -> 账号锁定
  5. 高频刷登录                 -> 429 限流
  6. 正确登录                   -> 200 + 返回 access_token

运行方式：
  后端 auth 路由未实现前，这些用例默认 skip（不影响 test_trip.py 绿灯）。
  后端实现 auth 后，设置环境变量 AUTH_READY=1 再跑：
      # Windows PowerShell
      $env:AUTH_READY=1; pytest tests/test_auth_security.py -v
      # Linux / macOS
      AUTH_READY=1 pytest tests/test_auth_security.py -v
"""

import os
import time
import pytest

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)

# 契约约定的受保护路径（与 auth-rbac-api-openapi.json 对齐，统一加 /api/v1 前缀）
LOGIN_URL = "/api/v1/auth/login"
ME_URL = "/api/v1/users/me"
ADMIN_USERS_URL = "/api/v1/admin/users"
PERMISSIONS_URL = "/api/v1/permissions"

# 后端 auth 是否就绪：未就绪则全部 skip，避免干扰现有测试
AUTH_READY = os.getenv("AUTH_READY", "0") == "1"
pytestmark = pytest.mark.skipif(
    not AUTH_READY,
    reason="后端 auth/RBAC 路由尚未实现；设置 AUTH_READY=1 后启用本组验收测试",
)


# ---------- 1. 401：未带 Token / 伪造 Token ----------

def test_no_token_access_me_returns_401():
    """受保护接口未带 Authorization 头，必须返回 401（而非 200/500）。"""
    resp = client.get(ME_URL)
    assert resp.status_code == 401, f"预期 401，实际 {resp.status_code}"
    body = resp.json()
    # 契约统一响应结构：code 非 0，message 提示未认证
    assert body.get("code") in (401, 10401, 1), "响应结构应包含错误码"


def test_invalid_token_returns_401():
    """伪造的 Bearer Token 必须返回 401。"""
    resp = client.get(ME_URL, headers={"Authorization": "Bearer fake.token.here"})
    assert resp.status_code == 401, f"预期 401，实际 {resp.status_code}"


def test_normal_user_cannot_access_admin_returns_403():
    """普通用户（非管理员）访问 /admin/* 必须返回 403，防水平越权。"""
    # 先用普通账号登录拿 token（需后端提供一个普通测试账号）
    login_resp = client.post(LOGIN_URL, json={
        "mobile": "13800000001",
        "password": "User@123456",
    })
    assert login_resp.status_code == 200, "普通测试账号应能登录"
    token = login_resp.json()["data"]["access_token"]

    resp = client.get(ADMIN_USERS_URL, headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 403, f"普通用户访问 admin 应 403，实际 {resp.status_code}"


# ---------- 2. 登录：成功 + 密码错误 5 次锁定 ----------

def test_login_success_returns_token():
    """正确账号密码登录返回 200 + access_token + user_id。"""
    resp = client.post(LOGIN_URL, json={
        "mobile": "13800000001",
        "password": "User@123456",
    })
    assert resp.status_code == 200
    body = resp.json()
    assert body["code"] == 0
    assert body["data"]["access_token"], "登录必须返回 token"
    assert body["data"]["user_id"]


def test_wrong_password_5_times_locks_account():
    """连续输错密码 5 次，第 5 次起账号被锁定（返回锁定错误码，如 20016/423）。"""
    mobile = "13800000002"  # 专门用于锁定测试的账号
    locked = False
    for i in range(6):
        resp = client.post(LOGIN_URL, json={
            "mobile": mobile,
            "password": f"WrongPass{i}",
        })
        body = resp.json()
        # 前 4 次：密码错误；第 5 次起：应触发锁定
        if resp.status_code in (423, 403) or body.get("code") == 20016:
            locked = True
            break
    assert locked, "连续错 5 次应触发账号锁定策略"


# ---------- 3. 429：登录接口限流防刷 ----------

def test_login_rate_limit_returns_429():
    """对同一手机号/IP 高频请求登录接口，应被限流（429 或 code=20014）。"""
    blocked = False
    for _ in range(30):  # 快速打 30 次，触发限流阈值
        resp = client.post(LOGIN_URL, json={
            "mobile": "13800000003",
            "password": "AnyPass@123",
        })
        body = resp.json()
        if resp.status_code == 429 or body.get("code") == 20014:
            blocked = True
            break
        time.sleep(0.05)
    assert blocked, "登录接口应有限流（429 / 20014）防枚举撞库"


# ---------- 4. 权限资源：菜单/按钮列表可访问 ----------

def test_permission_list_requires_auth():
    """权限资源列表必须鉴权，未登录 401。"""
    resp = client.get(PERMISSIONS_URL)
    assert resp.status_code == 401
