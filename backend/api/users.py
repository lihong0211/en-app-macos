# users.py
from fastapi import APIRouter, Query, Depends, status
from typing import Optional, List
from sqlalchemy.orm import Session

from model.users import UserModel, UserBase, UserPublic
from utils.security import hash_password
from db import get_db
from core.api_result import success, error, ApiResponse

router = APIRouter(
    prefix="/users", tags=["users"], responses={404: {"description": "Not found"}}
)


@router.get("/list", response_model=ApiResponse[List[UserPublic]], summary="获取用户列表")
async def get_users(
    db: Session = Depends(get_db),
    page: int = Query(0, description="页码，从1开始"),
    page_size: int = Query(10, description="每页记录数", le=10000),
    active: Optional[bool] = Query(None, description="是否激活"),
):
    criterion = {}
    if active is not None:
        # 使用数据库字段名 'active'
        criterion["active"] = active

    users = UserModel.select_by(db, criterion)

    # 添加分页
    start = (page - 1) * page_size
    end = start + page_size
    paginated_users = users[start:end]
    return success(paginated_users)


@router.get(
    "/{user_id}", response_model=ApiResponse[UserPublic], summary="根据ID获取用户"
)
async def get_user(user_id: int, db: Session = Depends(get_db)):
    user = UserModel.get_by_id(db, user_id)
    if not user:
        return error("User not found")
    return success(user)


@router.post(
    "/add",
    response_model=ApiResponse[UserPublic],
    status_code=status.HTTP_201_CREATED,
    summary="创建用户",
)
async def create_user(user: UserBase, db: Session = Depends(get_db)):
    existing_username = UserModel.select_one_by(db, {"username": user.username})
    if existing_username:
        return error("Username already exists")

    user_data = user.dict()
    if user_data.get("password"):
        user_data["password"] = hash_password(user_data["password"])
    user_id = UserModel.insert(db, user_data)

    return success(UserModel.get_by_id(db, user_id))


@router.post("/update", response_model=ApiResponse[UserPublic], summary="更新用户")
async def update_user(
    user_id: int = Query(..., description="用户ID"),
    user_data: UserBase = None,
    db: Session = Depends(get_db),
):
    existing_user = UserModel.get_by_id(db, user_id)
    if not existing_user:
        return error("User not found")

    update_dict = user_data.dict(exclude_unset=True)
    if update_dict.get("password"):
        update_dict["password"] = hash_password(update_dict["password"])

    if "username" in update_dict and update_dict["username"] != existing_user.username:
        username_exists = UserModel.select_one_by(
            db, {"username": update_dict["username"]}
        )
        if username_exists and username_exists.id != user_id:
            return error("Username already exists")

    update_dict["id"] = user_id
    UserModel.update(db, update_dict)

    return success(UserModel.get_by_id(db, user_id))


@router.post("/delete", status_code=status.HTTP_200_OK, summary="删除用户")
async def delete_user(
    user_id: int = Query(..., description="用户ID"), db: Session = Depends(get_db)
):
    UserModel.delete(db, user_id)
    return success()


@router.post("/activate", response_model=ApiResponse[UserPublic], summary="激活/禁用用户")
async def activate_user(
    user_id: int = Query(..., description="用户ID"),
    active: bool = Query(..., description="激活状态"),
    db: Session = Depends(get_db),
):
    existing_user = UserModel.get_by_id(db, user_id)
    if not existing_user:
        return error("User not found")

    # 更新用户激活状态
    update_data = {"id": user_id, "active": active}
    UserModel.update(db, update_data)

    # 返回更新后的用户
    return success(UserModel.get_by_id(db, user_id))
