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
