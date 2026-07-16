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
