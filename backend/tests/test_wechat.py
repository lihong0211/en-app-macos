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
