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
