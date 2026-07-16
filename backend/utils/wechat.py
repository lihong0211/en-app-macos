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
